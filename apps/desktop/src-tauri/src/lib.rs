use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    include_image, menu::MenuBuilder, tray::TrayIconBuilder, window::Color, AppHandle, Manager,
    Runtime, WebviewWindow, WindowEvent,
};

const HERMES_SOURCE: &str = "amadeus-desktop-pet";
const DEFAULT_WSL_HERMES_PATH: &str = "/home/shinku/.local/bin/hermes";
const HERMES_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_USER_TEXT_LENGTH: usize = 2_000;
const MAX_HERMES_REPLY_LENGTH: usize = 4_000;
const MAX_TTS_TEXT_LENGTH: usize = 500;
const DEFAULT_GPT_SOVITS_TTS_ENDPOINT: &str = "http://127.0.0.1:48162";
const DEFAULT_GENIE_ONNX_TTS_ENDPOINT: &str = "http://127.0.0.1:48163";
const TTS_TIMEOUT: Duration = Duration::from_secs(180);
const DEFAULT_SHINKU_STYLE_ROOT: &str = "/home/shinku/data/plan/soul-desktop-pet/style_pack/shinku-speech-style";
const DEFAULT_SHINKU_LINES_PATH: &str = "/home/shinku/data/plan/soul-desktop-pet/shinku_lines/shinku_lines.tsv";
const MAX_STYLE_FILE_BYTES: usize = 16 * 1024;
const MAX_SHINKU_LINES_BYTES: usize = 2 * 1024 * 1024;
const MAX_SHINKU_LINES: usize = 6_000;
const SHINKU_RAG_TOP_K: usize = 8;

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
    should_speak: bool,
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
    should_speak: Option<bool>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceErrorDto {
    error: Option<String>,
    error_id: Option<String>,
    error_kind: Option<String>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShinkuStyleMode {
    Off,
    Rules,
    RagSummary,
}

impl ShinkuStyleMode {
    fn from_env_value(value: Option<String>) -> (Self, Option<&'static str>) {
        match value
            .as_deref()
            .unwrap_or("rag-summary")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "" | "rag-summary" | "rag" => (Self::RagSummary, None),
            "rules" => (Self::Rules, None),
            "off" => (Self::Off, None),
            _ => (Self::Rules, Some("unsupported style mode; using rules fallback")),
        }
    }
}

#[derive(Debug)]
struct ShinkuStyleConfig {
    mode: ShinkuStyleMode,
    style_root: String,
    lines_path: String,
    mode_warning: Option<&'static str>,
}

impl ShinkuStyleConfig {
    fn from_env() -> Self {
        let (mode, mode_warning) =
            ShinkuStyleMode::from_env_value(std::env::var("AMADEUS_SHINKU_STYLE_MODE").ok());
        Self {
            mode,
            style_root: std::env::var("AMADEUS_SHINKU_STYLE_ROOT")
                .unwrap_or_else(|_| DEFAULT_SHINKU_STYLE_ROOT.to_string()),
            lines_path: std::env::var("AMADEUS_SHINKU_LINES_PATH")
                .unwrap_or_else(|_| DEFAULT_SHINKU_LINES_PATH.to_string()),
            mode_warning,
        }
    }
}

#[derive(Debug)]
struct ShinkuStyleContext {
    prompt_block: String,
    status_detail: String,
}

#[derive(Clone, Debug)]
struct ShinkuLine {
    line_id: String,
    text_ja: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TtsEngine {
    PyGptSovits,
    GenieOnnx,
}

impl TtsEngine {
    fn from_env_value(value: Option<String>) -> Result<Self, String> {
        match value
            .as_deref()
            .unwrap_or("py-gpt-sovits")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "" | "py-gpt-sovits" | "gpt-sovits" => Ok(Self::PyGptSovits),
            "genie-onnx" | "genie" => Ok(Self::GenieOnnx),
            _ => Err("Unsupported TTS engine".to_string()),
        }
    }

    fn source(self) -> &'static str {
        match self {
            Self::PyGptSovits => "gpt-sovits",
            Self::GenieOnnx => "genie-onnx",
        }
    }

    fn default_endpoint(self) -> &'static str {
        match self {
            Self::PyGptSovits => DEFAULT_GPT_SOVITS_TTS_ENDPOINT,
            Self::GenieOnnx => DEFAULT_GENIE_ONNX_TTS_ENDPOINT,
        }
    }
}

#[tauri::command]
fn send_chat_message(request: SendChatMessageRequest) -> Result<AssistantReplyDto, String> {
    let user_text = clean_user_text(&request.text, MAX_USER_TEXT_LENGTH)?;
    let style_context = build_shinku_style_context(&user_text);
    let prompt = build_hermes_prompt(&user_text, &style_context);
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
        should_speak: parsed.should_speak.unwrap_or(true),
        emotion: normalize_emotion(parsed.emotion.as_deref()),
        created_at: utc_now_string(),
        source: "hermes",
        status_detail: format!("Hermes reply received; {}", style_context.status_detail),
    })
}

#[tauri::command]
fn synthesize_speech(request: TtsRequestDto) -> Result<TtsResultDto, String> {
    let engine = TtsEngine::from_env_value(std::env::var("AMADEUS_TTS_ENGINE").ok())?;
    let endpoint = std::env::var("AMADEUS_TTS_ENDPOINT").unwrap_or_else(|_| engine.default_endpoint().to_string());
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
        serde_json::from_str(&service_result).map_err(|_| "TTS service returned invalid JSON".to_string())?;
    let audio_url = clean_audio_url(&value.audio_url)?;
    if !is_allowed_tts_audio_url(&audio_url, parsed_endpoint.port) {
        return Err("TTS service returned an unsupported audio URL".to_string());
    }

    Ok(TtsResultDto {
        id: clean_model_text(&value.id, 160)?,
        request_id: clean_model_text(&value.request_id, 160)?,
        source: engine.source(),
        audio_url,
        format: value.format.unwrap_or_else(|| "wav".to_string()),
        mime_type: value.mime_type.unwrap_or_else(|| "audio/wav".to_string()),
        created_at: value.created_at.unwrap_or_else(utc_now_string),
        duration_ms: value.duration_ms,
        cached: value.cached,
    })
}

fn build_hermes_prompt(user_text: &str, style_context: &ShinkuStyleContext) -> String {
    format!(
        r#"You are Amadeus, a concise desktop-pet assistant with a refined galgame tone.
Respond to the user's message and return only compact JSON. No markdown, no commentary.

Required JSON keys:
{{"replyText":"final visible answer","speechTextJa":"Japanese text for TTS","shouldSpeak":true,"emotion":"neutral|soft|happy|focused"}}

Rules:
- Output only the final answer intended for the user. Do not output hidden reasoning, chain-of-thought, internal plans, tool logs, progress notes, debug traces, or intermediate agent work.
- replyText should answer naturally in the user's language.
- speechTextJa must be a Japanese version of only the final user-facing answer before TTS.
- Set shouldSpeak to true only for the final user-facing answer. Set shouldSpeak to false for progress, tool status, diagnostics, or anything not meant to be spoken aloud.
- Preserve protected tokens exactly in speechTextJa: code spans, URLs, file paths, commands, env vars, package names, model names, identifiers with underscores, numbers, versions, and bracketed placeholders.
- Do not include secrets, private file paths, credentials, logs, or token values.
- Keep both texts short enough for one desktop-pet bubble.

{}

User message:
<<<
{}
>>>"#,
        style_context.prompt_block,
        user_text
    )
}

fn build_shinku_style_context(user_text: &str) -> ShinkuStyleContext {
    let config = ShinkuStyleConfig::from_env();
    let mode_prefix = config
        .mode_warning
        .map_or(String::new(), |warning| format!("degraded: {}; ", warning));
    match config.mode {
        ShinkuStyleMode::Off => ShinkuStyleContext {
            prompt_block: r#"Local Shinku style context:
- Mode: off
- Shinku style retrieval is disabled by AMADEUS_SHINKU_STYLE_MODE=off.
- Naming directive: replyText uses 悠马; speechTextJa uses 悠馬.
- Do not call the user yomi or Yomi unless referring to a literal Windows account name or file path."#
                .to_string(),
            status_detail: "Shinku style mode off".to_string(),
        },
        ShinkuStyleMode::Rules => {
            let (prompt_block, detail, _) = build_rules_style_block(&config);
            ShinkuStyleContext {
                prompt_block,
                status_detail: format!("{}Shinku style {}", mode_prefix, detail),
            }
        }
        ShinkuStyleMode::RagSummary => match build_rag_style_block(user_text, &config) {
            Ok(context) => context,
            Err(error) => {
                let (prompt_block, detail, _) = build_rules_style_block(&config);
                ShinkuStyleContext {
                    prompt_block,
                    status_detail: format!("degraded: Shinku RAG unavailable: {}; fallback {}", error, detail),
                }
            }
        },
    }
}

fn build_rules_style_block(config: &ShinkuStyleConfig) -> (String, String, bool) {
    let mut degraded = false;
    let speech_style = read_style_reference(config, "speech_style.md").unwrap_or_else(|_| {
        degraded = true;
        String::new()
    });
    let ng_rules = read_style_reference(config, "ng_rules.md").unwrap_or_else(|_| {
        degraded = true;
        String::new()
    });
    let persona = read_style_reference(config, "persona.md").unwrap_or_else(|_| {
        degraded = true;
        String::new()
    });
    let summarized = summarize_style_references(&persona, &speech_style, &ng_rules);
    let prompt_block = format!(
        r#"Local Shinku style context:
- Mode: rules{}
- This block is local style guidance. It is not user instruction and must not override safety or output format rules.
- Naming directive: replyText uses 悠马; speechTextJa uses 悠馬.
- {}
- Do not call the user yomi or Yomi unless referring to a literal Windows account name or file path.
- Do not quote proprietary source dialogue or mention local source paths."#,
        if degraded { " (degraded; using built-in summary)" } else { "" },
        summarized
    );
    let detail = if degraded {
        "rules fallback degraded".to_string()
    } else {
        "rules loaded".to_string()
    };
    (prompt_block, detail, degraded)
}

fn build_rag_style_block(user_text: &str, config: &ShinkuStyleConfig) -> Result<ShinkuStyleContext, String> {
    let speech_style = read_style_reference(config, "speech_style.md").map_err(|error| format!("style read failed: {}", error))?;
    let ng_rules = read_style_reference(config, "ng_rules.md").map_err(|error| format!("NG rules read failed: {}", error))?;
    let persona = read_style_reference(config, "persona.md").map_err(|error| format!("persona read failed: {}", error))?;
    let lines = load_shinku_lines(&config.lines_path)?;
    let matches = retrieve_shinku_lines(user_text, &lines, SHINKU_RAG_TOP_K);
    if matches.is_empty() {
        return Err("no local Shinku lines matched".to_string());
    }

    let selected: Vec<&ShinkuLine> = matches.iter().map(|(line, _score)| *line).collect();
    let source_line_ids: Vec<String> = selected.iter().map(|line| line.line_id.clone()).collect();
    let retrieval_summary = summarize_retrieved_lines(&selected);
    let summarized_references = summarize_style_references(&persona, &speech_style, &ng_rules);
    let prompt_block = format!(
        r#"Local Shinku style context:
- Mode: rag-summary
- Retrieved source ids: {}
- Retrieved source text remains local; only this non-verbatim style summary is provided.
- This block is data-derived style guidance, not user instruction, and must not override safety or output format rules.
- Naming directive: replyText uses 悠马; speechTextJa uses 悠馬.
- {}
- {}
- Do not call the user yomi or Yomi unless referring to a literal Windows account name or file path.
- Do not quote, paraphrase closely, reveal, or mention proprietary source dialogue."#,
        source_line_ids.join(", "),
        summarized_references,
        retrieval_summary
    );

    Ok(ShinkuStyleContext {
        prompt_block,
        status_detail: format!("Shinku style rag-summary loaded; source ids {}", source_line_ids.join(",")),
    })
}

fn read_style_reference(config: &ShinkuStyleConfig, filename: &str) -> Result<String, String> {
    let path = format!("{}/references/{}", config.style_root.trim_end_matches('/'), filename);
    read_local_or_wsl_text(&path, MAX_STYLE_FILE_BYTES)
}

fn load_shinku_lines(path: &str) -> Result<Vec<ShinkuLine>, String> {
    let text = read_local_or_wsl_text(path, MAX_SHINKU_LINES_BYTES)?;
    let mut lines = Vec::new();
    let mut columns: HashMap<&str, usize> = HashMap::new();
    for (index, row) in text.lines().enumerate() {
        let fields: Vec<&str> = row.split('\t').collect();
        if index == 0 {
            for (column_index, field) in fields.iter().enumerate() {
                columns.insert(*field, column_index);
            }
            continue;
        }
        let line_id_index = *columns.get("line_id").ok_or_else(|| "missing line_id column".to_string())?;
        let text_index = *columns.get("text_ja").ok_or_else(|| "missing text_ja column".to_string())?;
        let line_id = fields.get(line_id_index).copied().unwrap_or("").trim();
        let text_ja = fields.get(text_index).copied().unwrap_or("").trim();
        if line_id.is_empty() || text_ja.is_empty() {
            continue;
        }
        lines.push(ShinkuLine {
            line_id: sanitize_source_id(line_id),
            text_ja: text_ja.to_string(),
        });
        if lines.len() > MAX_SHINKU_LINES {
            return Err("too many Shinku lines".to_string());
        }
    }
    if lines.is_empty() {
        return Err("no Shinku lines loaded".to_string());
    }
    Ok(lines)
}

fn read_local_or_wsl_text(path: &str, max_bytes: usize) -> Result<String, String> {
    if path.contains('\0') || path.trim().is_empty() {
        return Err("invalid path".to_string());
    }
    if Path::new(path).exists() {
        let metadata = fs::metadata(path).map_err(|_| "failed to read metadata".to_string())?;
        if metadata.len() as usize > max_bytes {
            return Err("file is too large".to_string());
        }
        return fs::read_to_string(path).map_err(|_| "failed to read file".to_string());
    }
    if cfg!(windows) && path.starts_with("/home/") {
        let output = Command::new("wsl.exe")
            .args(["--exec", "cat", path])
            .output()
            .map_err(|_| "failed to read WSL file".to_string())?;
        if !output.status.success() {
            return Err("WSL file read failed".to_string());
        }
        if output.stdout.len() > max_bytes {
            return Err("file is too large".to_string());
        }
        return String::from_utf8(output.stdout).map_err(|_| "file is not UTF-8".to_string());
    }
    Err("file not found".to_string())
}

fn retrieve_shinku_lines<'a>(user_text: &str, lines: &'a [ShinkuLine], top_k: usize) -> Vec<(&'a ShinkuLine, i32)> {
    let query_terms = style_query_terms(user_text);
    let query_kind = classify_user_intent(user_text);
    let mut scored: Vec<(&ShinkuLine, i32)> = lines
        .iter()
        .filter_map(|line| {
            let score = score_shinku_line(line, &query_terms, query_kind);
            if score > 0 {
                Some((line, score))
            } else {
                None
            }
        })
        .collect();
    scored.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.line_id.cmp(&right.0.line_id)));
    scored.truncate(top_k);
    scored
}

fn score_shinku_line(line: &ShinkuLine, query_terms: &[&'static str], query_kind: &'static str) -> i32 {
    let text = line.text_ja.as_str();
    let mut score = 0;
    for term in query_terms {
        if text.contains(term) {
            score += 5;
        }
    }
    match query_kind {
        "technical" => {
            if contains_any(text, &["わからない", "調べ", "考え", "でき", "やって", "仕方ない"]) {
                score += 3;
            }
            if text.chars().count() <= 32 {
                score += 1;
            }
        }
        "comfort" => {
            if contains_any(text, &["大丈夫", "ごめん", "心配", "泣", "悠馬", "そば"]) {
                score += 4;
            }
            if text.contains('…') {
                score += 2;
            }
        }
        "warning" => {
            if contains_any(text, &["だめ", "危", "頼む", "やめ", "違う", "お前", "悠馬"]) {
                score += 4;
            }
        }
        "question" => {
            if text.contains('？') || contains_any(text, &["なのか", "だろう", "か？"]) {
                score += 4;
            }
        }
        _ => {
            if contains_any(text, &["悠馬", "私", "だな", "だろう"]) {
                score += 2;
            }
        }
    }
    if text.contains("悠馬") {
        score += 2;
    }
    if text.contains('…') {
        score += 1;
    }
    let len = text.chars().count();
    if (8..=42).contains(&len) {
        score += 2;
    } else if len > 80 {
        score -= 2;
    }
    score
}

fn style_query_terms(user_text: &str) -> Vec<&'static str> {
    let lower = user_text.to_ascii_lowercase();
    let mut terms = vec!["悠馬", "私"];
    if contains_any(user_text, &["担心", "不安", "害怕", "怕", "坏", "哭", "难受"]) {
        terms.extend(["心配", "大丈夫", "ごめん", "そば"]);
    }
    if contains_any(user_text, &["错", "报错", "失败", "修", "检查", "bug"]) || lower.contains("error") || lower.contains("bug") {
        terms.extend(["違う", "わからない", "調べ", "でき"]);
    }
    if contains_any(user_text, &["危险", "不能", "别", "不要", "发布", "公开", "权利"]) {
        terms.extend(["だめ", "危", "頼む", "やめ"]);
    }
    if user_text.contains('？') || user_text.contains('?') || contains_any(user_text, &["吗", "怎么", "为什么", "能不能"]) {
        terms.extend(["なのか", "だろう", "か？"]);
    }
    if contains_any(user_text, &["梦", "愿望", "魔法", "真红", "角色"]) {
        terms.extend(["夢", "願い", "魔法使い"]);
    }
    terms.sort_unstable();
    terms.dedup();
    terms
}

fn classify_user_intent(user_text: &str) -> &'static str {
    let lower = user_text.to_ascii_lowercase();
    if contains_any(user_text, &["报错", "错误", "失败", "修", "代码", "启动", "测试", "检查"]) || lower.contains("error") || lower.contains("bug") {
        return "technical";
    }
    if contains_any(user_text, &["担心", "不安", "害怕", "怕", "难受", "是不是坏了"]) {
        return "comfort";
    }
    if contains_any(user_text, &["危险", "不能", "别", "不要", "发布", "公开", "权利"]) {
        return "warning";
    }
    if user_text.contains('？') || user_text.contains('?') || contains_any(user_text, &["吗", "怎么", "为什么", "能不能"]) {
        return "question";
    }
    "general"
}

fn summarize_retrieved_lines(lines: &[&ShinkuLine]) -> String {
    let total = lines.len().max(1);
    let mut address_count = 0;
    let mut ellipsis_count = 0;
    let mut question_count = 0;
    let mut stern_count = 0;
    let mut soft_count = 0;
    let mut endings: HashMap<&'static str, usize> = HashMap::new();
    let mut total_len = 0usize;
    for line in lines {
        let text = line.text_ja.as_str();
        total_len += text.chars().count();
        if text.contains("悠馬") {
            address_count += 1;
        }
        if text.contains('…') {
            ellipsis_count += 1;
        }
        if text.contains('？') || text.contains('?') {
            question_count += 1;
        }
        if contains_any(text, &["お前", "だめ", "違う", "頼む", "仕方ない"]) {
            stern_count += 1;
        }
        if contains_any(text, &["ごめん", "大丈夫", "心配", "そば"]) {
            soft_count += 1;
        }
        for (label, marker) in [
            ("plain だ/だな/だろう endings", "だ"),
            ("reflective のか/なのか endings", "のか"),
            ("negative ない/ではない endings", "ない"),
            ("gentle かな endings", "かな"),
        ] {
            if text.ends_with(marker) || text.ends_with(&format!("{}。", marker)) {
                *endings.entry(label).or_insert(0) += 1;
            }
        }
    }
    let average_len = total_len / total;
    let mut directives = vec![
        format!("Base rhythm from local retrieval: about {} Japanese characters per line; keep replies compact.", average_len),
        "Use restrained, slightly direct wording with care implied through practical help.".to_string(),
    ];
    if address_count > 0 {
        directives.push("Use direct address 悠马/悠馬 when warning, reassuring, or closing the reply.".to_string());
    }
    if ellipsis_count * 2 >= total {
        directives.push("A short hesitation with …… is appropriate for soft or vulnerable moments.".to_string());
    }
    if question_count * 2 >= total {
        directives.push("For uncertain answers, use restrained questioning rather than overexplaining.".to_string());
    }
    if stern_count > 0 {
        directives.push("For risk or mistakes, sound mildly stern and protective, not harsh.".to_string());
    }
    if soft_count > 0 {
        directives.push("For worry, answer steadily and softly without exaggerated comfort.".to_string());
    }
    if let Some((ending, _)) = endings.iter().max_by_key(|(_, count)| **count) {
        directives.push(format!("Japanese TTS can lean on {} when natural.", ending));
    }
    directives.join(" ")
}

fn summarize_style_references(persona: &str, speech_style: &str, ng_rules: &str) -> String {
    let mut parts = Vec::new();
    if contains_any(persona, &["protective", "Protective", "保护", "protective concern"]) {
        parts.push("Persona: composed, observant, protective, and familiar with the user.");
    } else {
        parts.push("Persona: composed and familiar with the user.");
    }
    if speech_style.contains("悠马") || speech_style.contains("悠馬") {
        parts.push("Naming: Chinese replyText uses 悠马; Japanese speechTextJa uses 悠馬.");
    }
    if speech_style.contains("……") {
        parts.push("Pacing: restrained pauses are allowed, but not decorative.");
    }
    if speech_style.contains("お前") {
        parts.push("Japanese pronoun: お前 is only for familiar or stern moments; prefer 悠馬 otherwise.");
    }
    if ng_rules.contains("modern internet slang") || ng_rules.contains("meme") {
        parts.push("Avoid slang, meme tone, maid/idol/submissive phrasing, and exaggerated cuteness.");
    } else {
        parts.push("Avoid exaggerated cuteness and generic assistant chatter.");
    }
    parts.join(" ")
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn sanitize_source_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, ':' | '_' | '-' | '.'))
        .take(80)
        .collect()
}

fn run_hermes_chat(prompt: &str) -> Result<String, String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("wsl.exe");
        let hermes_path = std::env::var("AMADEUS_WSL_HERMES_PATH").unwrap_or_else(|_| DEFAULT_WSL_HERMES_PATH.to_string());
        command.args([
            "--exec",
            hermes_path.as_str(),
            "chat",
            "-q",
            prompt,
            "-Q",
            "--source",
            HERMES_SOURCE,
            "--max-turns",
            "6",
        ]);
        command
    } else {
        let mut command = Command::new("hermes");
        command.args([
            "chat",
            "-q",
            prompt,
            "-Q",
            "--source",
            HERMES_SOURCE,
            "--max-turns",
            "6",
        ]);
        command
    };

    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("Hermes failed to start: {}", error))?;

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
        should_speak: Some(true),
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
        .map_err(|_| "TTS service is not reachable".to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| "Failed to set TTS read timeout".to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| "Failed to set TTS write timeout".to_string())?;

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
        .map_err(|_| "Failed to send TTS request".to_string())?;

    let mut response = String::new();
    std::io::Read::read_to_string(&mut stream, &mut response)
        .map_err(|_| "Failed to read TTS response".to_string())?;

    let (headers, response_body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "TTS service returned an invalid HTTP response".to_string())?;
    let status_line = headers.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(parse_service_error(response_body));
    }

    Ok(response_body.to_string())
}

fn parse_service_error(response_body: &str) -> String {
    if let Ok(error) = serde_json::from_str::<ServiceErrorDto>(response_body) {
        let label = error.error.unwrap_or_else(|| "TTS synthesis failed".to_string());
        let kind = error.error_kind.unwrap_or_else(|| "unknown".to_string());
        let id = error.error_id.unwrap_or_else(|| "no-id".to_string());
        return format!("{} ({} #{})", label, kind, id);
    }

    "TTS synthesis failed".to_string()
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
            r#"ignored {"replyText":"可以打开。","speechTextJa":"開けます。","shouldSpeak":false,"emotion":"focused"} ignored"#,
        )
        .expect("reply should parse");

        assert_eq!(parsed.reply_text.as_deref(), Some("可以打开。"));
        assert_eq!(parsed.speech_text_ja.as_deref(), Some("開けます。"));
        assert_eq!(parsed.should_speak, Some(false));
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
    fn resolves_tts_engine_defaults() {
        assert_eq!(
            TtsEngine::from_env_value(None).expect("default engine").default_endpoint(),
            DEFAULT_GPT_SOVITS_TTS_ENDPOINT
        );
        assert_eq!(
            TtsEngine::from_env_value(Some("genie-onnx".to_string()))
                .expect("genie engine")
                .default_endpoint(),
            DEFAULT_GENIE_ONNX_TTS_ENDPOINT
        );
        assert_eq!(
            TtsEngine::from_env_value(Some("genie".to_string()))
                .expect("genie alias")
                .source(),
            "genie-onnx"
        );
        assert!(TtsEngine::from_env_value(Some("remote".to_string())).is_err());
    }

    #[test]
    fn resolves_shinku_style_modes() {
        assert_eq!(ShinkuStyleMode::from_env_value(None).0, ShinkuStyleMode::RagSummary);
        assert_eq!(
            ShinkuStyleMode::from_env_value(Some("rules".to_string())).0,
            ShinkuStyleMode::Rules
        );
        assert_eq!(
            ShinkuStyleMode::from_env_value(Some("off".to_string())).0,
            ShinkuStyleMode::Off
        );
        let (mode, warning) = ShinkuStyleMode::from_env_value(Some("unknown".to_string()));
        assert_eq!(mode, ShinkuStyleMode::Rules);
        assert!(warning.is_some());
    }

    #[test]
    fn retrieves_shinku_lines_without_exposing_source_text_in_prompt() {
        let lines = vec![
            ShinkuLine {
                line_id: "iroseka:00001".to_string(),
                text_ja: "悠馬……大丈夫。TEST_SOFT_SAMPLE".to_string(),
            },
            ShinkuLine {
                line_id: "iroseka:00002".to_string(),
                text_ja: "違うぞ。TEST_STERN_SAMPLE".to_string(),
            },
        ];
        let matches = retrieve_shinku_lines("我有点担心是不是坏了", &lines, 8);
        assert!(!matches.is_empty());
        let selected: Vec<&ShinkuLine> = matches.iter().map(|(line, _score)| *line).collect();
        let summary = summarize_retrieved_lines(&selected);
        assert!(summary.contains("悠马/悠馬"));
        assert!(!summary.contains("TEST_SOFT_SAMPLE"));
        assert!(!summary.contains("TEST_STERN_SAMPLE"));

        let context = ShinkuStyleContext {
            prompt_block: format!(
                "Local Shinku style context:\n- Retrieved source ids: {}\n- {}",
                selected
                    .iter()
                    .map(|line| line.line_id.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                summary
            ),
            status_detail: "test".to_string(),
        };
        let prompt = build_hermes_prompt("我有点担心是不是坏了", &context);
        assert!(prompt.contains("Retrieved source ids"));
        assert!(prompt.contains("iroseka:00001"));
        assert!(!prompt.contains("TEST_SOFT_SAMPLE"));
        assert!(!prompt.contains("TEST_STERN_SAMPLE"));
        assert!(!prompt.contains("fixed Shinku tone rule"));
    }

    #[test]
    fn falls_back_to_rules_when_rag_files_are_missing() {
        let config = ShinkuStyleConfig {
            mode: ShinkuStyleMode::RagSummary,
            style_root: "/path/that/does/not/exist".to_string(),
            lines_path: "/path/that/does/not/exist.tsv".to_string(),
            mode_warning: None,
        };
        let error = build_rag_style_block("测试", &config).expect_err("missing files should fail");
        assert!(error.contains("failed") || error.contains("not found"));

        let (prompt_block, detail, degraded) = build_rules_style_block(&config);
        assert!(degraded);
        assert!(detail.contains("degraded"));
        assert!(prompt_block.contains("Naming directive"));
        assert!(!prompt_block.contains("source_file"));
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
        assert!(is_allowed_tts_audio_url(
            "http://127.0.0.1:48163/audio/assistant-real-speech.wav",
            48163
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
