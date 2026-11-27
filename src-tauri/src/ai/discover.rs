//! Locating the Claude Code / Codex CLI and reading its version.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::args::CliKind;

/// What to spawn. For an npm `.cmd` shim, `exe` is `node.exe` and
/// `prefix_args` holds the JS entry point the shim wraps. The system prompt is
/// passed as an argument (multi-line, quotes), and `cmd /C` would mangle it,
/// so shims are never run through cmd.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub exe: PathBuf,
    pub prefix_args: Vec<String>,
}

/// What Settings shows about a CLI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Claude only: whether `claude auth status` says it is signed in (None:
    /// not asked, or no answer). The desktop app's copy runs, but is signed
    /// in only inside the app until the user signs in once outside it.
    pub signed_in: Option<bool>,
    /// The copy inside the Claude desktop app (see [`find_in_desktop_app`]).
    pub desktop: bool,
}

impl CliInfo {
    pub fn not_found() -> CliInfo {
        CliInfo { found: false, path: None, version: None, signed_in: None, desktop: false }
    }
}

fn base_name(kind: CliKind) -> &'static str {
    match kind {
        CliKind::Claude => "claude",
        CliKind::Codex => "codex",
    }
}

/// Pulls the wrapped script out of an npm shim: the quoted
/// `"%dp0%\<rel>.js"` (or `%~dp0`; `.mjs`/`.cjs` too, or an `.exe` for shims
/// that wrap a native binary) argument, joined onto the shim's directory.
/// The shim's own `node.exe` references are not the wrapped target. `..`
/// segments are resolved (yarn and pnpm shims point into a sibling tree);
/// whether the result exists is checked by the caller.
pub fn shim_script(cmd_text: &str, shim_dir: &Path) -> Option<PathBuf> {
    for marker in ["%dp0%", "%~dp0"] {
        let mut rest = cmd_text;
        while let Some(i) = rest.find(marker) {
            rest = &rest[i + marker.len()..];
            let Some(end) = rest.find('"') else { break };
            let rel = &rest[..end];
            // Only a path that begins right after the variable and names a
            // script or executable; the shim's own `node.exe` is skipped.
            let lower = rel.to_ascii_lowercase();
            let wanted = [".js", ".mjs", ".cjs", ".exe"].iter().any(|e| lower.ends_with(e));
            // Exactly `%dp0%\node.exe`, not any deeper path ending in node.exe.
            let is_node = lower == "\\node.exe" || lower == "/node.exe";
            if !wanted || is_node || !(rel.starts_with('\\') || rel.starts_with('/')) {
                continue;
            }
            let mut path = shim_dir.to_path_buf();
            for part in rel.split(['\\', '/']).filter(|p| !p.is_empty()) {
                match part {
                    "." => {}
                    // Lexically, so the path Settings shows has no `..`; above
                    // the root there is nothing left to point at.
                    ".." => {
                        if !path.pop() {
                            return None;
                        }
                    }
                    _ => path.push(part),
                }
            }
            return Some(path);
        }
    }
    None
}

/// `node.exe` next to the shim, else the first one on PATH.
fn find_node(shim_dir: &Path, path_var: Option<&OsStr>) -> Option<PathBuf> {
    let beside = shim_dir.join("node.exe");
    if beside.is_file() {
        return Some(beside);
    }
    std::env::split_paths(path_var?)
        .map(|d| d.join("node.exe"))
        .find(|p| p.is_file())
}

/// Turns a found file into something spawnable. An unreadable shim, or one
/// without a locatable node, counts as not found rather than a guess.
fn resolve(file: &Path, path_var: Option<&OsStr>) -> Option<Program> {
    let is_cmd = file
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if !is_cmd {
        return Some(Program { exe: file.to_path_buf(), prefix_args: vec![] });
    }
    let dir = file.parent()?;
    let text = std::fs::read_to_string(file).ok()?;
    let script = shim_script(&text, dir)?;
    // A shim whose target is gone would resolve to something that cannot run.
    if !script.is_file() {
        return None;
    }
    // A shim wrapping a native binary needs no node.
    if script.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return Some(Program { exe: script, prefix_args: vec![] });
    }
    let node = find_node(dir, path_var)?;
    Some(Program {
        exe: node,
        prefix_args: vec![script.to_string_lossy().into_owned()],
    })
}

/// Looks for the CLI: `custom` (a file path) first, then PATH entries,
/// `home\.local\bin` (Claude's native install) and `appdata\npm` (npm -g).
/// A non-empty `custom` is authoritative: if it does not resolve the result is
/// `None`, so a mistyped path never silently shows the default CLI as found.
pub fn find(
    kind: CliKind,
    custom: &str,
    path_var: Option<&OsStr>,
    home: Option<&Path>,
    appdata: Option<&Path>,
) -> Option<Program> {
    let custom = custom.trim();
    if !custom.is_empty() {
        let c = Path::new(custom);
        return if c.is_file() { resolve(c, path_var) } else { None };
    }
    let mut dirs: Vec<PathBuf> = path_var.map(|v| std::env::split_paths(v).collect()).unwrap_or_default();
    if let Some(h) = home {
        dirs.push(h.join(".local").join("bin"));
    }
    if let Some(a) = appdata {
        dirs.push(a.join("npm"));
    }
    let base = base_name(kind);
    for dir in dirs.iter().filter(|d| !d.as_os_str().is_empty()) {
        for ext in ["exe", "cmd"] {
            let file = dir.join(format!("{base}.{ext}"));
            if file.is_file()
                && let Some(p) = resolve(&file, path_var)
            {
                return Some(p);
            }
        }
    }
    None
}

/// [`find`] against the real environment, then (for Claude, without a custom
/// path) the copy inside the Claude desktop app ([`find_in_desktop_app`]).
pub fn find_default(kind: CliKind, custom: &str) -> Option<Program> {
    let path = std::env::var_os("PATH");
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    find(kind, custom, path.as_deref(), home.as_deref(), appdata.as_deref()).or_else(|| {
        if kind != CliKind::Claude || !custom.trim().is_empty() {
            return None;
        }
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
        find_in_desktop_app(&local)
    })
}

/// A version folder name (`2.1.331`) as numbers, for ordering; None for other folders.
fn version_key(name: &str) -> Option<Vec<u64>> {
    name.split('.').map(|p| p.parse().ok()).collect()
}

/// Claude Code as the Claude desktop app (Microsoft Store) ships it:
/// `<localappdata>\Claude-Data\claude_<id>\claude-code\<version>\<hash>\claude.exe`.
/// The folder changes with every desktop update, so it is never on PATH and
/// a path typed into Settings would break; it is searched each time instead,
/// newest version first.
pub fn find_in_desktop_app(localappdata: &Path) -> Option<Program> {
    let subdirs = |dir: &Path| -> Vec<PathBuf> {
        std::fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default()
    };
    let mut versions: Vec<(Vec<u64>, PathBuf)> = subdirs(&localappdata.join("Claude-Data"))
        .iter()
        .flat_map(|app| subdirs(&app.join("claude-code")))
        .filter_map(|v| Some((version_key(v.file_name()?.to_str()?)?, v)))
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions.iter().find_map(|(_, v)| {
        subdirs(v)
            .into_iter()
            .map(|d| d.join("claude.exe"))
            .find(|exe| exe.is_file())
            .map(|exe| Program { exe, prefix_args: vec![] })
    })
}

/// Whether `path` is the copy inside the Claude desktop app (see [`find_in_desktop_app`]).
pub fn is_desktop_copy(path: &Path) -> bool {
    let parts: Vec<String> = path.components().map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase()).collect();
    parts.iter().any(|p| p == "claude-data") && parts.iter().any(|p| p == "claude-code")
}

/// Whether `claude auth status` (JSON) says the user is signed in; None when
/// the output is not that JSON (an old CLI without the command).
pub fn parse_signed_in(stdout: &str) -> Option<bool> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    v.get("loggedIn")?.as_bool()
}

/// First token starting with a digit: `2.1.331 (Claude Code)` and
/// `codex-cli 0.172.0` both yield the bare version.
pub fn parse_version(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .find(|t| t.starts_with(|c: char| c.is_ascii_digit()))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The npm shim exactly as written on a real Windows machine.
    const CODEX_SHIM: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*\r\n";

    /// Unique temp dir, removed on drop.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Tmp {
            static N: AtomicUsize = AtomicUsize::new(0);
            let p = std::env::temp_dir().join(format!(
                "juliepdf-discover-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn touch(&self, rel: &str, text: &str) -> PathBuf {
            let p = self.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, text).unwrap();
            p
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_exe_on_path() {
        let t = Tmp::new();
        let exe = t.touch("bin/claude.exe", "");
        let path = std::env::join_paths([t.0.join("bin")]).unwrap();
        let p = find(CliKind::Claude, "", Some(&path), None, None).unwrap();
        assert_eq!(p, Program { exe, prefix_args: vec![] });
    }

    #[test]
    fn finds_in_local_bin_without_path() {
        let t = Tmp::new();
        let exe = t.touch("home/.local/bin/claude.exe", "");
        let p = find(CliKind::Claude, "", None, Some(&t.0.join("home")), None).unwrap();
        assert_eq!(p.exe, exe);
        assert!(p.prefix_args.is_empty());
    }

    #[test]
    fn finds_npm_shim_in_appdata() {
        let t = Tmp::new();
        t.touch("appdata/npm/codex.cmd", CODEX_SHIM);
        let node = t.touch("appdata/npm/node.exe", "");
        t.touch("appdata/npm/node_modules/@openai/codex/bin/codex.js", "");
        let js = t.0.join("appdata").join("npm").join("node_modules").join("@openai").join("codex").join("bin").join("codex.js");
        let p = find(CliKind::Codex, "", None, None, Some(&t.0.join("appdata"))).unwrap();
        assert_eq!(p.exe, node);
        assert_eq!(p.prefix_args, vec![js.to_string_lossy().into_owned()]);
    }

    #[test]
    fn shim_without_adjacent_node_uses_node_on_path() {
        let t = Tmp::new();
        t.touch("appdata/npm/node_modules/@openai/codex/bin/codex.js", "");
        t.touch("appdata/npm/codex.cmd", CODEX_SHIM);
        let node = t.touch("nodedir/node.exe", "");
        let path = std::env::join_paths([t.0.join("nodedir")]).unwrap();
        let p = find(CliKind::Codex, "", Some(&path), None, Some(&t.0.join("appdata"))).unwrap();
        assert_eq!(p.exe, node);
        assert_eq!(p.prefix_args.len(), 1);
    }

    #[test]
    fn unparsable_shim_or_missing_node_is_none() {
        let t = Tmp::new();
        t.touch("a/npm/codex.cmd", "@echo off\r\nrem nothing useful\r\n");
        t.touch("a/npm/node.exe", "");
        assert!(find(CliKind::Codex, "", None, None, Some(&t.0.join("a"))).is_none());
        t.touch("b/npm/codex.cmd", CODEX_SHIM);
        assert!(find(CliKind::Codex, "", Some(OsStr::new("")), None, Some(&t.0.join("b"))).is_none());
    }

    #[test]
    fn custom_path_wins() {
        let t = Tmp::new();
        t.touch("bin/claude.exe", "");
        let custom = t.touch("mine/my-claude.exe", "");
        let path = std::env::join_paths([t.0.join("bin")]).unwrap();
        let p = find(CliKind::Claude, custom.to_str().unwrap(), Some(&path), None, None).unwrap();
        assert_eq!(p.exe, custom);
    }

    #[test]
    fn wrong_custom_path_is_none_even_with_default_installed() {
        let t = Tmp::new();
        t.touch("bin/claude.exe", "");
        let path = std::env::join_paths([t.0.join("bin")]).unwrap();
        let missing = t.0.join("nope").join("claude.exe");
        assert!(find(CliKind::Claude, missing.to_str().unwrap(), Some(&path), None, None).is_none());
    }

    #[test]
    fn shim_wrapping_an_exe_needs_no_node() {
        let t = Tmp::new();
        t.touch("appdata/npm/codex.cmd", "@echo off\r\n\"%dp0%\\vendor\\codex.exe\" %*\r\n");
        let exe = t.0.join("appdata").join("npm").join("vendor").join("codex.exe");
        t.touch("appdata/npm/vendor/codex.exe", "");
        let p = find(CliKind::Codex, "", None, None, Some(&t.0.join("appdata"))).unwrap();
        assert_eq!(p, Program { exe, prefix_args: vec![] });
    }

    #[test]
    fn shim_with_missing_target_is_none() {
        let t = Tmp::new();
        t.touch("a/npm/codex.cmd", "@echo off\r\n\"%dp0%\\vendor\\codex.exe\" %*\r\n");
        assert!(find(CliKind::Codex, "", None, None, Some(&t.0.join("a"))).is_none());
        t.touch("b/npm/codex.cmd", CODEX_SHIM);
        t.touch("b/npm/node.exe", "");
        assert!(find(CliKind::Codex, "", None, None, Some(&t.0.join("b"))).is_none());
    }

    #[test]
    fn shim_script_skips_only_the_shims_own_node() {
        let dir = Path::new("D:\\s");
        let got = shim_script("\"%dp0%\\tools\\node.exe\" %*", dir).unwrap();
        assert_eq!(got, dir.join("tools").join("node.exe"));
    }

    #[test]
    fn shim_script_accepts_mjs_and_cjs() {
        let dir = Path::new("D:\\s");
        assert_eq!(shim_script("\"%dp0%\\a.mjs\" %*", dir).unwrap(), dir.join("a.mjs"));
        assert_eq!(shim_script("\"%dp0%\\a.CJS\" %*", dir).unwrap(), dir.join("a.CJS"));
    }

    #[test]
    fn custom_cmd_with_uppercase_extension_resolves() {
        let t = Tmp::new();
        let cmd = t.touch("mine/CODEX.CMD", CODEX_SHIM);
        t.touch("mine/node_modules/@openai/codex/bin/codex.js", "");
        let node = t.touch("mine/node.exe", "");
        let p = find(CliKind::Codex, cmd.to_str().unwrap(), None, None, None).unwrap();
        assert_eq!(p.exe, node);
        assert_eq!(p.prefix_args.len(), 1);
    }

    #[test]
    fn missing_is_none() {
        let t = Tmp::new();
        let path = std::env::join_paths([t.0.clone()]).unwrap();
        assert!(find(CliKind::Claude, "", Some(&path), Some(&t.0), Some(&t.0)).is_none());
        assert!(find(CliKind::Claude, "", None, None, None).is_none());
    }

    #[test]
    fn shim_script_parses_npm_shim() {
        let dir = Path::new("C:\\nvm4w\\nodejs");
        let got = shim_script(CODEX_SHIM, dir).unwrap();
        assert_eq!(got, dir.join("node_modules").join("@openai").join("codex").join("bin").join("codex.js"));
        let alt = "\"%~dp0\\x\\y.js\" %*";
        assert_eq!(shim_script(alt, dir).unwrap(), dir.join("x").join("y.js"));
        assert!(shim_script("@echo off", dir).is_none());
    }

    #[test]
    fn shim_script_resolves_parent_segments() {
        let dir = Path::new(r"D:\yarn\bin");
        let got = shim_script(r#""%~dp0\..\global\.\node_modules\x\cli.js" %*"#, dir).unwrap();
        assert_eq!(got, Path::new(r"D:\yarn").join("global").join("node_modules").join("x").join("cli.js"));
        // Nothing above the drive root.
        assert!(shim_script(r#""%dp0%\..\..\..\x.js" %*"#, Path::new(r"D:\a")).is_none());
    }

    #[test]
    fn shim_pointing_up_resolves_only_when_the_target_exists() {
        let t = Tmp::new();
        t.touch("pnpm/bin/codex.cmd", "@echo off\r\n\"%dp0%\\..\\store\\codex.exe\" %*\r\n");
        let custom = t.0.join("pnpm").join("bin").join("codex.cmd");
        assert!(find(CliKind::Codex, custom.to_str().unwrap(), None, None, None).is_none());
        let exe = t.touch("pnpm/store/codex.exe", "");
        let p = find(CliKind::Codex, custom.to_str().unwrap(), None, None, None).unwrap();
        assert_eq!(p, Program { exe, prefix_args: vec![] });
    }

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("2.1.331 (Claude Code)\n").as_deref(), Some("2.1.331"));
        assert_eq!(parse_version("codex-cli 0.172.0").as_deref(), Some("0.172.0"));
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn finds_the_desktop_apps_copy_newest_version_first() {
        let t = Tmp::new();
        let root = "Claude-Data/claude_pzs8sxrjxfjjc/claude-code";
        t.touch(&format!("{root}/2.1.9/aaa/claude.exe"), "");
        let newest = t.touch(&format!("{root}/2.1.331/8ceec14ae60c/claude.exe"), "");
        // Newer, but without an executable (an update half done): skipped.
        fs::create_dir_all(t.0.join(root).join("2.2.0").join("bbb")).unwrap();
        // Not a version folder.
        t.touch(&format!("{root}/latest/ccc/claude.exe"), "");
        let p = find_in_desktop_app(&t.0).unwrap();
        assert_eq!(p, Program { exe: newest.clone(), prefix_args: vec![] });
        assert!(is_desktop_copy(&newest));
        assert!(!is_desktop_copy(Path::new(r"C:\Users\x\.local\bin\claude.exe")));
    }

    #[test]
    fn no_desktop_app_means_none() {
        let t = Tmp::new();
        assert!(find_in_desktop_app(&t.0).is_none());
        t.touch("Claude-Data/claude_x/other/file.txt", "");
        assert!(find_in_desktop_app(&t.0).is_none());
    }

    #[test]
    fn parses_sign_in_status() {
        assert_eq!(parse_signed_in("{\n  \"loggedIn\": false,\n  \"authMethod\": \"none\"\n}\n"), Some(false));
        assert_eq!(parse_signed_in("{\"loggedIn\": true}"), Some(true));
        assert_eq!(parse_signed_in("error: unknown command 'auth'"), None);
        assert_eq!(parse_signed_in("{\"other\": 1}"), None);
    }
}
