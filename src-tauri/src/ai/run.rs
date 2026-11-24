//! Running the AI CLI: one process per request, its stdout streamed line by
//! line, cancel and a silence timeout that kill the whole process tree, and
//! failures turned into readable messages. Blocking: the commands call it
//! inside `spawn_blocking`.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::args::CliKind;
use super::discover::Program;
use super::events::{Event, LineSplitter, parse_line};
use crate::error::AppError;

/// No console window flashes up for the CLI (or `taskkill`).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How much of the end of stderr is kept for the error message.
const STDERR_KEEP: usize = 4096;

/// How long a CLI that already sent its result may take to exit on its own
/// before its tree is killed; also how long to wait for its stderr.
const EXIT_GRACE: Duration = Duration::from_secs(2);

/// How a run ended when it did not fail.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Done,
    /// The model hit its output limit; the lines so far were delivered.
    Truncated,
    Cancelled,
}

/// A fresh empty working directory for one CLI run, so the CLI never sees
/// the PDF's folder (or any project config). Removed on drop; a failure to
/// remove (a straggler still holding it) is ignored.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    fn new() -> std::io::Result<TempDir> {
        static N: AtomicUsize = AtomicUsize::new(0);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "{}{}-{nanos}",
            own_dir_prefix(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir)?;
        Ok(TempDir(dir))
    }
}

/// The name prefix of this process's run directories.
fn own_dir_prefix() -> String {
    format!("juliepdf-ai-{}-", std::process::id())
}

/// Removes this process's run directories that are still there: on exit,
/// after [`CliRuns::cancel_all`], when the run threads may never get to drop
/// their [`TempDir`]. Other processes' directories are left alone.
pub fn remove_own_temp_dirs() {
    remove_dirs_starting_with(&std::env::temp_dir(), &own_dir_prefix());
}

/// Removes the entries of `parent` whose name starts with `prefix`;
/// failures (a straggler still holding one) are ignored.
fn remove_dirs_starting_with(parent: &std::path::Path, prefix: &str) {
    let Ok(entries) = std::fs::read_dir(parent) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(prefix) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Spawns `program` with `args` appended to its prefix arguments: all three
/// standard streams piped, a fresh temp dir as working dir, the `removals`
/// env vars removed and no console window. Shared with the model lists.
pub(crate) fn spawn_cli(program: &Program, args: &[String], removals: &[String]) -> Result<(Child, TempDir), AppError> {
    spawn_with_stderr(program, args, removals, Stdio::piped())
}

/// [`spawn_cli`] with a choice for stderr: a caller that never reads it
/// passes `Stdio::null()`, so a chatty CLI cannot block on a full pipe.
pub(crate) fn spawn_with_stderr(
    program: &Program,
    args: &[String],
    removals: &[String],
    stderr: Stdio,
) -> Result<(Child, TempDir), AppError> {
    let dir = TempDir::new().map_err(|e| AppError::Io(e.to_string()))?;
    let mut cmd = Command::new(&program.exe);
    cmd.args(&program.prefix_args)
        .args(args)
        .current_dir(&dir.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr);
    for name in removals {
        cmd.env_remove(name);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| AppError::AiCli(format!("Could not start {}: {e}", program.exe.display())))?;
    Ok((child, dir))
}

/// Kills `pid` and everything it started: an npm shim's `node`, and whatever
/// the CLI itself spawned. Errors (already gone) are ignored.
pub(crate) fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/T", "/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd.status();
}

#[derive(Default)]
struct CancelState {
    /// The running CLI, while there is one.
    pid: Option<u32>,
    cancelled: bool,
}

/// Cancels one run from another thread. A cancel that arrives before the
/// process exists is remembered, and the run then never starts it.
#[derive(Default, Clone)]
pub struct CancelToken(Arc<Mutex<CancelState>>);

impl CancelToken {
    fn state(&self) -> MutexGuard<'_, CancelState> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Marks the run cancelled and kills its process tree, if running.
    pub fn cancel(&self) {
        let mut s = self.state();
        s.cancelled = true;
        if let Some(pid) = s.pid {
            kill_tree(pid);
        }
    }

    fn is_cancelled(&self) -> bool {
        self.state().cancelled
    }

    /// Records the started process; `false` when a cancel came first (the
    /// caller then kills it). Done under the lock so a cancel in between
    /// cannot be lost.
    fn attach(&self, pid: u32) -> bool {
        let mut s = self.state();
        if s.cancelled {
            return false;
        }
        s.pid = Some(pid);
        true
    }

    fn detach(&self) {
        self.state().pid = None;
    }
}

/// How long a cancel that arrived before its run (no live run with that id)
/// waits for the run to register.
const TOMBSTONE_TTL: Duration = Duration::from_secs(30);

/// How many finished request ids are remembered, so a cancel that arrives
/// just after its run ended is recognised as late rather than early.
const RECENT_FINISHED: usize = 64;

#[derive(Default)]
struct Runs {
    /// Runs in flight.
    live: HashMap<u32, CancelToken>,
    /// Cancels that overtook their generate call, with when they arrived.
    early: HashMap<u32, Instant>,
    /// The most recently finished ids, oldest first.
    finished: VecDeque<u32>,
}

/// The cancel tokens of the runs in flight, by the frontend's request id.
/// A cancel can race its run at both ends: before the run registers (kept
/// as a short-lived tombstone the run then picks up) and after it finished
/// (ignored, so no tombstone can cancel a later run that reuses the id, e.g.
/// after a webview reload restarts the frontend's counter).
#[derive(Default)]
pub struct CliRuns(Mutex<Runs>);

impl CliRuns {
    fn state(&self) -> MutexGuard<'_, Runs> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts tracking `id` and returns its token, already cancelled if an
    /// early cancel for it is waiting.
    pub fn register(&self, id: u32) -> CancelToken {
        self.register_at(id, Instant::now())
    }

    fn register_at(&self, id: u32, now: Instant) -> CancelToken {
        let mut runs = self.state();
        runs.early.retain(|_, at| now.duration_since(*at) < TOMBSTONE_TTL);
        runs.finished.retain(|&f| f != id);
        let token = CancelToken::default();
        if runs.early.remove(&id).is_some() {
            token.cancel(); // no PID yet: only sets the flag
        }
        runs.live.insert(id, token.clone());
        token
    }

    /// Stops tracking `id` and remembers it as finished.
    pub fn finish(&self, id: u32) {
        let mut runs = self.state();
        runs.live.remove(&id);
        runs.finished.retain(|&f| f != id);
        runs.finished.push_back(id);
        if runs.finished.len() > RECENT_FINISHED {
            runs.finished.pop_front();
        }
    }

    /// The token to cancel for `id`, if its run is live. The caller cancels
    /// it after the lock is released (that runs `taskkill`). For an unknown
    /// id that did not just finish, an early cancel is recorded instead.
    pub fn cancel_target(&self, id: u32) -> Option<CancelToken> {
        self.cancel_target_at(id, Instant::now())
    }

    /// Cancels every live run (the app is exiting) and returns how many it
    /// stopped. The trees are killed here, synchronously and outside the
    /// lock: the run threads may not reach their own cleanup before the
    /// process ends, and an orphaned CLI would keep using the user's plan.
    pub fn cancel_all(&self) -> usize {
        let tokens: Vec<CancelToken> = self.state().live.values().filter(|t| !t.is_cancelled()).cloned().collect();
        for token in &tokens {
            token.cancel();
        }
        tokens.len()
    }

    fn cancel_target_at(&self, id: u32, now: Instant) -> Option<CancelToken> {
        let mut runs = self.state();
        if let Some(token) = runs.live.get(&id) {
            return Some(token.clone());
        }
        if !runs.finished.contains(&id) {
            runs.early.insert(id, now);
        }
        None
    }
}

/// A started CLI. On drop the token forgets the PID before the process
/// handle is closed (Windows keeps a PID reserved only while a handle is
/// open, so a late cancel can never hit a recycled PID), and a process still
/// running is killed with its tree.
struct Running<'a> {
    child: Child,
    token: &'a CancelToken,
}

impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.token.detach();
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            kill_tree(self.child.id());
            let _ = self.child.wait();
        }
    }
}

/// Runs one generation: `stdin` is the prompt, every complete answer line
/// goes to `on_line`. See [`run_with_timeout`].
pub fn run_streaming(
    program: &Program,
    args: &[String],
    removals: &[String],
    stdin: &str,
    kind: CliKind,
    cancel: &CancelToken,
    on_line: impl FnMut(String),
) -> Result<Outcome, AppError> {
    run_with_timeout(program, args, removals, stdin, kind, cancel, kind.silence_timeout(), on_line)
}

/// [`run_streaming`] with the silence timeout as a parameter (for tests).
///
/// A result event ends the run (`Done`/`Truncated`, or the CLI's own error
/// text). Without one, the reason is, in order: the silence timeout, a
/// cancel, the last warning the CLI sent, the last stderr line, the exit code.
#[allow(clippy::too_many_arguments)]
fn run_with_timeout(
    program: &Program,
    args: &[String],
    removals: &[String],
    stdin: &str,
    kind: CliKind,
    cancel: &CancelToken,
    silence: Duration,
    mut on_line: impl FnMut(String),
) -> Result<Outcome, AppError> {
    if cancel.is_cancelled() {
        return Ok(Outcome::Cancelled);
    }
    let (child, _dir) = spawn_cli(program, args, removals)?;
    let pid = child.id();
    let mut run = Running { child, token: cancel };
    if !cancel.attach(pid) {
        return Ok(Outcome::Cancelled); // `Running` kills it on drop
    }

    // The prompt goes in on its own thread: a big one can fill the pipe while
    // the CLI is already writing stdout, which nobody would read otherwise.
    // Dropping the handle at the end closes stdin, so the CLI starts.
    if let Some(mut input) = run.child.stdin.take() {
        let bytes = stdin.as_bytes().to_vec();
        thread::spawn(move || {
            let _ = input.write_all(&bytes);
        });
    }
    let stderr = run.child.stderr.take().map(spawn_tail_reader);

    // Watchdog: every stdout line resets it; silence for too long kills the
    // tree, which ends the read loop below (the pipe closes).
    let (beat, beats) = mpsc::channel::<()>();
    let timed_out = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let timed_out = timed_out.clone();
        thread::spawn(move || {
            loop {
                match beats.recv_timeout(silence) {
                    Ok(()) => {}
                    Err(RecvTimeoutError::Timeout) => {
                        timed_out.store(true, Ordering::SeqCst);
                        kill_tree(pid);
                        return;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        })
    };

    let mut splitter = LineSplitter::default();
    let mut warning = None;
    let mut result = None;
    if let Some(stdout) = run.child.stdout.take() {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            // `read_until` and a lossy conversion: one invalid byte must not
            // end the stream the way `lines()` would.
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let _ = beat.send(());
            let line = String::from_utf8_lossy(&buf);
            match parse_line(kind, line.trim_end()) {
                Some(Event::Text(t)) => splitter.feed(&t).into_iter().for_each(&mut on_line),
                Some(Event::Finished { truncated }) => {
                    splitter.finish().into_iter().for_each(&mut on_line);
                    result = Some(Ok(if truncated { Outcome::Truncated } else { Outcome::Done }));
                    break;
                }
                Some(Event::Failed(m)) => {
                    result = Some(Err(AppError::AiCli(m)));
                    break;
                }
                Some(Event::Warning(m)) => warning = Some(m),
                None => {}
            }
        }
    }
    drop(beat);
    let _ = watchdog.join();

    if let Some(result) = result {
        // The answer is complete; give the CLI a moment to exit by itself,
        // then `Running` kills whatever is left.
        wait_briefly(&mut run.child, EXIT_GRACE);
        return result;
    }
    // Cancel first: if the watchdog fired while the user also cancelled,
    // the cancel is what they expect to see.
    if cancel.is_cancelled() {
        return Ok(Outcome::Cancelled);
    }
    if timed_out.load(Ordering::SeqCst) {
        return Err(AppError::AiCli(format!("{} stopped responding.", kind.name())));
    }
    if let Some(m) = warning {
        return Err(AppError::AiCli(m));
    }
    // stdout closed, so the CLI is normally exiting; but a read error can
    // end the loop early and the watchdog is gone now, so the wait is
    // bounded (a CLI still running is killed by `Running` on drop).
    wait_briefly(&mut run.child, EXIT_GRACE);
    let code = run.child.try_wait().ok().flatten().and_then(|s| s.code());
    // A grandchild may still hold stderr open: wait for it only briefly.
    let stderr = stderr.and_then(|rx| rx.recv_timeout(EXIT_GRACE).ok()).unwrap_or_default();
    if let Some(line) = last_line(&stderr) {
        return Err(AppError::AiCli(line));
    }
    Err(AppError::AiCli(match code {
        Some(code) if code != 0 => format!("{} exited with code {code}.", kind.name()),
        _ => format!("{} ended without an answer.", kind.name()),
    }))
}

/// Reads a stream to its end on its own thread, keeping only the last
/// [`STDERR_KEEP`] bytes, and sends them as text when done.
fn spawn_tail_reader(mut stream: impl Read + Send + 'static) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut tail = Vec::new();
        let mut chunk = [0u8; 4096];
        while let Ok(n) = stream.read(&mut chunk) {
            if n == 0 {
                break;
            }
            tail.extend_from_slice(&chunk[..n]);
            if tail.len() > STDERR_KEEP {
                tail.drain(..tail.len() - STDERR_KEEP);
            }
        }
        let _ = tx.send(String::from_utf8_lossy(&tail).into_owned());
    });
    rx
}

/// The last non-blank line of `text`, trimmed.
fn last_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).rfind(|l| !l.is_empty()).map(str::to_owned)
}

/// Waits up to `limit` for `child` to exit by itself.
pub(crate) fn wait_briefly(child: &mut Child, limit: Duration) {
    let step = Duration::from_millis(50);
    let mut waited = Duration::ZERO;
    while waited < limit {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(step);
        waited += step;
    }
}

/// Runs `program args` with stdin closed and returns its stdout, or `None`
/// if it cannot start or does not finish within `limit` (its tree is then
/// killed). For quick queries such as `--version`.
pub(crate) fn output_within(program: &Program, args: &[String], limit: Duration) -> Option<String> {
    let (mut child, _dir) = spawn_with_stderr(program, args, &[], Stdio::null()).ok()?;
    drop(child.stdin.take());
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut out = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut out);
        let _ = tx.send(String::from_utf8_lossy(&out).into_owned());
    });
    let out = rx.recv_timeout(limit).ok();
    if out.is_some() {
        // stdout closed: normally the process is exiting already.
        wait_briefly(&mut child, EXIT_GRACE);
    }
    if !matches!(child.try_wait(), Ok(Some(_))) {
        kill_tree(child.id());
    }
    // Bounded: the process exited or was just force-killed.
    let _ = child.wait();
    out
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    /// Unique temp dir for fixtures, removed on drop.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Tmp {
            static N: AtomicUsize = AtomicUsize::new(0);
            let p = std::env::temp_dir().join(format!(
                "juliepdf-run-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn write(&self, name: &str, bytes: &[u8]) -> String {
            let p = self.0.join(name);
            fs::write(&p, bytes).unwrap();
            p.to_string_lossy().into_owned()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A fake CLI: `cmd /C <args>`.
    fn cmd(args: &[&str]) -> Program {
        let mut prefix_args = vec!["/C".to_string()];
        prefix_args.extend(args.iter().map(|a| a.to_string()));
        Program { exe: "cmd.exe".into(), prefix_args }
    }

    /// A fake CLI that prints a recorded stdout.
    fn printing(t: &Tmp, lines: &[&str]) -> Program {
        let path = t.write("out.jsonl", lines.join("\n").as_bytes());
        cmd(&["type", &path])
    }

    fn run(program: &Program, kind: CliKind) -> (Result<Outcome, AppError>, Vec<String>) {
        let mut lines = Vec::new();
        let r = run_streaming(program, &[], &[], "prompt", kind, &CancelToken::default(), |l| lines.push(l));
        (r, lines)
    }

    fn ai_err(r: Result<Outcome, AppError>) -> String {
        match r {
            Err(AppError::AiCli(m)) => m,
            other => panic!("expected AiCli error, got {other:?}"),
        }
    }

    /// A fake CLI that starts a grandchild (PowerShell), which writes its PID
    /// to `pidfile` and then sleeps.
    fn sleeping(pidfile: &str) -> Program {
        cmd(&[
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("$PID | Out-File -Encoding ascii '{pidfile}'; Start-Sleep 30"),
        ])
    }

    fn wait_for_pid(pidfile: &str) -> u32 {
        pid_if_written(pidfile, Duration::from_secs(15)).unwrap_or_else(|| panic!("the fake CLI never wrote its PID"))
    }

    /// The grandchild's PID once it wrote it, or None after `within`. PowerShell
    /// can take several seconds to start on a busy CI machine, so a test with a
    /// short time limit may kill the tree before the PID is ever written.
    fn pid_if_written(pidfile: &str, within: Duration) -> Option<u32> {
        let start = Instant::now();
        while start.elapsed() < within {
            if let Ok(text) = fs::read_to_string(pidfile)
                && let Ok(pid) = text.trim().parse()
            {
                return Some(pid);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }

    fn process_exists(pid: u32) -> bool {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).split_whitespace().any(|t| t == pid.to_string())
    }

    const CLAUDE_DELTA_A: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"page\":1,\"text\":\"a\"}\n{\"page\":2,"}}}"#;
    const CLAUDE_DELTA_B: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\"text\":\"b\"}"}}}"#;

    #[test]
    fn streams_claude_lines() {
        let t = Tmp::new();
        let p = printing(&t, &[
            r#"{"type":"system","subtype":"init"}"#,
            CLAUDE_DELTA_A,
            CLAUDE_DELTA_B,
            r#"{"type":"result","is_error":false,"stop_reason":"end_turn","result":"x"}"#,
        ]);
        let (r, lines) = run(&p, CliKind::Claude);
        assert_eq!(r.unwrap(), Outcome::Done);
        // The second line has no line break: the result flushes it.
        assert_eq!(lines, vec![r#"{"page":1,"text":"a"}"#, r#"{"page":2,"text":"b"}"#]);
    }

    #[test]
    fn claude_max_tokens_is_truncated() {
        let t = Tmp::new();
        let p = printing(&t, &[CLAUDE_DELTA_A, r#"{"type":"result","is_error":false,"stop_reason":"max_tokens"}"#]);
        let (r, lines) = run(&p, CliKind::Claude);
        assert_eq!(r.unwrap(), Outcome::Truncated);
        assert_eq!(lines, vec![r#"{"page":1,"text":"a"}"#, r#"{"page":2,"#]);
    }

    #[test]
    fn non_ascii_text_survives_and_invalid_utf8_does_not_fail() {
        let t = Tmp::new();
        let mut out = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"text\":\"Grüße\"}\n"}}}"#
            .as_bytes()
            .to_vec();
        out.extend_from_slice(b"\n\xff\xfe garbage\n");
        out.extend_from_slice(br#"{"type":"result","is_error":false}"#);
        let path = t.write("out.jsonl", &out);
        let (r, lines) = run(&cmd(&["type", &path]), CliKind::Claude);
        assert_eq!(r.unwrap(), Outcome::Done);
        assert_eq!(lines, vec![r#"{"text":"Grüße"}"#]);
    }

    #[test]
    fn claude_error_result_becomes_message() {
        let t = Tmp::new();
        let p = printing(&t, &[
            r#"{"type":"result","is_error":true,"api_error_status":401,"result":"Failed to authenticate: run claude auth login"}"#,
        ]);
        let m = ai_err(run(&p, CliKind::Claude).0);
        assert!(m.starts_with("Failed to authenticate"), "{m}");
    }

    #[test]
    fn codex_message_lines() {
        let t = Tmp::new();
        let p = printing(&t, &[
            r#"{"type":"thread.started","thread_id":"t1"}"#,
            r#"{"type":"error","message":"Reconnecting... 1/5"}"#,
            r#"{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"{\"page\":1,\"text\":\"a\"}\n{\"page\":2,\"text\":\"b\"}"}}"#,
            r#"{"type":"turn.completed","usage":{}}"#,
        ]);
        let (r, lines) = run(&p, CliKind::Codex);
        // The transient warning before a finished turn is no error.
        assert_eq!(r.unwrap(), Outcome::Done);
        assert_eq!(lines, vec![r#"{"page":1,"text":"a"}"#, r#"{"page":2,"text":"b"}"#]);
    }

    #[test]
    fn codex_turn_failed_is_error() {
        let t = Tmp::new();
        let p = printing(&t, &[r#"{"type":"turn.failed","error":{"message":"usage limit reached"}}"#]);
        assert_eq!(ai_err(run(&p, CliKind::Codex).0), "usage limit reached");
    }

    #[test]
    fn codex_last_warning_explains_an_unfinished_run() {
        let t = Tmp::new();
        let p = printing(&t, &[
            r#"{"type":"error","message":"Reconnecting... 1/5"}"#,
            r#"{"type":"error","message":"stream disconnected before completion"}"#,
        ]);
        assert_eq!(ai_err(run(&p, CliKind::Codex).0), "stream disconnected before completion");
    }

    #[test]
    fn exit_without_result_reports_stderr() {
        let p = cmd(&["echo", "boom", "1>&2", "&", "exit", "3"]);
        assert_eq!(ai_err(run(&p, CliKind::Claude).0), "boom");
    }

    #[test]
    fn exit_without_result_or_stderr_reports_code() {
        let p = cmd(&["exit", "7"]);
        assert_eq!(ai_err(run(&p, CliKind::Codex).0), "Codex CLI exited with code 7.");
    }

    #[test]
    fn stdin_reaches_the_cli() {
        // `findstr` echoes the stdin lines that match: the prompt is a whole
        // Claude event stream, so what comes back proves the pipe works, also
        // for a prompt larger than the pipe buffer.
        let mut big = String::new();
        for _ in 0..20_000 {
            big.push_str("{\"type\":\"system\",\"pad\":\"xxxxxxxxxxxxxxxx\"}\n");
        }
        big.push_str(CLAUDE_DELTA_A);
        big.push('\n');
        big.push_str(r#"{"type":"result","is_error":false}"#);
        big.push('\n');
        let mut lines = Vec::new();
        let r = run_streaming(
            &cmd(&["findstr", "type"]),
            &[],
            &[],
            &big,
            CliKind::Claude,
            &CancelToken::default(),
            |l| lines.push(l),
        );
        assert_eq!(r.unwrap(), Outcome::Done);
        assert_eq!(lines, vec![r#"{"page":1,"text":"a"}"#, r#"{"page":2,"#]);
    }

    #[test]
    fn removed_env_vars_do_not_reach_the_cli() {
        // SAFETY: the variable name is unique to this test.
        unsafe { std::env::set_var("JULIEPDF_RUN_TEST_VAR", "leaked") };
        let (child, _dir) = spawn_cli(
            &cmd(&["echo", "[%JULIEPDF_RUN_TEST_VAR%]"]),
            &[],
            &["JULIEPDF_RUN_TEST_VAR".to_string()],
        )
        .unwrap();
        let out = child.wait_with_output().unwrap();
        // cmd leaves an undefined %VAR% as is.
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "[%JULIEPDF_RUN_TEST_VAR%]");
    }

    #[test]
    fn runs_in_a_fresh_temp_dir_that_is_removed() {
        let (child, dir) = spawn_cli(&cmd(&["cd"]), &[], &[]).unwrap();
        let path = dir.0.clone();
        let out = child.wait_with_output().unwrap();
        let cwd = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(PathBuf::from(&cwd), path);
        assert!(path.starts_with(std::env::temp_dir()));
        drop(dir);
        assert!(!path.exists());
    }

    #[test]
    fn cancel_kills_the_process_tree() {
        let t = Tmp::new();
        let pidfile = t.0.join("pid.txt").to_string_lossy().into_owned();
        let token = CancelToken::default();
        let canceller = {
            let token = token.clone();
            let pidfile = pidfile.clone();
            std::thread::spawn(move || {
                let pid = wait_for_pid(&pidfile);
                token.cancel();
                (pid, Instant::now())
            })
        };
        let r = run_streaming(&sleeping(&pidfile), &[], &[], "", CliKind::Claude, &token, |_| {});
        let (grandchild, cancelled_at) = canceller.join().unwrap();
        assert_eq!(r.unwrap(), Outcome::Cancelled);
        assert!(cancelled_at.elapsed() < Duration::from_secs(5));
        assert!(!process_exists(grandchild), "PowerShell {grandchild} survived the cancel");
    }

    #[test]
    fn cancel_of_a_live_run_returns_its_token() {
        let runs = CliRuns::default();
        let token = runs.register(1);
        let target = runs.cancel_target(1).expect("live token");
        target.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_all_cancels_every_live_run() {
        let runs = CliRuns::default();
        let a = runs.register(1);
        let b = runs.register(2);
        let done = runs.register(3);
        runs.finish(3);
        assert_eq!(runs.cancel_all(), 2);
        assert!(a.is_cancelled() && b.is_cancelled());
        assert!(!done.is_cancelled(), "a finished run is not touched");
        // Already cancelled: a second exit event has nothing left to stop.
        assert_eq!(runs.cancel_all(), 0);
    }

    #[test]
    fn cancel_all_kills_a_running_tree() {
        let t = Tmp::new();
        let pidfile = t.0.join("pid.txt").to_string_lossy().into_owned();
        let runs = Arc::new(CliRuns::default());
        let token = runs.register(1);
        let killer = {
            let runs = runs.clone();
            let pidfile = pidfile.clone();
            std::thread::spawn(move || {
                let pid = wait_for_pid(&pidfile);
                runs.cancel_all();
                pid
            })
        };
        let r = run_streaming(&sleeping(&pidfile), &[], &[], "", CliKind::Claude, &token, |_| {});
        let grandchild = killer.join().unwrap();
        assert_eq!(r.unwrap(), Outcome::Cancelled);
        assert!(!process_exists(grandchild), "PowerShell {grandchild} survived cancel_all");
    }

    #[test]
    fn leftover_run_dirs_of_this_process_are_removed() {
        let t = Tmp::new();
        for name in ["juliepdf-ai-7-0-1", "juliepdf-ai-7-1-2", "juliepdf-ai-70-0-1", "other"] {
            fs::create_dir_all(t.0.join(name).join("sub")).unwrap();
        }
        remove_dirs_starting_with(&t.0, "juliepdf-ai-7-");
        let mut left: Vec<String> =
            fs::read_dir(&t.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["juliepdf-ai-70-0-1", "other"]);
        assert!(own_dir_prefix().starts_with(&format!("juliepdf-ai-{}-", std::process::id())));
    }

    #[test]
    fn early_cancel_is_picked_up_by_register() {
        let runs = CliRuns::default();
        assert!(runs.cancel_target(3).is_none());
        assert!(runs.register(3).is_cancelled());
        // Consumed: a later run with the id is not cancelled.
        runs.finish(3);
        assert!(!runs.register(3).is_cancelled());
    }

    #[test]
    fn cancel_after_finish_leaves_no_tombstone() {
        // Cancel clicked just as the run ended, then the id comes again
        // (the frontend's counter restarts after a reload).
        let runs = CliRuns::default();
        runs.register(5);
        runs.finish(5);
        assert!(runs.cancel_target(5).is_none());
        assert!(!runs.register(5).is_cancelled());
    }

    #[test]
    fn early_cancel_expires() {
        let runs = CliRuns::default();
        let t0 = Instant::now();
        assert!(runs.cancel_target_at(9, t0).is_none());
        assert!(!runs.register_at(9, t0 + TOMBSTONE_TTL + Duration::from_secs(1)).is_cancelled());
        // Expired tombstones are dropped, not just ignored.
        assert!(runs.state().early.is_empty());
    }

    #[test]
    fn finished_ids_are_bounded() {
        let runs = CliRuns::default();
        for id in 0..(RECENT_FINISHED as u32 + 10) {
            runs.register(id);
            runs.finish(id);
        }
        assert_eq!(runs.state().finished.len(), RECENT_FINISHED);
        assert!(runs.state().live.is_empty());
        // The oldest id fell out, so a cancel for it counts as early again.
        assert!(runs.cancel_target(0).is_none());
        assert!(runs.register(0).is_cancelled());
    }

    #[test]
    fn cancel_and_timeout_at_once_reports_cancelled() {
        // The watchdog fires while the run is also cancelled: the user's
        // cancel wins.
        let t = Tmp::new();
        let pidfile = t.0.join("pid.txt").to_string_lossy().into_owned();
        let token = CancelToken::default();
        let canceller = {
            let token = token.clone();
            std::thread::spawn(move || {
                // Wait until the CLI is running (its PID is attached), not for
                // PowerShell: on a slow machine PowerShell may not start before
                // the 5 s limit, and the race being tested is cancel vs. timeout.
                let start = Instant::now();
                while token.state().pid.is_none() && start.elapsed() < Duration::from_secs(15) {
                    std::thread::sleep(Duration::from_millis(20));
                }
                // Mark only (no kill), so the timeout does the killing.
                token.state().cancelled = true;
            })
        };
        let r = run_with_timeout(&sleeping(&pidfile), &[], &[], "", CliKind::Claude, &token, Duration::from_secs(5), |_| {});
        canceller.join().unwrap();
        assert_eq!(r.unwrap(), Outcome::Cancelled);
    }

    #[test]
    fn cancel_before_spawn_is_cancelled() {
        let token = CancelToken::default();
        token.cancel();
        let t = Tmp::new();
        let marker = t.0.join("ran.txt").to_string_lossy().into_owned();
        let p = cmd(&["echo", "x", ">", &marker]);
        let r = run_streaming(&p, &[], &[], "", CliKind::Claude, &token, |_| {});
        assert_eq!(r.unwrap(), Outcome::Cancelled);
        assert!(!std::path::Path::new(&marker).exists(), "the CLI was started");
    }

    #[test]
    fn silence_kills_the_tree_and_reports() {
        let t = Tmp::new();
        let pidfile = t.0.join("pid.txt").to_string_lossy().into_owned();
        let r = run_with_timeout(
            &sleeping(&pidfile),
            &[],
            &[],
            "",
            CliKind::Claude,
            &CancelToken::default(),
            Duration::from_secs(5),
            |_| {},
        );
        assert_eq!(ai_err(r), "Claude Code stopped responding.");
        let grandchild = wait_for_pid(&pidfile);
        assert!(!process_exists(grandchild), "PowerShell {grandchild} survived the timeout");
    }

    #[test]
    fn output_within_reads_stdout() {
        let out = output_within(&cmd(&["echo", "2.1.331", "(Claude", "Code)"]), &[], Duration::from_secs(10));
        assert_eq!(out.unwrap().trim(), "2.1.331 (Claude Code)");
    }

    #[test]
    fn output_within_gives_up_and_kills() {
        let t = Tmp::new();
        let pidfile = t.0.join("pid.txt").to_string_lossy().into_owned();
        let start = Instant::now();
        assert_eq!(output_within(&sleeping(&pidfile), &[], Duration::from_secs(5)), None);
        assert!(start.elapsed() < Duration::from_secs(10));
        // A PowerShell that survived would still write its PID; one killed
        // before it started never does, which also passes.
        if let Some(grandchild) = pid_if_written(&pidfile, Duration::from_secs(10)) {
            assert!(!process_exists(grandchild), "PowerShell {grandchild} survived the time limit");
        }
    }
}
