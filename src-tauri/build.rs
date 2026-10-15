fn main() {
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    // DMP_NO_ADMIN=1 embeds an asInvoker manifest so the app starts without
    // UAC (scans then fall back to the slower directory walk).
    println!("cargo:rerun-if-env-changed=DMP_NO_ADMIN");
    let manifest = include_str!("windows-app-manifest.xml");
    let manifest = if std::env::var_os("DMP_NO_ADMIN").is_some_and(|v| v == "1") {
        manifest.replace("requireAdministrator", "asInvoker")
    } else {
        manifest.to_string()
    };
    let windows = tauri_build::WindowsAttributes::new().app_manifest(manifest);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
