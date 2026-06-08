use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    stage: &'static str,
    hermes_mode: &'static str,
    tts_mode: &'static str,
    renderer_mode: &'static str,
}

#[tauri::command]
fn get_app_status() -> AppStatus {
    AppStatus {
        stage: "stage-6-v0-integration-skeleton",
        hermes_mode: "mock",
        tts_mode: "mock",
        renderer_mode: "static-fallback",
    }
}

#[tauri::command]
fn open_chat_window() -> bool {
    true
}

#[tauri::command]
fn set_pet_window_mode(mode: String) -> String {
    match mode.as_str() {
        "pet" | "chat" | "compact" => mode,
        _ => "chat".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_skip_taskbar(true);
                let _ = window.set_visible_on_all_workspaces(true);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            open_chat_window,
            set_pet_window_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
