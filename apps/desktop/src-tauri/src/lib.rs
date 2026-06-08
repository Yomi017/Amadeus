use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    include_image, menu::MenuBuilder, tray::TrayIconBuilder, window::Color, AppHandle, Manager,
    Runtime, WebviewWindow, WindowEvent,
};

const HERMES_SOURCE: &str = "amadeus-desktop-pet";
const HERMES_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_USER_TEXT_LENGTH: usize = 2_000;
const MAX_HERMES_REPLY_LENGTH: usize = 4_000;
const MAX_TTS_TEXT_LENGTH: usize = 500;
const DEFAULT_TTS_ENDPOINT: &str = "http://127.0.0.1:48162";
const TTS_TIMEOUT: Duration = Duration::from_secs(180);

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
        hermes_mode: "real-cli",
        tts_mode: "http",
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendChatMessageRequest {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantReplyDto {
    id: String,
    role: &'static str,
    text: String,
    speech_text_ja: String,
    emotion: String,
    created_at: String,
    source: &'static str,
    status_detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HermesJsonReply {
    reply_text: Option<String>,
    speech_text_ja: Option<String>,
    emotion: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsRequestDto {
    id: String,
    text: String,
    locale: Option<String>,
    voice: Option<String>,
    emotion: Option<String>,
    speed: Option<f64>,
    top_p: Option<f64>,
    temperature: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsServiceResultDto {
    id: String,
    request_id: String,
    audio_url: String,
    format: Option<String>,
    mime_type: Option<String>,
    created_at: Option<String>,
    duration_ms: Option<u64>,
    cached: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsResultDto {
    id: String,
    request_id: String,
    source: &'static str,
    audio_url: String,
    format: String,
    mime_type: String,
    created_at: String,
    duration_ms: Option<u64>,
    cached: Option<bool>,
}

#[tauri::command]
fn send_chat_message(request: SendChatMessageRequest) -> Result<AssistantReplyDto, String> {
    let user_text = clean_user_text(&request.text, MAX_USER_TEXT_LENGTH)?;
    let prompt = build_hermes_prompt(&user_text);
    let output = run_hermes_chat(&prompt)?;
    let parsed = parse_hermes_reply(&output)?;
    let reply_text = clean_model_text(
        parsed
            .reply_text
            .as_deref()
            .unwrap_or(output.trim())
            .trim(),
        MAX_HERMES_REPLY_LENGTH,
    )?;
    let speech_text_ja = clean_model_text(
        parsed
            .speech_text_ja
            .as_deref()
            .unwrap_or(reply_text.as_str())
            .trim(),
        MAX_TTS_TEXT_LENGTH,
    )?;

    if reply_text.is_empty() || speech_text_ja.is_empty() {
        return Err("Hermes returned an empty reply".to_string());
    }

    Ok(AssistantReplyDto {
        id: format!("hermes-{}", stable_hash(&reply_text)),
        role: "assistant",
        text: reply_text,
        speech_text_ja,
        emotion: normalize_emotion(parsed.emotion.as_deref()),
        created_at: utc_now_string(),
        source: "hermes",
        status_detail: "Hermes reply received".to_string(),
    })
}

#[tauri::command]
fn synthesize_speech(request: TtsRequestDto) -> Result<TtsResultDto, String> {
    let endpoint = std::env::var("AMADEUS_TTS_ENDPOINT").unwrap_or_else(|_| DEFAULT_TTS_ENDPOINT.to_string());
    let parsed_endpoint = parse_loopback_http_endpoint(&endpoint)?;
    let text = clean_user_text(&request.text, MAX_TTS_TEXT_LENGTH)?;
    if text.is_empty() {
        return Err("TTS text is empty".to_string());
    }

    let request_id = safe_request_id(&request.id);
    let body = serde_json::json!({
        "id": request_id,
        "text": text,
        "locale": request.locale.unwrap_or_else(|| "ja".to_string()),
        "voice": request.voice,
        "emotion": request.emotion,
        "speed": request.speed,
        "topP": request.top_p,
        "temperature": request.temperature
    })
    .to_string();
    let service_result = post_loopback_json(&parsed_endpoint, "/synthesize", &body, TTS_TIMEOUT)?;
    let value: TtsServiceResultDto =
        serde_json::from_str(&service_result).map_err(|_| "GPT-SoVITS returned invalid JSON".to_string())?;
    let audio_url = clean_audio_url(&value.audio_url)?;
    if !is_allowed_tts_audio_url(&audio_url, parsed_endpoint.port) {
        return Err("GPT-SoVITS returned an unsupported audio URL".to_string());
    }

    Ok(TtsResultDto {
        id: clean_model_text(&value.id, 160)?,
        request_id: clean_model_text(&value.request_id, 160)?,
        source: "gpt-sovits",
        audio_url,
        format: value.format.unwrap_or_else(|| "wav".to_string()),
        mime_type: value.mime_type.unwrap_or_else(|| "audio/wav".to_string()),
        created_at: value.created_at.unwrap_or_else(utc_now_string),
        duration_ms: value.duration_ms,
        cached: value.cached,
    })
}

fn build_hermes_prompt(user_text: &str) -> String {
    format!(
        r#"You are Amadeus, a concise desktop-pet assistant with a refined galgame tone.
Respond to the user's message and return only compact JSON. No markdown, no commentary.

Required JSON keys:
{{"replyText":"visible answer","speechTextJa":"Japanese text for TTS","emotion":"neutral|soft|happy|focused"}}

Rules:
- replyText should answer naturally in the user's language.
- speechTextJa must be a Japanese version spoken before TTS.
- Preserve protected tokens exactly in speechTextJa: code spans, URLs, file paths, commands, env vars, package names, model names, identifiers with underscores, numbers, versions, and bracketed placeholders.
- Do not include secrets, private file paths, credentials, logs, or token values.
- Keep both texts short enough for one desktop-pet bubble.

User message:
<<<
{}
>>>"#,
        user_text
    )
}

fn run_hermes_chat(prompt: &str) -> Result<String, String> {
    let script = format!(
        "export PATH=\"$HOME/.local/bin:$PATH\"\nprompt=\"$(cat)\"\nexec hermes chat -q \"$prompt\" -Q --source {} --max-turns 6",
        HERMES_SOURCE
    );
    let mut command = if cfg!(windows) {
        let mut command = Command::new("wsl.exe");
        command.args(["bash", "-lc", &script]);
        command
    } else {
        let mut command = Command::new("bash");
        command.args(["-lc", &script]);
        command
    };

    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("Hermes failed to start: {}", error))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|error| format!("Hermes stdin failed: {}", error))?;
    }

    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("Hermes wait failed: {}", error))?
            .is_some()
        {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("Hermes output failed: {}", error))?;
            if !output.status.success() {
                return Err(safe_process_error("Hermes command failed", &output.stderr));
            }

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() {
                return Err("Hermes returned no output".to_string());
            }
            return Ok(stdout);
        }

        if started.elapsed() > HERMES_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Hermes timed out".to_string());
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn parse_hermes_reply(output: &str) -> Result<HermesJsonReply, String> {
    let trimmed = output.trim();
    if let Ok(parsed) = serde_json::from_str::<HermesJsonReply>(trimmed) {
        return Ok(parsed);
    }

    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(parsed) = serde_json::from_str::<HermesJsonReply>(&trimmed[start..=end]) {
                return Ok(parsed);
            }
        }
    }

    Ok(HermesJsonReply {
        reply_text: Some(trimmed.to_string()),
        speech_text_ja: None,
        emotion: Some("soft".to_string()),
    })
}

#[derive(Debug)]
struct LoopbackEndpoint {
    host: String,
    port: u16,
}

fn parse_loopback_http_endpoint(endpoint: &str) -> Result<LoopbackEndpoint, String> {
    let rest = endpoint
        .strip_prefix("http://")
        .ok_or_else(|| "TTS endpoint must be a local HTTP URL".to_string())?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port_text) = authority
        .rsplit_once(':')
        .ok_or_else(|| "TTS endpoint must include a port".to_string())?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err("TTS endpoint must be loopback".to_string());
    }
    let port = port_text
        .parse::<u16>()
        .map_err(|_| "TTS endpoint port is invalid".to_string())?;
    Ok(LoopbackEndpoint {
        host: host.to_string(),
        port,
    })
}

fn post_loopback_json(endpoint: &LoopbackEndpoint, path: &str, body: &str, timeout: Duration) -> Result<String, String> {
    let mut stream = std::net::TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .map_err(|_| "GPT-SoVITS service is not reachable".to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| "Failed to set GPT-SoVITS read timeout".to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| "Failed to set GPT-SoVITS write timeout".to_string())?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        endpoint.host,
        endpoint.port,
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| "Failed to send GPT-SoVITS request".to_string())?;

    let mut response = String::new();
    std::io::Read::read_to_string(&mut stream, &mut response)
        .map_err(|_| "Failed to read GPT-SoVITS response".to_string())?;

    let (headers, response_body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "GPT-SoVITS returned an invalid HTTP response".to_string())?;
    let status_line = headers.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err("GPT-SoVITS synthesis failed".to_string());
    }

    Ok(response_body.to_string())
}

fn clean_user_text(text: &str, max_length: usize) -> Result<String, String> {
    let cleaned = text.replace('\0', "").trim().to_string();
    if cleaned.chars().count() > max_length {
        return Err(format!("Text exceeds {} characters", max_length));
    }
    if contains_unsafe_private_data(&cleaned) {
        return Err("Text contains private data that Amadeus will not send".to_string());
    }
    Ok(cleaned)
}

fn clean_model_text(text: &str, max_length: usize) -> Result<String, String> {
    let cleaned = text.replace('\0', "").trim().to_string();
    if cleaned.chars().count() > max_length {
        return Err(format!("Text exceeds {} characters", max_length));
    }
    if contains_unsafe_private_data(&cleaned) {
        return Err("Service returned unsafe private data".to_string());
    }
    Ok(cleaned)
}

fn clean_audio_url(text: &str) -> Result<String, String> {
    let cleaned = text.replace('\0', "").trim().to_string();
    if cleaned.len() > MAX_HERMES_REPLY_LENGTH {
        return Err("Audio URL is too long".to_string());
    }
    if contains_secret_like_data(&cleaned) {
        return Err("Service returned unsafe private data".to_string());
    }
    Ok(cleaned)
}

fn contains_unsafe_private_data(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if contains_secret_like_data(&lower) {
        return true;
    }

    if lower.contains("raw_extracted") || lower.contains(".env") || lower.contains(".hermes") {
        return true;
    }

    let has_private_extension = [".ogg", ".wav", ".mp3", ".ckpt", ".pth", ".safetensors", ".psd"]
        .iter()
        .any(|extension| lower.contains(extension));
    if !has_private_extension {
        return false;
    }

    [
        "/home/",
        "/users/",
        "/mnt/c/users/",
        "c:\\users\\",
        "\\\\wsl$\\",
        "\\\\wsl.localhost\\",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn contains_secret_like_data(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "authorization:",
        "bearer ",
        "api_key",
        "apikey",
        "token=",
        "token:",
        "secret=",
        "secret:",
        "cookie=",
        "credential",
        "password=",
        "github_pat",
        "ghp_",
        "sk-",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn safe_process_error(label: &str, stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() || contains_unsafe_private_data(&message) {
        return label.to_string();
    }
    format!("{}: {}", label, message.chars().take(240).collect::<String>())
}

fn normalize_emotion(value: Option<&str>) -> String {
    match value.unwrap_or("soft").trim() {
        "neutral" | "soft" | "happy" | "focused" => value.unwrap_or("soft").trim().to_string(),
        _ => "soft".to_string(),
    }
}

fn safe_request_id(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' || character == '.' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = normalized.trim_matches(['.', '-']).chars().take(80).collect::<String>();
    if trimmed.is_empty() {
        format!("speech-{}", stable_hash(value))
    } else {
        trimmed
    }
}

fn is_allowed_tts_audio_url(value: &str, port: u16) -> bool {
    let expected_prefix = format!("http://127.0.0.1:{}/audio/", port);
    value.starts_with(&expected_prefix) && value.ends_with(".wav") && !value.contains("..")
}

fn stable_hash(input: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{:08x}", hash)
}

fn utc_now_string() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    iso_utc_from_unix_millis(now.as_secs(), now.subsec_millis())
}

fn iso_utc_from_unix_millis(seconds: u64, millis: u32) -> String {
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, millis
    )
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }

    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hermes_json_inside_extra_text() {
        let parsed = parse_hermes_reply(
            r#"ignored {"replyText":"可以打开。","speechTextJa":"開けます。","emotion":"focused"} ignored"#,
        )
        .expect("reply should parse");

        assert_eq!(parsed.reply_text.as_deref(), Some("可以打开。"));
        assert_eq!(parsed.speech_text_ja.as_deref(), Some("開けます。"));
        assert_eq!(parsed.emotion.as_deref(), Some("focused"));
    }

    #[test]
    fn only_accepts_loopback_tts_endpoint() {
        assert!(parse_loopback_http_endpoint("http://127.0.0.1:48162").is_ok());
        assert!(parse_loopback_http_endpoint("http://localhost:48162").is_ok());
        assert!(parse_loopback_http_endpoint("https://127.0.0.1:48162").is_err());
        assert!(parse_loopback_http_endpoint("http://192.168.1.5:48162").is_err());
    }

    #[test]
    fn validates_tts_audio_url_shape() {
        assert!(is_allowed_tts_audio_url(
            "http://127.0.0.1:48162/audio/assistant-real-speech.wav",
            48162
        ));
        assert!(!is_allowed_tts_audio_url(
            "http://127.0.0.1:48162/audio/../secret.wav",
            48162
        ));
        assert!(!is_allowed_tts_audio_url(
            "http://127.0.0.1:48163/audio/assistant-real-speech.wav",
            48162
        ));
    }

    #[test]
    fn rejects_private_paths_but_allows_loopback_audio_url() {
        assert!(clean_model_text("/home/local-user/voice/model.ckpt", 500).is_err());
        assert!(clean_audio_url("http://127.0.0.1:48162/audio/assistant-real-speech.wav").is_ok());
    }

    #[test]
    fn formats_unix_millis_as_utc_iso_string() {
        assert_eq!(iso_utc_from_unix_millis(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc_from_unix_millis(1_779_727_245, 123), "2026-05-25T16:40:45.123Z");
    }
}

fn apply_pet_window_mode<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    let _ = window.set_shadow(false);
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
            send_chat_message,
            synthesize_speech,
            open_chat_window,
            set_pet_window_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
