// Prelude as a desktop app: a window on a Prelude server, and the few things
// a page can't do for itself.
//
// It starts no servers. The server runs on this machine (`npm start`) or
// wherever it is deployed, and this is a window pointed at it: `--server
// <url>`, or PRELUDE_URL, or http://localhost:4200.
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

use std::path::PathBuf;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const LOCAL: &str = "http://localhost:4200";
const PREVIEW_HOST: &str = "preview.localhost";

/// Which server this window is on.
fn server() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--server" {
            if let Some(url) = args.next() {
                return url.trim_end_matches('/').to_string();
            }
        }
    }
    std::env::var("PRELUDE_URL")
        .map(|url| url.trim_end_matches('/').to_string())
        .unwrap_or_else(|_| LOCAL.into())
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

    tauri::Builder::default()
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

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("{server_url}/").parse()?))
                .title("Prelude")
                .inner_size(1440.0, 900.0)
                .min_inner_size(480.0, 560.0)
                .initialization_script(&bridge(&server_url))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Prelude could not start");
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
