// The app's own commands are named here, so each has a permission of its own
// ("allow-pop-out") and a page gets only the ones its capability grants. The
// capability is made at run time, for the server's origin alone (main.rs).
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["pick_folder", "pop_out", "open_in_browser", "capture"])),
    )
    .expect("failed to run the Tauri build script");
}
