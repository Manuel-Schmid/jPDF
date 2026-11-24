//! AI explanations through the user's own local Claude Code or Codex CLI.
//! Nothing here runs until the user turns AI on and asks for an explanation.

pub mod args;
pub mod events;
pub mod discover;
pub mod models;
pub mod run;
#[cfg(test)]
mod real_cli;

use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::files::blocking;
use crate::error::AppError;
use args::{CliConfig, CliKind, env_removals, generate_args};
use discover::{CliInfo, find_default, parse_version};
use models::{CliModel, MODELS_LIMIT, fetch_models};
use run::{output_within, run_streaming};
pub use run::{CancelToken, CliRuns, Outcome};

/// How long `--version` may take before the CLI counts as not answering.
const VERSION_LIMIT: Duration = Duration::from_secs(10);

/// The error for a CLI that is not installed (or whose custom path is wrong).
fn not_found(kind: CliKind) -> AppError {
    AppError::AiCli(format!("{} was not found. Install it, or set its path in Settings → AI.", kind.name()))
}

/// What Settings shows for `kind`. `path` is the file the user would
/// recognise: for an npm shim the script it wraps rather than `node.exe`.
/// A CLI that is found but does not answer `--version` in time stays
/// `found`, without a version.
fn cli_info(kind: CliKind, custom_path: &str) -> CliInfo {
    let Some(program) = find_default(kind, custom_path) else {
        return CliInfo { found: false, path: None, version: None };
    };
    let path = program
        .prefix_args
        .first()
        .cloned()
        .unwrap_or_else(|| program.exe.to_string_lossy().into_owned());
    let version = output_within(&program, &["--version".to_string()], VERSION_LIMIT).and_then(|out| parse_version(&out));
    CliInfo { found: true, path: Some(path), version }
}

#[tauri::command]
pub async fn ai_cli_info(cli: CliKind, custom_path: String) -> CliInfo {
    blocking(move || Ok(cli_info(cli, &custom_path)))
        .await
        .unwrap_or(CliInfo { found: false, path: None, version: None })
}

/// How a generation ended, and how many lines it sent on the channel.
/// Channel messages and the command's answer reach the frontend separately,
/// so the answer can overtake the last lines; with the count the frontend
/// waits for them before it treats the answer as complete.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Generated {
    pub outcome: Outcome,
    pub lines: u32,
}

/// Runs one generation; every complete answer line is sent on `on_line`.
/// The token is registered for the whole run so `ai_cli_cancel` can stop it.
#[tauri::command]
pub async fn ai_cli_generate(
    runs: State<'_, CliRuns>,
    request_id: u32,
    config: CliConfig,
    system: String,
    user: String,
    on_line: Channel<String>,
) -> Result<Generated, AppError> {
    let token = runs.register(request_id);
    let result = blocking(move || {
        let kind = config.cli;
        let program = find_default(kind, &config.path).ok_or_else(|| not_found(kind))?;
        let args = generate_args(&config, &system);
        let removals = env_removals(std::env::vars());
        // A closed channel (the window went away) just drops the line, and
        // the count does not include it.
        let mut lines = 0u32;
        let outcome = run_streaming(&program, &args, &removals, &user, kind, &token, |line| {
            if on_line.send(line).is_ok() {
                lines += 1;
            }
        })?;
        Ok(Generated { outcome, lines })
    })
    .await;
    runs.finish(request_id);
    result
}

/// The models `cli` offers, asked of the CLI itself. A CLI that is not
/// installed gives the usual not-found message.
#[tauri::command]
pub async fn ai_cli_models(cli: CliKind, custom_path: String) -> Result<Vec<CliModel>, AppError> {
    blocking(move || {
        let program = find_default(cli, &custom_path).ok_or_else(|| not_found(cli))?;
        fetch_models(&program, cli, &env_removals(std::env::vars()), MODELS_LIMIT)
    })
    .await
}

/// Async and off the main thread: the kill runs `taskkill`, which would
/// otherwise hitch the UI. The map lock is released before it runs.
#[tauri::command]
pub async fn ai_cli_cancel(runs: State<'_, CliRuns>, request_id: u32) -> Result<(), AppError> {
    if let Some(token) = runs.cancel_target(request_id) {
        blocking(move || {
            token.cancel();
            Ok(())
        })
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_serializes_for_the_frontend() {
        let g = Generated { outcome: Outcome::Truncated, lines: 3 };
        assert_eq!(serde_json::to_value(&g).unwrap(), serde_json::json!({ "outcome": "truncated", "lines": 3 }));
    }

    #[test]
    fn not_found_message() {
        match not_found(CliKind::Codex) {
            AppError::AiCli(m) => {
                assert_eq!(m, "Codex CLI was not found. Install it, or set its path in Settings → AI.")
            }
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn info_for_a_missing_custom_path() {
        let info = cli_info(CliKind::Claude, r"C:\does\not\exist\claude.exe");
        assert!(!info.found);
        assert_eq!((info.path, info.version), (None, None));
    }

    #[test]
    fn cancel_before_generate_is_picked_up() {
        let runs = CliRuns::default();
        assert!(runs.cancel_target(7).is_none());
        let token = runs.register(7);
        // The run sees the earlier cancel and never starts the CLI.
        let r = run_streaming(
            &discover::Program { exe: "cmd.exe".into(), prefix_args: vec!["/C".into(), "exit".into(), "0".into()] },
            &[],
            &[],
            "",
            CliKind::Claude,
            &token,
            |_| {},
        );
        assert!(matches!(r, Ok(Outcome::Cancelled)));
    }

    #[test]
    fn register_gives_each_request_its_own_token() {
        let runs = CliRuns::default();
        let a = runs.register(1);
        let _b = runs.register(2);
        runs.cancel_target(2).unwrap().cancel();
        let r = run_streaming(
            &discover::Program { exe: "cmd.exe".into(), prefix_args: vec!["/C".into(), "exit".into(), "4".into()] },
            &[],
            &[],
            "",
            CliKind::Claude,
            &a,
            |_| {},
        );
        // Request 1 ran (and failed on its own), it was not cancelled.
        assert!(matches!(r, Err(AppError::AiCli(_))));
    }
}
