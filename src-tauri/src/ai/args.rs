//! Command lines and environment for the AI CLIs. Pure functions: spawning
//! lives elsewhere. Every flag here exists to lock the CLI down to "answer
//! from the prompt only" (no tools, no user config, no session files).

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Which local CLI produces the explanation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliKind {
    Claude,
    Codex,
}

impl CliKind {
    /// Human-readable name for error messages.
    pub fn name(self) -> &'static str {
        match self {
            CliKind::Claude => "Claude Code",
            CliKind::Codex => "Codex CLI",
        }
    }

    /// How long stdout may stay silent before the run is declared hung.
    /// Codex gets longer: it can think for minutes before its first line.
    pub fn silence_timeout(self) -> Duration {
        Duration::from_secs(match self {
            CliKind::Claude => 120,
            CliKind::Codex => 300,
        })
    }
}

/// CLI choice as sent by the frontend.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfig {
    pub cli: CliKind,
    /// Executable path; empty means "find it on the system".
    pub path: String,
    /// Model id; empty means the CLI's own default.
    pub model: String,
    /// Reasoning effort; empty means the CLI's own default.
    pub effort: String,
}

/// Arguments for one explanation run; the prompt itself goes to stdin.
/// `pictures` are the pages that come with it: Claude gets them inline on
/// stdin (stream-json input is always on), Codex through one `--image=<file>`
/// per page. The `=` form matters: `--image` is variadic in Codex and would
/// otherwise swallow the following arguments, including the stdin `-`.
pub fn generate_args(cfg: &CliConfig, system: &str, pictures: &[u32]) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    match cfg.cli {
        CliKind::Claude => {
            // Deliberately no `--bare`: it would refuse the user's subscription
            // login. Tools, MCP, settings and slash commands are switched off
            // individually instead.
            push(&[
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--tools",
                "",
                "--no-session-persistence",
                "--strict-mcp-config",
                "--setting-sources",
                "",
                "--disable-slash-commands",
                "--system-prompt",
                system,
            ]);
            if !cfg.model.is_empty() {
                push(&["--model", &cfg.model]);
            }
            if !cfg.effort.is_empty() {
                push(&["--effort", &cfg.effort]);
            }
        }
        CliKind::Codex => {
            push(&[
                "exec",
                "--json",
                "--ephemeral",
                "--ignore-user-config",
                "--ignore-rules",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--disable",
                "shell_tool",
                "--disable",
                "unified_exec",
                "--disable",
                "apps",
                "--disable",
                "browser_use",
                "--disable",
                "code_mode_host",
                "-c",
                "web_search=\"disabled\"",
                "-c",
                "approval_policy=\"never\"",
            ]);
            // A JSON string literal is a valid TOML basic string, so it
            // carries quotes, backslashes and newlines in the system prompt.
            let instructions = serde_json::to_string(system).expect("a str always serializes");
            push(&["-c", &format!("developer_instructions={instructions}")]);
            if !cfg.model.is_empty() {
                push(&["-m", &cfg.model]);
            }
            if !cfg.effort.is_empty() {
                // Escaped like the instructions: a stored effort is user data
                // and must not be able to break out of its TOML string.
                let effort = serde_json::to_string(&cfg.effort).expect("a str always serializes");
                push(&["-c", &format!("model_reasoning_effort={effort}")]);
            }
            for page in pictures {
                push(&[&format!("--image={}", super::pictures::file_name(*page))]);
            }
            // "-" makes codex read the prompt from stdin.
            push(&["-"]);
        }
    }
    a
}

/// Arguments for the short-lived process that lists the available models.
pub fn models_args(kind: CliKind) -> Vec<String> {
    let items: &[&str] = match kind {
        CliKind::Claude => &[
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--setting-sources",
            "",
        ],
        // No `--ignore-user-config` here: `codex app-server` does not accept
        // it (checked with codex-cli 0.172). Listing models reads no prompt
        // and runs no tools, so the user's config cannot do harm here.
        CliKind::Codex => &["app-server"],
    };
    items.iter().map(|s| s.to_string()).collect()
}

/// Variables that make a child Claude Code believe it is nested inside the
/// parent session (or route it through the parent's host).
pub const SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SIMPLE",
    "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_HOST_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_ACCOUNT_UUID",
    "CLAUDE_CODE_ORGANIZATION_UUID",
    "ANTHROPIC_BASE_URL",
];

/// Variables to strip from the child's environment. Only when JuliePDF itself
/// was started from inside Claude Code (`CLAUDECODE` set); otherwise the user's
/// environment, including proxies and tokens, is left untouched.
pub fn env_removals(own_env: impl Iterator<Item = (String, String)>) -> Vec<String> {
    let names: Vec<String> = own_env.map(|(k, _)| k).collect();
    if !names.iter().any(|k| k == "CLAUDECODE") {
        return Vec::new();
    }
    SESSION_VARS
        .iter()
        .filter(|v| names.iter().any(|k| k == *v))
        .map(|v| v.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(cli: CliKind, model: &str, effort: &str) -> CliConfig {
        CliConfig { cli, path: String::new(), model: model.into(), effort: effort.into() }
    }

    fn has_pair(args: &[String], a: &str, b: &str) -> bool {
        args.windows(2).any(|w| w[0] == a && w[1] == b)
    }

    fn has(args: &[String], a: &str) -> bool {
        args.iter().any(|x| x == a)
    }

    fn env(pairs: &[(&str, &str)]) -> impl Iterator<Item = (String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>().into_iter()
    }

    #[test]
    fn claude_args_are_locked_down() {
        let a = generate_args(&cfg(CliKind::Claude, "opus", "medium"), "SYS", &[]);
        for (k, v) in [
            ("--tools", ""),
            ("--setting-sources", ""),
            ("--system-prompt", "SYS"),
            ("--model", "opus"),
            ("--effort", "medium"),
        ] {
            assert!(has_pair(&a, k, v), "missing {k} {v}");
        }
        for f in ["--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "-p"] {
            assert!(has(&a, f), "missing {f}");
        }
        assert!(!has(&a, "--bare"));
    }

    #[test]
    fn claude_args_keep_lockdown_with_stream_input() {
        let a = generate_args(&cfg(CliKind::Claude, "", ""), "SYS", &[]);
        for (k, v) in [("--input-format", "stream-json"), ("--output-format", "stream-json"), ("--tools", ""), ("--setting-sources", "")] {
            assert!(has_pair(&a, k, v), "missing {k} {v}");
        }
        for f in ["--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "-p"] {
            assert!(has(&a, f), "missing {f}");
        }
        // Pictures travel on stdin for Claude, never as arguments.
        let with = generate_args(&cfg(CliKind::Claude, "", ""), "SYS", &[2]);
        assert!(!with.iter().any(|x| x.starts_with("--image")));
    }

    #[test]
    fn codex_image_args_before_stdin_dash() {
        let a = generate_args(&cfg(CliKind::Codex, "", ""), "SYS", &[2, 5]);
        let images: Vec<&String> = a.iter().filter(|x| x.starts_with("--image")).collect();
        assert_eq!(images, ["--image=page-2.jpg", "--image=page-5.jpg"]);
        assert_eq!(a.last().map(String::as_str), Some("-"));
        let last_image = a.iter().rposition(|x| x.starts_with("--image")).unwrap();
        assert_eq!(last_image, a.len() - 2);
    }

    #[test]
    fn no_pictures_no_image_args() {
        for kind in [CliKind::Claude, CliKind::Codex] {
            let a = generate_args(&cfg(kind, "", ""), "SYS", &[]);
            assert!(!a.iter().any(|x| x.starts_with("--image")));
        }
    }

    #[test]
    fn claude_omits_empty_model_and_effort() {
        let a = generate_args(&cfg(CliKind::Claude, "", ""), "SYS", &[]);
        assert!(!has(&a, "--model") && !has(&a, "--effort"));
    }

    #[test]
    fn codex_args_are_locked_down() {
        let a = generate_args(&cfg(CliKind::Codex, "", ""), "SYS", &[]);
        for f in ["--ignore-user-config", "--ignore-rules", "--ephemeral"] {
            assert!(has(&a, f), "missing {f}");
        }
        assert!(has_pair(&a, "--sandbox", "read-only"));
        for d in ["shell_tool", "unified_exec", "code_mode_host", "apps", "browser_use"] {
            assert!(has_pair(&a, "--disable", d), "missing --disable {d}");
        }
        assert!(has_pair(&a, "-c", "web_search=\"disabled\""));
        assert!(has_pair(&a, "-c", "approval_policy=\"never\""));
        assert_eq!(a.last().map(String::as_str), Some("-"));
        assert!(!has(&a, "-m"));
        assert!(!a.iter().any(|x| x.starts_with("model_reasoning_effort")));

        let a = generate_args(&cfg(CliKind::Codex, "gpt-x", "high"), "SYS", &[]);
        assert!(has_pair(&a, "-m", "gpt-x"));
        assert!(has_pair(&a, "-c", "model_reasoning_effort=\"high\""));
        assert_eq!(a.last().map(String::as_str), Some("-"));
    }

    #[test]
    fn codex_instructions_are_a_valid_toml_string() {
        // Quote, backslash and newline: the characters that need escaping.
        let system = format!("a \"q\" {} b\nc", '\u{5c}');
        let a = generate_args(&cfg(CliKind::Codex, "", ""), &system, &[]);
        let arg = a.iter().find(|x| x.starts_with("developer_instructions=")).unwrap();
        let value = &arg["developer_instructions=".len()..];
        assert_eq!(serde_json::from_str::<String>(value).unwrap(), system);
    }

    #[test]
    fn codex_effort_is_a_valid_toml_string() {
        let effort = r#"high" model="x"#;
        let a = generate_args(&cfg(CliKind::Codex, "", effort), "SYS", &[]);
        let arg = a.iter().find(|x| x.starts_with("model_reasoning_effort=")).unwrap();
        let value = &arg["model_reasoning_effort=".len()..];
        assert_eq!(serde_json::from_str::<String>(value).unwrap(), effort);
    }

    #[test]
    fn models_args_per_cli() {
        let claude = models_args(CliKind::Claude);
        assert!(has_pair(&claude, "--input-format", "stream-json"));
        assert!(has_pair(&claude, "--output-format", "stream-json"));
        assert!(has_pair(&claude, "--tools", "") && has_pair(&claude, "--setting-sources", ""));
        for f in ["-p", "--no-session-persistence", "--strict-mcp-config"] {
            assert!(has(&claude, f), "missing {f}");
        }
        // app-server rejects --ignore-user-config, so it is exactly this.
        assert_eq!(models_args(CliKind::Codex), ["app-server"]);
    }

    #[test]
    fn env_untouched_outside_claude_code() {
        let e = env(&[("ANTHROPIC_BASE_URL", "x"), ("CLAUDE_CODE_OAUTH_TOKEN", "t")]);
        assert!(env_removals(e).is_empty());
    }

    #[test]
    fn env_cleaned_inside_claude_code() {
        let e = env(&[
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_SIMPLE", "1"),
            ("ANTHROPIC_BASE_URL", "x"),
            ("CLAUDE_CODE_OAUTH_TOKEN", "t"),
        ]);
        let mut r = env_removals(e);
        r.sort();
        assert_eq!(r, ["ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_SIMPLE"]);
    }

    #[test]
    fn kinds_have_names_and_timeouts() {
        assert_eq!(CliKind::Claude.name(), "Claude Code");
        assert_eq!(CliKind::Codex.name(), "Codex CLI");
        assert_eq!(CliKind::Claude.silence_timeout(), Duration::from_secs(120));
        assert_eq!(CliKind::Codex.silence_timeout(), Duration::from_secs(300));
    }
}
