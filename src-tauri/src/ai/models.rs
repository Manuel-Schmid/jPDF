//! Model lists from the CLIs themselves, so Settings offers exactly what the
//! user's installed Claude Code or Codex knows. Blocking: the command calls
//! it inside `spawn_blocking`.

use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use super::args::{ChildEnv, CliKind, models_args};
use super::discover::Program;
use super::run::{kill_tree, spawn_with_stderr, wait_briefly};
use crate::error::AppError;

/// Overall limit for one model-list request, from spawn to answer.
pub(crate) const MODELS_LIMIT: Duration = Duration::from_secs(15);

/// The request id of the Claude `initialize` control request.
const CLAUDE_REQUEST_ID: &str = "juliepdf-models";

/// One selectable model, as Settings shows it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliModel {
    /// What is passed to the CLI (`--model` / `-m`).
    pub value: String,
    pub label: String,
    pub description: String,
    /// Reasoning efforts the model supports; empty when it has none.
    pub efforts: Vec<String>,
    pub is_default: bool,
    /// Whether the model can read page pictures; a text-only model gets
    /// page text alone.
    pub images: bool,
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// The answer to Claude's `initialize` control request: a `control_response`
/// for `request_id`, with the models under `response.response.models`.
/// Any other line (other ids, stream events) gives `None`. `default` is the
/// entry that follows the user's own configured model.
pub fn parse_claude_models(line: &str, request_id: &str) -> Option<Vec<CliModel>> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "control_response" {
        return None;
    }
    let outer = v.get("response")?;
    if outer.get("request_id")?.as_str()? != request_id {
        return None;
    }
    let models = outer.get("response")?.get("models")?.as_array()?;
    Some(
        models
            .iter()
            .filter_map(|m| {
                let value = m.get("value")?.as_str()?.to_string();
                let efforts = m
                    .get("supportedEffortLevels")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|e| e.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                Some(CliModel {
                    label: str_of(m, "displayName"),
                    description: str_of(m, "description"),
                    efforts,
                    is_default: value == "default",
                    // Every Claude model reads pictures.
                    images: true,
                    value,
                })
            })
            .collect(),
    )
}

/// The JSON-RPC answer (`id` 2) to Codex's `model/list`. Hidden models are
/// skipped; the `ultra` effort is never offered (it delegates to other
/// agents, which an explanation must not do). Notifications have no `id`
/// and give `None`.
pub fn parse_codex_models(line: &str) -> Option<Vec<CliModel>> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("id")?.as_i64()? != 2 {
        return None;
    }
    let data = v.get("result")?.get("data")?.as_array()?;
    Some(
        data.iter()
            .filter(|m| !m.get("hidden").and_then(Value::as_bool).unwrap_or(false))
            .filter_map(|m| {
                let efforts = m
                    .get("supportedReasoningEfforts")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|e| e.get("reasoningEffort")?.as_str())
                            .filter(|e| *e != "ultra")
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default();
                Some(CliModel {
                    value: m.get("model")?.as_str()?.to_string(),
                    label: str_of(m, "displayName"),
                    description: str_of(m, "description"),
                    efforts,
                    is_default: m.get("isDefault").and_then(Value::as_bool).unwrap_or(false),
                    // A missing field is read as "yes": an older Codex that
                    // does not report modalities should not lose pictures.
                    images: m
                        .get("inputModalities")
                        .and_then(Value::as_array)
                        .is_none_or(|a| a.iter().any(|x| x.as_str() == Some("image"))),
                })
            })
            .collect(),
    )
}

/// The request lines each CLI needs, in order.
fn request_lines(kind: CliKind) -> Vec<String> {
    match kind {
        CliKind::Claude => vec![format!(
            r#"{{"type":"control_request","request_id":"{CLAUDE_REQUEST_ID}","request":{{"subtype":"initialize"}}}}"#
        )],
        CliKind::Codex => vec![
            format!(
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"clientInfo":{{"name":"juliepdf","version":"{}"}}}}}}"#,
                env!("CARGO_PKG_VERSION")
            ),
            r#"{"jsonrpc":"2.0","method":"initialized"}"#.to_string(),
            r#"{"jsonrpc":"2.0","id":2,"method":"model/list","params":{}}"#.to_string(),
        ],
    }
}

fn parse_for(kind: CliKind, line: &str) -> Option<Vec<CliModel>> {
    match kind {
        CliKind::Claude => parse_claude_models(line, CLAUDE_REQUEST_ID),
        CliKind::Codex => parse_codex_models(line),
    }
}

/// Asks the CLI for its models. Stdout is read on a thread so `limit` holds
/// even if the CLI never writes; stdin stays open until the answer arrives
/// (an early EOF can make a CLI exit unanswered). The process tree is killed
/// on every path, success included: Codex's app-server never exits by itself.
/// Stderr is never read, so it goes nowhere: a chatty CLI writing warnings
/// there would otherwise block on the full pipe before it answers.
pub(crate) fn fetch_models(
    program: &Program,
    kind: CliKind,
    env: &ChildEnv,
    limit: Duration,
) -> Result<Vec<CliModel>, AppError> {
    let failed = || AppError::AiCli(format!("Could not load the model list from {}.", kind.name()));
    let (mut child, _dir) = spawn_with_stderr(program, &models_args(kind), env, &[], Stdio::null())?;
    let pid = child.id();
    let deadline = Instant::now() + limit;

    let result = (|| {
        let mut stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let (tx, rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(l) = line else { break };
                if tx.send(l).is_err() {
                    break;
                }
            }
        });
        for l in request_lines(kind) {
            // A CLI that already died shows up as a closed channel below.
            let _ = writeln!(stdin, "{l}");
        }
        let _ = stdin.flush();
        let found = loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(line) => {
                    if let Some(models) = parse_for(kind, &line) {
                        break Some(models);
                    }
                }
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break None,
            }
        };
        drop(stdin);
        found
    })();

    kill_tree(pid);
    wait_briefly(&mut child, Duration::from_secs(2));
    result.ok_or_else(failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: &str = r#"{"type":"control_response","response":{"subtype":"success","request_id":"juliepdf-models","response":{"commands":[],"models":[
{"value":"default","displayName":"Default","description":"Your configured model","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"]},
{"value":"opus","displayName":"Opus","description":"Most capable","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"]},
{"value":"haiku","displayName":"Haiku","description":"Fastest"}],"account":{"email":"someone@example.com"}}}}"#;

    fn one_line(s: &str) -> String {
        s.replace('\n', "")
    }

    #[test]
    fn claude_models_are_parsed() {
        let m = parse_claude_models(&one_line(CLAUDE), "juliepdf-models").unwrap();
        assert_eq!(m.len(), 3);
        assert_eq!(m[0].value, "default");
        assert!(m[0].is_default);
        assert_eq!(m[0].label, "Default");
        assert_eq!(m[0].efforts, ["low", "medium", "high", "xhigh", "max"]);
        assert_eq!((m[1].value.as_str(), m[1].is_default), ("opus", false));
        assert_eq!(m[2].value, "haiku");
        assert!(m[2].efforts.is_empty());
        assert_eq!(m[2].description, "Fastest");
    }

    #[test]
    fn claude_other_request_id_or_type_is_ignored() {
        let line = one_line(CLAUDE);
        assert!(parse_claude_models(&line, "someone-else").is_none());
        assert!(parse_claude_models(r#"{"type":"system","subtype":"init"}"#, "juliepdf-models").is_none());
        assert!(parse_claude_models("not json", "juliepdf-models").is_none());
    }

    const CODEX: &str = r#"{"id":2,"result":{"data":[
{"model":"gpt-sol","displayName":"Sol","description":"Fast","hidden":false,"isDefault":true,"supportedReasoningEfforts":[{"reasoningEffort":"low","description":"x"},{"reasoningEffort":"medium","description":"x"},{"reasoningEffort":"ultra","description":"x"}]},
{"model":"gpt-astra","displayName":"Astra","description":"Capable","hidden":false,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"high","description":"x"}]},
{"model":"gpt-old","displayName":"Old","description":"Hidden","hidden":true,"isDefault":false,"supportedReasoningEfforts":[]}]}}"#;

    #[test]
    fn codex_models_skip_hidden_and_ultra() {
        let m = parse_codex_models(&one_line(CODEX)).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(
            m[0],
            CliModel {
                value: "gpt-sol".into(),
                label: "Sol".into(),
                description: "Fast".into(),
                efforts: vec!["low".into(), "medium".into()],
                is_default: true,
                images: true
            }
        );
        assert_eq!(m[1].value, "gpt-astra");
        assert!(!m[1].is_default);
    }

    #[test]
    fn codex_models_report_image_input() {
        let line = r#"{"id":2,"result":{"data":[
{"model":"a","inputModalities":["text","image"]},
{"model":"b","inputModalities":["text"]},
{"model":"c"}]}}"#;
        let m = parse_codex_models(&one_line(line)).unwrap();
        assert_eq!(m.iter().map(|x| x.images).collect::<Vec<_>>(), [true, false, true]);
    }

    #[test]
    fn claude_models_read_images() {
        let m = parse_claude_models(&one_line(CLAUDE), "juliepdf-models").unwrap();
        assert!(m.iter().all(|x| x.images));
    }

    #[test]
    fn codex_other_ids_and_notifications_are_ignored() {
        assert!(parse_codex_models(r#"{"id":1,"result":{"userAgent":"x"}}"#).is_none());
        assert!(parse_codex_models(r#"{"method":"account/updated","params":{}}"#).is_none());
        assert!(parse_codex_models(r#"{"id":2,"error":{"message":"no"}}"#).is_none());
    }

    #[test]
    fn serializes_camel_case() {
        let m = CliModel { value: "a".into(), label: "A".into(), description: "".into(), efforts: vec![], is_default: true, images: true };
        assert!(serde_json::to_string(&m).unwrap().contains(r#""isDefault":true"#));
    }

    #[test]
    fn a_silent_cli_times_out_with_the_readable_message() {
        let p = Program {
            exe: "cmd.exe".into(),
            prefix_args: vec!["/C".into(), "ping -n 20 127.0.0.1 >nul".into()],
        };
        let t = Instant::now();
        let r = fetch_models(&p, CliKind::Claude, &ChildEnv::default(), Duration::from_millis(400));
        assert!(t.elapsed() < Duration::from_secs(8));
        match r {
            Err(AppError::AiCli(m)) => assert_eq!(m, "Could not load the model list from Claude Code."),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_cli_flooding_stderr_still_answers() {
        // 1 MB of warnings on stderr before the answer: far more than a pipe
        // holds, so an unread stderr pipe would block the CLI until the limit.
        let dir = std::env::temp_dir().join(format!("juliepdf-models-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let noise = dir.join("noise.txt");
        let answer = dir.join("answer.jsonl");
        std::fs::write(&noise, "warning: something\r\n".repeat(50_000)).unwrap();
        std::fs::write(&answer, format!("{}\n", one_line(CLAUDE))).unwrap();
        let p = Program {
            exe: "cmd.exe".into(),
            prefix_args: vec![
                "/C".into(),
                // `rem` swallows the model-list arguments appended after it.
                format!("type {} 1>&2 & type {} & rem", noise.display(), answer.display()),
            ],
        };
        let r = fetch_models(&p, CliKind::Claude, &ChildEnv::default(), Duration::from_secs(10));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(r.unwrap().len(), 3);
    }

    /// Manual check against the installed CLIs: `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_clis_list_models() {
        for kind in [CliKind::Claude, CliKind::Codex] {
            let p = super::super::discover::find_default(kind, "").expect("CLI installed");
            let t = Instant::now();
            let env = super::super::args::child_env(kind, &Default::default(), std::env::vars());
            let m = fetch_models(&p, kind, &env, MODELS_LIMIT).unwrap();
            println!("{}: {} models in {:?}: {:?}", kind.name(), m.len(), t.elapsed(), m.iter().map(|x| &x.value).collect::<Vec<_>>());
            assert!(!m.is_empty());
        }
    }
}
