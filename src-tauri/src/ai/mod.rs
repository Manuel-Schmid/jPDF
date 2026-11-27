//! AI explanations through the user's own local Claude Code or Codex CLI.
//! Nothing here runs until the user turns AI on and asks for an explanation.

pub mod args;
pub mod events;
pub mod discover;
pub mod models;
pub mod pictures;
pub mod run;
#[cfg(test)]
mod real_cli;

use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::files::blocking;
use crate::error::AppError;
use args::{CliConfig, CliKind, Secret, child_env, generate_args};
use discover::{CliInfo, find_default, is_desktop_copy, parse_auth_status, parse_version};
use models::{CliModel, MODELS_LIMIT, fetch_models};
use pictures::{PageImage, claude_input, decode_all, file_name};
use run::{Streamed, output_within, run_streaming};
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
/// For Claude it also asks `auth status` (alongside `--version`, so Settings
/// waits for one CLI start, not two), with the environment a generation
/// gets, so the answer matches what a run will find.
fn cli_info(kind: CliKind, custom_path: &str, token: &Secret) -> CliInfo {
    let Some(program) = find_default(kind, custom_path) else {
        return CliInfo::not_found();
    };
    let path = program
        .prefix_args
        .first()
        .cloned()
        .unwrap_or_else(|| program.exe.to_string_lossy().into_owned());
    let env = child_env(kind, token, std::env::vars());
    let ask = |args: &[&str]| {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        output_within(&program, &args, &env, VERSION_LIMIT)
    };
    let (version, status) = std::thread::scope(|s| {
        let status = (kind == CliKind::Claude).then(|| s.spawn(|| ask(&["auth", "status"])));
        let version = ask(&["--version"]).and_then(|out| parse_version(&out));
        let status = status.and_then(|h| h.join().ok().flatten()).and_then(|out| parse_auth_status(&out));
        (version, status)
    });
    let (signed_in, auth_method) = match status {
        Some((signed_in, method)) => (Some(signed_in), method),
        None => (None, None),
    };
    let desktop = is_desktop_copy(&program.exe);
    CliInfo { found: true, path: Some(path), version, signed_in, auth_method, desktop }
}

#[tauri::command]
pub async fn ai_cli_info(cli: CliKind, custom_path: String, token: Option<Secret>) -> CliInfo {
    blocking(move || Ok(cli_info(cli, &custom_path, &token.unwrap_or_default())))
        .await
        .unwrap_or_else(|_| CliInfo::not_found())
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

/// Stdin text and the (name, bytes) files of one run.
type RequestInput = (String, Vec<(String, Vec<u8>)>);

/// What goes to the CLI besides its arguments: the stdin text and the files
/// for its temp dir. Claude reads stream-json on stdin, pictures inline;
/// Codex reads the prompt as plain text and the pictures from files in its
/// cwd. The pictures are validated (count, size, base64) for both, so the
/// safety limits do not depend on which CLI is chosen.
fn request_input(
    kind: CliKind,
    user: &str,
    images: &[PageImage],
) -> Result<RequestInput, AppError> {
    let decoded = decode_all(images)?;
    Ok(match kind {
        CliKind::Claude => (claude_input(user, images), Vec::new()),
        CliKind::Codex => (user.to_string(), decoded.into_iter().map(|(page, bytes)| (file_name(page), bytes)).collect()),
    })
}

/// Runs one generation; the model the CLI reports and every complete answer
/// line are sent on `on_line` (see [`Streamed`]).
/// The token is registered for the whole run so `ai_cli_cancel` can stop it.
/// `images` are the rendered pages that go with the prompt.
#[tauri::command]
pub async fn ai_cli_generate(
    runs: State<'_, CliRuns>,
    request_id: u32,
    config: CliConfig,
    system: String,
    user: String,
    images: Vec<PageImage>,
    on_line: Channel<Streamed>,
) -> Result<Generated, AppError> {
    let token = runs.register(request_id);
    let result = blocking(move || {
        let kind = config.cli;
        let program = find_default(kind, &config.path).ok_or_else(|| not_found(kind))?;
        let pages: Vec<u32> = images.iter().map(|i| i.page).collect();
        let args = generate_args(&config, &system, &pages);
        let (stdin, files) = request_input(kind, &user, &images)?;
        let env = child_env(kind, &config.token, std::env::vars());
        // A closed channel (the window went away) just drops the line, and
        // the count does not include it. The model is no line: not counted.
        let mut lines = 0u32;
        let outcome = run_streaming(&program, &args, &env, &stdin, &files, kind, &token, |event| {
            let is_line = matches!(event, Streamed::Line(_));
            if on_line.send(event).is_ok() && is_line {
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
pub async fn ai_cli_models(cli: CliKind, custom_path: String, token: Option<Secret>) -> Result<Vec<CliModel>, AppError> {
    blocking(move || {
        let program = find_default(cli, &custom_path).ok_or_else(|| not_found(cli))?;
        fetch_models(&program, cli, &child_env(cli, &token.unwrap_or_default(), std::env::vars()), MODELS_LIMIT)
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
    fn streamed_serializes_for_the_frontend() {
        // A line stays a plain string; the model is an object, so the
        // frontend tells them apart by type.
        assert_eq!(serde_json::to_value(Streamed::Line("x".into())).unwrap(), serde_json::json!("x"));
        assert_eq!(
            serde_json::to_value(Streamed::Model { model: "m".into() }).unwrap(),
            serde_json::json!({ "model": "m" }),
        );
    }

    fn picture(page: u32, data: &str) -> PageImage {
        PageImage { page, media_type: "image/jpeg".into(), data: data.into() }
    }

    #[test]
    fn claude_input_is_stream_json_without_files() {
        let (stdin, files) = request_input(CliKind::Claude, "U", &[picture(3, "YWJj")]).unwrap();
        assert_eq!(stdin, claude_input("U", &[picture(3, "YWJj")]));
        assert!(files.is_empty());
    }

    #[test]
    fn codex_input_is_plain_text_with_picture_files() {
        let (stdin, files) = request_input(CliKind::Codex, "U", &[picture(2, "YWJj"), picture(5, "ZGVm")]).unwrap();
        assert_eq!(stdin, "U");
        assert_eq!(files, vec![("page-2.jpg".to_string(), b"abc".to_vec()), ("page-5.jpg".to_string(), b"def".to_vec())]);
    }

    #[test]
    fn both_clis_reject_bad_pictures() {
        let many: Vec<PageImage> = (0..61).map(|p| picture(p, "YWJj")).collect();
        for kind in [CliKind::Claude, CliKind::Codex] {
            assert!(matches!(request_input(kind, "U", &many), Err(AppError::AiCli(m)) if m.starts_with("Too many")));
            assert!(matches!(request_input(kind, "U", &[picture(1, "!!")]), Err(AppError::AiCli(m)) if m.contains("could not be read")));
        }
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
        let info = cli_info(CliKind::Claude, r"C:\does\not\exist\claude.exe", &Secret::default());
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
            &args::ChildEnv::default(),
            "",
            &[],
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
            &args::ChildEnv::default(),
            "",
            &[],
            CliKind::Claude,
            &a,
            |_| {},
        );
        // Request 1 ran (and failed on its own), it was not cancelled.
        assert!(matches!(r, Err(AppError::AiCli(_))));
    }
}
