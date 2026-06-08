use serde::Serialize;
use tauri::{
    include_image, menu::MenuBuilder, tray::TrayIconBuilder, AppHandle, Manager, Runtime,
    WebviewWindow, WindowEvent,
};

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

fn apply_pet_window_mode<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_visible_on_all_workspaces(true);
    apply_native_pet_window_mode(window);
}

#[cfg(windows)]
fn apply_native_pet_window_mode<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let mut ex_style = GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE) as u32;
            ex_style &= !WS_EX_APPWINDOW;
            ex_style |= WS_EX_TOOLWINDOW;

            let _ = SetWindowLongPtrW(hwnd.0, GWL_EXSTYLE, ex_style as isize);
            let _ = SetWindowPos(
                hwnd.0,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(not(windows))]
fn apply_native_pet_window_mode<R: Runtime>(_window: &WebviewWindow<R>) {}

fn show_pet_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        apply_pet_window_mode(&window);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = MenuBuilder::new(app)
                .text("show", "Show")
                .separator()
                .text("quit", "Quit")
                .build()?;

            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::with_id("amadeus")
                    .icon(icon.clone())
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Amadeus")
                    .build(app)?;
            } else {
                TrayIconBuilder::with_id("amadeus")
                    .icon(include_image!("icons/icon.png").clone())
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Amadeus")
                    .build(app)?;
            }

            if let Some(window) = app.get_webview_window("main") {
                apply_pet_window_mode(&window);
                let close_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = close_window.hide();
                    }
                });
            }

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_pet_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            open_chat_window,
            set_pet_window_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
