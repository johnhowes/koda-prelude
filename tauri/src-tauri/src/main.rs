// Prelude as a desktop app: a window on a Prelude server, and the few things
// a page can't do for itself.
//
// Which server: `--server <url>` or PRELUDE_URL names one, running elsewhere
// or started by hand, and the shell only opens a window on it. Otherwise it's
// this machine's, http://localhost:4200: a Prelude already answering there
// (`npm start` while developing) is used as it is, and if none is, the shell
// starts one - `node start.js` in Prelude's folder - shows "Starting Prelude…"
// until it answers, and stops it (with its renderers and design hosts) when
// the shell quits. The server also stops by itself if the shell dies.
//
// The page asks the shell for things through `window.preludeDesktop`, defined
// by a script injected on the server's own origin only and backed by commands
// only that origin is granted. Screens on the preview origin, or anywhere a
// link goes, get no bridge.
//
// What it adds (docs/plan.md, step 4) - each with a web fallback, so the same
// pages work in a browser:
//   - a native folder picker, beside the typed path;
//   - a real window per design for Pop out, which remembers its size and
//     place (on a second monitor, say);
//   - Open in browser in the system's browser, not another app window.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const LOCAL_PORT: u16 = 4200;
const PREVIEW_HOST: &str = "preview.localhost";
const START_TIMEOUT: Duration = Duration::from_secs(60);

/// A command-line option's value: `--name value`.
fn arg(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next();
        }
    }
    None
}

/// The server someone named, if they named one: then the shell starts nothing.
fn named_server() -> Option<String> {
    arg("--server").or_else(|| std::env::var("PRELUDE_URL").ok()).map(|url| url.trim_end_matches('/').to_string())
}

/// Which server this window is on.
fn server() -> String {
    named_server().unwrap_or_else(|| format!("http://localhost:{LOCAL_PORT}"))
}

// --- this machine's server --------------------------------------------------

/// The server the shell started, to stop when it quits.
struct LocalServer(Mutex<Option<Child>>);

fn local_address(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Whether a Prelude server answers on this port (and not something else).
fn answers_as_prelude(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&local_address(port), Duration::from_millis(500)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut answer = String::new();
    let _ = stream.read_to_string(&mut answer);
    is_prelude_health(&answer)
}

/// A 200 whose body says "prelude" (with or without chunked framing around it).
fn is_prelude_health(answer: &str) -> bool {
    answer.starts_with("HTTP/1.1 200") && answer.split_once("\r\n\r\n").is_some_and(|(_, body)| body.contains("prelude"))
}

fn port_taken(port: u16) -> bool {
    TcpStream::connect_timeout(&local_address(port), Duration::from_millis(500)).is_ok()
}

/// Prelude's own folder, where start.js is: `--root`, PRELUDE_ROOT, or the
/// nearest folder above the shell's executable that has it (the shell is
/// built into Prelude's dist-shell/).
fn prelude_root() -> Option<PathBuf> {
    let is_prelude = |dir: &std::path::Path| dir.join("start.js").is_file() && dir.join("server").join("main.js").is_file();
    if let Some(root) = arg("--root").or_else(|| std::env::var("PRELUDE_ROOT").ok()).map(PathBuf::from) {
        return is_prelude(&root).then_some(root);
    }
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().skip(1).find(|dir| is_prelude(dir)).map(PathBuf::from)
}

/// Where the server's output goes: Prelude's machine-local folder, as the server's own state does.
fn log_path() -> PathBuf {
    let home = std::env::var("PRELUDE_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        let user = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
        PathBuf::from(user).join(".prelude")
    });
    let _ = fs::create_dir_all(&home);
    home.join("server.log")
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

fn start_server(root: &std::path::Path, port: u16) -> Result<Child, String> {
    let log = File::create(log_path()).map_err(|error| format!("Couldn't write the server's log: {error}"))?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let node = std::env::var("PRELUDE_NODE").unwrap_or_else(|_| "node".into());
    hidden(
        Command::new(&node)
            .arg("start.js")
            .current_dir(root)
            .env("PORT", port.to_string())
            .env("PRELUDE_PARENT_PID", std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(errors),
    )
    .spawn()
    .map_err(|error| format!("Couldn't start Node ({node}): {error}.\nPrelude needs Node 22 or later on the PATH, or PRELUDE_NODE set to it."))
}

/// Stop the server and everything it started: its renderers and design hosts.
fn stop_server(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = hidden(Command::new("taskkill").args(["/pid", &child.id().to_string(), "/t", "/f"])).status();
    }
    #[cfg(not(windows))]
    {
        // SIGTERM: start.js closes the server, which stops what it started.
        let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
    }
    let _ = child.wait();
}

/// The last lines of the server's log, for a failure message.
fn log_tail() -> String {
    let text = fs::read_to_string(log_path()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(8)..].join("\n")
}

/// Say what went wrong on the window's starting page, in its address's
/// fragment: the page shows it once loaded, however early this runs.
fn show_failure(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(mut url) = window.url() {
            url.set_fragment(Some(message));
            let _ = window.navigate(url);
        }
    }
}

/// Start this machine's server, wait for it, and move the window onto it.
fn start_local(app: AppHandle, port: u16) {
    // First let the window load its starting page, which any message goes on.
    let loading = Instant::now();
    while loading.elapsed() < Duration::from_secs(10) {
        let loaded = app.get_webview_window("main").and_then(|window| window.url().ok()).is_some_and(|url| url.scheme() != "about");
        if loaded {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let Some(root) = prelude_root() else {
        return show_failure(&app, "Couldn't find Prelude's folder (the one with start.js). Start the app from Prelude's dist-shell folder, or pass --root <folder> or set PRELUDE_ROOT.");
    };
    if port_taken(port) {
        return show_failure(&app, &format!("Something other than Prelude is using port {port}. Stop it, or start Prelude elsewhere and open it with --server <url>."));
    }
    let child = match start_server(&root, port) {
        Ok(child) => child,
        Err(message) => return show_failure(&app, &message),
    };
    let state = app.state::<LocalServer>();
    *state.0.lock().unwrap() = Some(child);

    let started = Instant::now();
    loop {
        if answers_as_prelude(port) {
            if let (Some(window), Ok(url)) = (app.get_webview_window("main"), format!("http://localhost:{port}/").parse::<Url>()) {
                let _ = window.navigate(url);
            }
            return;
        }
        let exited = state.0.lock().unwrap().as_mut().and_then(|child| child.try_wait().ok().flatten());
        if let Some(status) = exited {
            *state.0.lock().unwrap() = None;
            return show_failure(&app, &format!("Prelude's server stopped ({status}):\n\n{}\n\nThe whole log is in {}.", log_tail(), log_path().display()));
        }
        if started.elapsed() > START_TIMEOUT {
            return show_failure(&app, &format!("Prelude's server didn't answer within {} seconds. Its log is in {}.", START_TIMEOUT.as_secs(), log_path().display()));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn origin_of(url: &str) -> String {
    match url.splitn(2, "://").collect::<Vec<_>>().as_slice() {
        [scheme, tail] => format!("{}://{}", scheme, tail.split('/').next().unwrap_or("")),
        _ => url.to_string(),
    }
}

/// `window.preludeDesktop`, on the server's origin and nowhere else.
fn bridge(server: &str) -> String {
    format!(
        r#"
(() => {{
  if (location.origin !== {origin:?}) return;
  const tauri = window.__TAURI__;
  if (!tauri) return;
  const invoke = (command, args) => tauri.core.invoke(command, args);
  window.preludeDesktop = {{
    // The shell's own folder dialog. The person picks; the page gets the path
    // they picked, or null.
    pickFolder: () => invoke('pick_folder'),
    // A window of its own for a design's surface, one per design (`name`),
    // brought forward if it is already open.
    popOut: (url, name) => invoke('pop_out', {{ url, name }}),
    // A screen in the system's browser.
    openInBrowser: url => invoke('open_in_browser', {{ url }}),
  }};
}})();
"#,
        origin = origin_of(server)
    )
}

fn same_origin(url: &Url, server: &Url) -> bool {
    url.scheme() == server.scheme() && url.host_str() == server.host_str() && url.port_or_known_default() == server.port_or_known_default()
}

/// A pop-out is the server's own `…/window` page, and nothing a page could be
/// tricked into naming elsewhere.
fn may_pop_out(url: &Url, server: &Url) -> bool {
    same_origin(url, server) && url.path().starts_with("/f/") && url.path().ends_with("/window")
}

/// The system browser opens this server's pages and its preview origin's, over http(s).
fn may_open_in_browser(url: &Url, server: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && (same_origin(url, server) || (url.host_str() == Some(PREVIEW_HOST) && url.port_or_known_default() == server.port_or_known_default()))
}

/// A window label from the page's window name: letters, digits and dashes only.
fn label_for(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).take(80).collect();
    format!("design-{clean}")
}

// --- what the server's pages may ask ---------------------------------------

/// Async, like every command that waits on a dialog or makes a window: on
/// Windows, doing either from a synchronous command can deadlock the event loop.
#[tauri::command]
async fn pick_folder(window: WebviewWindow) -> Option<String> {
    window
        .dialog()
        .file()
        .set_title("Open a folder in Prelude")
        .set_parent(&window)
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path: PathBuf| path.display().to_string())
}

#[tauri::command]
async fn pop_out(app: AppHandle, url: String, name: String) -> Result<(), String> {
    let target: Url = url.parse().map_err(|_| format!("{url} is not an address"))?;
    let server: Url = server().parse().map_err(|_| "the server's address is not an address".to_string())?;
    if !may_pop_out(&target, &server) {
        return Err(format!("{url} is not one of this server's design windows"));
    }
    let label = label_for(&name);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    // The window-state plugin puts it back where it was last time.
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(target))
        .title("Prelude · design")
        .inner_size(1100.0, 800.0)
        .min_inner_size(360.0, 360.0)
        .initialization_script(&bridge(&server.to_string()))
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_in_browser(app: AppHandle, url: String) -> Result<(), String> {
    let target: Url = url.parse().map_err(|_| format!("{url} is not an address"))?;
    let server: Url = server().parse().map_err(|_| "the server's address is not an address".to_string())?;
    if !may_open_in_browser(&target, &server) {
        return Err(format!("{url} is not this server's or its preview's"));
    }
    app.opener().open_url(target.as_str(), None::<&str>).map_err(|error| error.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let server_url = server();
    // This machine's server, and none answering yet: the shell starts one.
    let start_one = named_server().is_none() && !answers_as_prelude(LOCAL_PORT);

    let app = tauri::Builder::default()
        .manage(LocalServer(Mutex::new(None)))
        // One Prelude: a second launch brings the first forward.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Every window - the main one and each design's - opens where it was.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![pick_folder, pop_out, open_in_browser])
        .setup(move |app| {
            // The bridge, for the server's origin alone: a capability made from
            // the URL this shell was started with, rather than a pattern that
            // would also grant it to whatever else runs on localhost.
            app.add_capability(
                CapabilityBuilder::new("server")
                    .windows(["*"])
                    .remote(format!("{}/*", origin_of(&server_url)))
                    .permission("allow-pick-folder")
                    .permission("allow-pop-out")
                    .permission("allow-open-in-browser"),
            )?;

            // Starting a server opens on the shell's own "Starting Prelude…" page.
            let first = if start_one { WebviewUrl::App("index.html".into()) } else { WebviewUrl::External(format!("{server_url}/").parse()?) };
            WebviewWindowBuilder::new(app, "main", first)
                .title("Prelude")
                .inner_size(1440.0, 900.0)
                .min_inner_size(480.0, 560.0)
                .initialization_script(&bridge(&server_url))
                .build()?;
            if start_one {
                let handle = app.handle().clone();
                std::thread::spawn(move || start_local(handle, LOCAL_PORT));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Prelude could not start");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = app.state::<LocalServer>().0.lock().unwrap().take() {
                stop_server(&mut child);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(u: &str) -> Url {
        u.parse().unwrap()
    }

    #[test]
    fn pop_outs_are_this_servers_design_windows_only() {
        let server = url("http://localhost:4200");
        assert!(may_pop_out(&url("http://localhost:4200/f/abc/d/onboarding/sign-up/window"), &server));
        assert!(!may_pop_out(&url("http://localhost:4200/f/abc/d/x/preview"), &server));
        assert!(!may_pop_out(&url("http://localhost:4201/f/abc/d/x/window"), &server));
        assert!(!may_pop_out(&url("http://preview.localhost:4200/f/abc/d/x/window"), &server));
        assert!(!may_pop_out(&url("https://example.com/f/x/window"), &server));
    }

    #[test]
    fn the_browser_opens_this_server_and_its_preview_only() {
        let server = url("http://localhost:4200");
        assert!(may_open_in_browser(&url("http://preview.localhost:4200/f/a/d/b/files/screens/01.html"), &server));
        assert!(may_open_in_browser(&url("http://localhost:4200/"), &server));
        assert!(!may_open_in_browser(&url("http://preview.localhost:9999/x"), &server));
        assert!(!may_open_in_browser(&url("file:///C:/Windows/notepad.exe"), &server));
        assert!(!may_open_in_browser(&url("https://example.com"), &server));
    }

    #[test]
    fn only_a_prelude_server_counts_as_one() {
        assert!(is_prelude_health("HTTP/1.1 200 OK\r\ncontent-length: 7\r\n\r\nprelude"));
        assert!(is_prelude_health("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\nprelude\r\n0\r\n\r\n"));
        assert!(!is_prelude_health("HTTP/1.1 404 Not Found\r\n\r\nprelude"));
        assert!(!is_prelude_health("HTTP/1.1 200 OK\r\n\r\n<!doctype html><title>Something else</title>"));
        assert!(!is_prelude_health(""));
    }

    #[test]
    fn labels_are_safe_and_one_per_design() {
        assert_eq!(label_for("prelude-abc-onboarding-sign-up"), "design-prelude-abc-onboarding-sign-up");
        assert_eq!(label_for("a/b c"), "design-a-b-c");
    }

    #[test]
    fn the_bridge_is_for_the_server_origin_only() {
        assert_eq!(origin_of("http://localhost:4200/f/x"), "http://localhost:4200");
        let script = bridge("http://localhost:4200");
        assert!(script.contains("if (location.origin !== \"http://localhost:4200\") return;"));
        for command in ["pick_folder", "pop_out", "open_in_browser"] {
            assert!(script.contains(command));
        }
    }
}
