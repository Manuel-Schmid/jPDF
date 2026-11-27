//! Parsing the JSON event streams of the local AI CLIs (Claude Code's
//! `stream-json` and Codex's `exec --json`) into answer text. Pure, so it is
//! tested with recorded lines and no process: the runner feeds it one stdout
//! line at a time.
use serde_json::Value;

use super::args::CliKind;

/// What one stdout line of a CLI carried.
#[derive(Debug, PartialEq)]
pub enum Event {
    /// A piece of the answer text.
    Text(String),
    /// The exact model the CLI runs (Claude Code names it on startup, also
    /// when an alias such as `sonnet` or none was asked for).
    Model(String),
    /// The run ended; `truncated` when the model hit its output limit.
    Finished { truncated: bool },
    /// The CLI reported an error (login expired, usage limit, ...).
    Failed(String),
    /// A notice that may be transient (Codex reports a stream reconnect this
    /// way). Not fatal: the runner only shows the last one if the run then
    /// ends without finishing.
    Warning(String),
}

/// The event in one stdout line, or `None` for lines that carry nothing for
/// us (startup, retries, rate-limit notices, whole-message duplicates of
/// streamed text, malformed lines).
pub fn parse_line(kind: CliKind, line: &str) -> Option<Event> {
    let v: Value = serde_json::from_str(line).ok()?;
    match kind {
        CliKind::Claude => parse_claude(&v),
        CliKind::Codex => parse_codex(&v),
    }
}

/// Claude Code `--output-format stream-json --include-partial-messages`.
/// Only the partial text deltas carry text; the later whole `assistant`
/// message repeats it and is ignored, as are other `system` and rate-limit
/// lines. The `system` `init` line names the model.
fn parse_claude(v: &Value) -> Option<Event> {
    match v["type"].as_str()? {
        "system" if v["subtype"] == "init" => {
            let model = v["model"].as_str()?.trim();
            (!model.is_empty()).then(|| Event::Model(model.to_owned()))
        }
        "stream_event" => {
            let event = &v["event"];
            if event["type"] != "content_block_delta" || event["delta"]["type"] != "text_delta" {
                return None;
            }
            Some(Event::Text(event["delta"]["text"].as_str()?.to_owned()))
        }
        "result" => {
            if v["is_error"].as_bool() == Some(true) {
                let msg = v["result"].as_str().unwrap_or("").trim();
                let name = CliKind::Claude.name();
                // Without a message the status is the only clue; without
                // either, a plain sentence rather than "API error null".
                return Some(Event::Failed(match (msg.is_empty(), &v["api_error_status"]) {
                    (false, _) => msg.to_owned(),
                    (true, Value::Null) => format!("{name} failed."),
                    (true, status) => format!("{name} failed (API error {status})."),
                }));
            }
            // Truncated only on an explicit limit; a missing or any other
            // stop reason is a normal end.
            Some(Event::Finished { truncated: v["stop_reason"] == "max_tokens" })
        }
        _ => None,
    }
}

/// Codex `exec --json`. The answer arrives as whole `agent_message` items
/// (no deltas). An `error` item is a startup notice (e.g. a disabled
/// feature) and ignored; a top-level `error` event can be a transient notice
/// (stream reconnect), so it is only a warning. Real failures end the turn
/// with `turn.failed`.
fn parse_codex(v: &Value) -> Option<Event> {
    match v["type"].as_str()? {
        "item.completed" => {
            let item = &v["item"];
            if item["type"] != "agent_message" {
                return None;
            }
            // The newline closes the last answer line for the LineSplitter.
            Some(Event::Text(format!("{}\n", item["text"].as_str()?)))
        }
        "turn.completed" => Some(Event::Finished { truncated: false }),
        "turn.failed" => Some(Event::Failed(message(&v["error"]["message"]))),
        "error" => Some(Event::Warning(message(&v["message"]))),
        _ => None,
    }
}

/// An error message, with a generic text when the CLI sent none (or only
/// blank space, which would show as an empty status).
fn message(v: &Value) -> String {
    match v.as_str().map(str::trim) {
        Some(m) if !m.is_empty() => m.to_owned(),
        _ => format!("{} failed.", CliKind::Codex.name()),
    }
}

/// Cuts the answer text into complete lines (the model writes one JSON
/// object per line); a line is handed out once its line break arrived.
#[derive(Default)]
pub struct LineSplitter {
    pending: String,
}

impl LineSplitter {
    /// The non-blank lines completed by `text`.
    pub fn feed(&mut self, text: &str) -> Vec<String> {
        self.pending.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            let line = line.trim();
            if !line.is_empty() {
                out.push(line.to_owned());
            }
        }
        out
    }

    /// The last line, if the answer did not end with a line break.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.pending);
        let rest = rest.trim();
        (!rest.is_empty()).then(|| rest.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: CliKind = CliKind::Claude;
    const CODEX: CliKind = CliKind::Codex;

    fn text(s: &str) -> Option<Event> {
        Some(Event::Text(s.into()))
    }

    #[test]
    fn claude_text_deltas() {
        let a = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"page\":1,"}},"session_id":"s1"}"#;
        let b = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\"text\":\"a\"}\n"}},"session_id":"s1"}"#;
        assert_eq!(parse_line(CLAUDE, a), text("{\"page\":1,"));
        assert_eq!(parse_line(CLAUDE, b), text("\"text\":\"a\"}\n"));
    }

    #[test]
    fn claude_non_text_stream_events_are_ignored() {
        let start = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"s1"}"#;
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hm"}},"session_id":"s1"}"#;
        assert_eq!(parse_line(CLAUDE, start), None);
        assert_eq!(parse_line(CLAUDE, thinking), None);
    }

    #[test]
    fn claude_auth_error_is_failed() {
        let line = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"duration_ms":2016,"num_turns":1,"result":"Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token`","session_id":"s1"}"#;
        assert_eq!(
            parse_line(CLAUDE, line),
            Some(Event::Failed(
                "Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token`".into()
            ))
        );
    }

    #[test]
    fn claude_error_without_message_falls_back_to_status() {
        let line = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":529,"result":"","session_id":"s1"}"#;
        assert_eq!(
            parse_line(CLAUDE, line),
            Some(Event::Failed("Claude Code failed (API error 529).".into()))
        );
    }

    #[test]
    fn claude_error_without_message_or_status_is_generic() {
        for line in [
            r#"{"type":"result","is_error":true,"result":""}"#,
            r#"{"type":"result","is_error":true,"api_error_status":null,"result":"  "}"#,
        ] {
            assert_eq!(parse_line(CLAUDE, line), Some(Event::Failed("Claude Code failed.".into())), "{line}");
        }
    }

    #[test]
    fn claude_success_is_finished() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"{}","session_id":"s1"}"#;
        assert_eq!(parse_line(CLAUDE, line), Some(Event::Finished { truncated: false }));
        // No stop_reason at all is still a normal end.
        let bare = r#"{"type":"result","subtype":"success","is_error":false,"result":"{}"}"#;
        assert_eq!(parse_line(CLAUDE, bare), Some(Event::Finished { truncated: false }));
    }

    #[test]
    fn claude_max_tokens_is_truncated() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"stop_reason":"max_tokens","result":"{}","session_id":"s1"}"#;
        assert_eq!(parse_line(CLAUDE, line), Some(Event::Finished { truncated: true }));
    }

    #[test]
    fn claude_init_reports_the_model() {
        // Recorded from Claude Code 2.1.331 run with `--model sonnet`: the
        // init line names the model the alias resolved to.
        let line = r#"{"type":"system","subtype":"init","cwd":"C:\tmp","session_id":"s1","tools":[],"model":"claude-sonnet-5-5","apiKeySource":"none"}"#;
        assert_eq!(parse_line(CLAUDE, line), Some(Event::Model("claude-sonnet-5-5".into())));
    }

    #[test]
    fn claude_init_without_a_model_is_ignored() {
        for line in [
            r#"{"type":"system","subtype":"init","model":""}"#,
            r#"{"type":"system","subtype":"init","model":"  "}"#,
            r#"{"type":"system","subtype":"init","model":null}"#,
            r#"{"type":"system","subtype":"api_retry","model":"claude-x"}"#,
        ] {
            assert_eq!(parse_line(CLAUDE, line), None, "{line}");
        }
    }

    #[test]
    fn claude_ignores_noise() {
        for line in [
            r#"{"type":"system","subtype":"init","cwd":"C:\\tmp","session_id":"s1","tools":[]}"#,
            r#"{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"error_status":401,"error":"authentication_failed"}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#,
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"{}"}]}}"#,
            "not json",
            "",
        ] {
            assert_eq!(parse_line(CLAUDE, line), None, "{line}");
        }
    }

    #[test]
    fn codex_message_and_completion() {
        let msg = r#"{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{\"page\":1,\"text\":\"a\"}\n{\"page\":2,\"text\":\"b\"}"}}"#;
        assert_eq!(
            parse_line(CODEX, msg),
            text("{\"page\":1,\"text\":\"a\"}\n{\"page\":2,\"text\":\"b\"}\n")
        );
        let done = r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}"#;
        assert_eq!(parse_line(CODEX, done), Some(Event::Finished { truncated: false }));
    }

    #[test]
    fn codex_startup_error_item_is_ignored() {
        let line = r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`."}}"#;
        assert_eq!(parse_line(CODEX, line), None);
    }

    #[test]
    fn codex_turn_failed() {
        let line = r#"{"type":"turn.failed","error":{"message":"usage limit reached"}}"#;
        assert_eq!(parse_line(CODEX, line), Some(Event::Failed("usage limit reached".into())));
    }

    #[test]
    fn codex_top_level_error_is_warning() {
        // Codex also sends these for transient trouble it recovers from
        // (e.g. a stream reconnect), so they must not end the run.
        let line = r#"{"type":"error","message":"stream disconnected"}"#;
        assert_eq!(parse_line(CODEX, line), Some(Event::Warning("stream disconnected".into())));
    }

    #[test]
    fn codex_empty_or_missing_message_is_generic() {
        let generic = || "Codex CLI failed.".to_string();
        for line in [r#"{"type":"turn.failed","error":{"message":"  "}}"#, r#"{"type":"turn.failed","error":{}}"#] {
            assert_eq!(parse_line(CODEX, line), Some(Event::Failed(generic())), "{line}");
        }
        let warning = r#"{"type":"error","message":""}"#;
        assert_eq!(parse_line(CODEX, warning), Some(Event::Warning(generic())));
    }

    #[test]
    fn codex_ignores_noise() {
        for line in [
            r#"{"type":"thread.started","thread_id":"t1"}"#,
            r#"{"type":"turn.started"}"#,
            "not json",
        ] {
            assert_eq!(parse_line(CODEX, line), None, "{line}");
        }
    }

    #[test]
    fn kinds_do_not_mix() {
        let codex_done = r#"{"type":"turn.completed","usage":{}}"#;
        assert_eq!(parse_line(CLAUDE, codex_done), None);
    }

    #[test]
    fn splits_answer_into_lines() {
        let mut s = LineSplitter::default();
        assert_eq!(s.feed("{\"page\": 1, \"te"), Vec::<String>::new());
        assert_eq!(s.feed("xt\": \"a\"}\n\n{\"page\""), vec![r#"{"page": 1, "text": "a"}"#]);
        assert_eq!(s.feed(": 2}\r\n"), vec![r#"{"page": 2}"#]);
        assert_eq!(s.feed("tail"), Vec::<String>::new());
        assert_eq!(s.finish(), Some("tail".into()));
        assert_eq!(s.finish(), None);
    }
}
