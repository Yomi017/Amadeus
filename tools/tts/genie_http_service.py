#!/usr/bin/env python3
"""Amadeus-compatible HTTP wrapper for Genie-TTS ONNX inference.

This service intentionally exposes the same local API shape as the existing
GPT-SoVITS PyTorch wrapper while keeping all model, reference audio, and cache
paths outside the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 48163
DEFAULT_CHARACTER_NAME = "amadeus-shinku"
DEFAULT_LANGUAGE = "ja"
DEFAULT_MAX_TEXT_LENGTH = 500
DEFAULT_OUTPUT_DIR = str(Path(tempfile.gettempdir()) / "amadeus-genie-tts-cache")
DEFAULT_GENIE_DIR = "/home/shinku/data/code/Genie-TTS"
DEFAULT_ONNX_DIR = "/home/shinku/data/plan/tts-desktop-pet/work/genie_onnx/shinku_v2proplus_v1"
SAFE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,78}[A-Za-z0-9_])?$")

BASE_ONNX_FILES = {
    "t2s_encoder_fp32.bin",
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp16.bin",
    "vits_fp32.onnx",
}
V2PROPLUS_ONNX_FILES = {
    "prompt_encoder_fp16.bin",
    "prompt_encoder_fp32.onnx",
}


class ServiceConfig:
    def __init__(
        self,
        *,
        genie_dir: Path,
        onnx_model_dir: Path,
        output_dir: Path,
        ref_audio: Path | None,
        ref_text: str,
        host: str,
        port: int,
        character_name: str,
        language: str,
        ref_language: str,
        model_kind: str,
        max_text_length: int,
        dry_run: bool,
    ) -> None:
        self.genie_dir = genie_dir
        self.onnx_model_dir = onnx_model_dir
        self.output_dir = output_dir
        self.ref_audio = ref_audio
        self.ref_text = ref_text
        self.host = host
        self.port = port
        self.character_name = character_name
        self.language = language
        self.ref_language = ref_language
        self.model_kind = model_kind
        self.max_text_length = max_text_length
        self.dry_run = dry_run


class TtsRuntime:
    def __init__(self, config: ServiceConfig) -> None:
        self.config = config
        self._loaded = False
        self._genie: Any | None = None
        self._lock = threading.RLock()

    def status(self) -> dict[str, Any]:
        missing_count = 0
        if not self.config.dry_run:
            missing_count = len(find_missing_runtime_inputs(self.config))

        return {
            "available": self.config.dry_run or missing_count == 0,
            "detail": self._status_detail(missing_count),
            "engine": "genie-onnx",
            "provider": "Genie-TTS",
            "loaded": self._loaded,
            "dryRun": self.config.dry_run,
            "missingCount": missing_count,
            "modelKind": self.config.model_kind,
        }

    def synthesize(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = str(payload.get("text", "")).strip()
        if not text:
            raise ClientError("text is required")
        if len(text) > self.config.max_text_length:
            raise ClientError(f"text exceeds max length {self.config.max_text_length}")

        request_id = safe_request_id(str(payload.get("id", "")).strip() or digest_text(text))
        filename = audio_filename_for_request_id(request_id)
        output = self.config.output_dir / filename
        output.parent.mkdir(parents=True, exist_ok=True)

        started = time.monotonic()
        if self.config.dry_run:
            write_silent_wav(output)
        else:
            with self._lock:
                self._load()
                assert self._genie is not None
                self._genie.tts(
                    character_name=self.config.character_name,
                    text=text,
                    play=False,
                    split_sentence=bool(payload.get("splitSentence", False)),
                    save_path=str(output),
                )
            if not output.is_file() or output.stat().st_size <= 44:
                raise RuntimeError("Genie produced no audio")

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "id": f"tts-{request_id}",
            "requestId": request_id,
            "source": "genie-onnx",
            "audioUrl": audio_url(self.config.port, filename),
            "format": "wav",
            "mimeType": "audio/wav",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": elapsed_ms,
            "cached": False,
        }

    def _load(self) -> None:
        if self._loaded:
            return

        missing = find_missing_runtime_inputs(self.config)
        if missing:
            raise RuntimeError("Genie runtime inputs are missing")
        assert self.config.ref_audio is not None

        sys.path.insert(0, str(self.config.genie_dir / "src"))
        import genie_tts as genie  # type: ignore[import-not-found]

        genie.load_character(
            character_name=self.config.character_name,
            onnx_model_dir=str(self.config.onnx_model_dir),
            language=self.config.language,
        )
        genie.set_reference_audio(
            character_name=self.config.character_name,
            audio_path=str(self.config.ref_audio),
            audio_text=self.config.ref_text,
            language=self.config.ref_language,
        )
        self._genie = genie
        self._loaded = True

    def _status_detail(self, missing_count: int) -> str:
        if self.config.dry_run:
            return "Genie ONNX service dry-run ready"
        if missing_count:
            return "Genie ONNX runtime inputs are missing"
        if self._loaded:
            return "Genie ONNX service loaded"
        return "Genie ONNX service configured"


class ClientError(Exception):
    pass


def find_missing_runtime_inputs(config: ServiceConfig) -> list[str]:
    missing: list[str] = []
    for path in [config.genie_dir / "src", config.onnx_model_dir]:
        if not path.exists():
            missing.append("path")
    if config.ref_audio is None or not config.ref_audio.is_file():
        missing.append("refAudio")
    for filename in required_onnx_files(config.model_kind):
        if not (config.onnx_model_dir / filename).is_file():
            missing.append("onnx")
    if not config.ref_text:
        missing.append("refText")
    return missing


def required_onnx_files(model_kind: str) -> set[str]:
    if model_kind == "v2proplus":
        return BASE_ONNX_FILES | V2PROPLUS_ONNX_FILES
    return set(BASE_ONNX_FILES)


def write_silent_wav(output: Path) -> None:
    import wave

    sample_rate = 24_000
    frame_count = sample_rate // 5
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * frame_count)


def digest_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def safe_request_id(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip(".-")
    candidate = normalized[:80].strip(".-")
    if SAFE_REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return digest_text(value)


def audio_filename_for_request_id(request_id: str) -> str:
    if not SAFE_REQUEST_ID_PATTERN.fullmatch(request_id):
        raise ClientError("invalid audio filename")
    return f"{request_id}.wav"


def audio_url(port: int, filename: str) -> str:
    return f"http://127.0.0.1:{port}/audio/{quote(filename, safe='')}"


def safe_audio_path(output_dir: Path, filename: str) -> Path:
    if not filename.endswith(".wav"):
        raise ClientError("invalid audio filename")

    request_id = filename[:-4]
    if not SAFE_REQUEST_ID_PATTERN.fullmatch(request_id):
        raise ClientError("invalid audio filename")

    output_root = output_dir.resolve()
    output_path = (output_root / filename).resolve()
    if output_path.parent != output_root:
        raise ClientError("invalid audio filename")
    return output_path


def ensure_output_dir_outside_repo(output_dir: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    try:
        output_dir.resolve().relative_to(repo_root)
    except ValueError:
        return
    raise SystemExit("TTS output cache must be outside the repository")


def ensure_loopback_host(host: str) -> None:
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Genie ONNX service host must be loopback")


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    raw_length = handler.headers.get("content-length", "0")
    try:
        length = int(raw_length)
    except ValueError as error:
        raise ClientError("invalid content-length") from error
    if length <= 0:
        return {}
    if length > 16_384:
        raise ClientError("request body is too large")
    raw = handler.rfile.read(length)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ClientError("invalid json body") from error
    if not isinstance(parsed, dict):
        raise ClientError("json body must be an object")
    return parsed


def make_handler(runtime: TtsRuntime) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            route = urlparse(self.path).path
            if route == "/status":
                self.send_json(HTTPStatus.OK, runtime.status())
                return
            if route.startswith("/audio/"):
                self.send_audio(unquote(route[len("/audio/") :]))
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            if route != "/synthesize":
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            try:
                result = runtime.synthesize(parse_json_body(self))
            except ClientError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            except Exception as error:
                error_id = digest_text(f"{type(error).__name__}:{error}")[:10]
                log_safe_exception(error_id, error)
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "error": "Genie ONNX synthesis failed",
                        "errorId": error_id,
                        "errorKind": "runtime",
                    },
                )
                return
            self.send_json(HTTPStatus.OK, result)

        def send_audio(self, filename: str) -> None:
            try:
                audio_path = safe_audio_path(runtime.config.output_dir, filename)
            except ClientError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if not audio_path.is_file():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "audio not found"})
                return

            try:
                size = audio_path.stat().st_size
                audio = audio_path.open("rb")
            except OSError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "audio not found"})
                return

            with audio:
                self.send_response(HTTPStatus.OK.value)
                self.send_header("content-type", "audio/wav")
                self.send_header("content-length", str(size))
                self.send_header("cache-control", "no-store")
                self.end_headers()
                while True:
                    chunk = audio.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status.value)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Handler


def log_safe_exception(error_id: str, error: Exception) -> None:
    print(f"[tts-error:{error_id}] {type(error).__name__}: {sanitize_log_text(str(error))}", file=sys.stderr, flush=True)
    for line in traceback.format_exc().splitlines()[-16:]:
        print(f"[tts-error:{error_id}] {sanitize_log_text(line)}", file=sys.stderr, flush=True)


def sanitize_log_text(text: str) -> str:
    sanitized = text
    for pattern in [
        re.compile(r"(?:/home|/Users|/mnt/c/Users)/[^\s'\"<>)]*", re.I),
        re.compile(r"[A-Z]:\\Users\\[^\s'\"<>)]*", re.I),
        re.compile(r"(?:token|secret|credential|password|cookie|api[_-]?key)\s*[:=]\s*[^\s'\"<>]+", re.I),
        re.compile(r"Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}", re.I),
        re.compile(r"\b[^\s'\"<>/\\)]+\\.(?:onnx|bin|ckpt|pth|wav|ogg|safetensors|npz|npy|ort)\b", re.I),
    ]:
        sanitized = pattern.sub("[redacted]", sanitized)
    return sanitized[:500]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Amadeus local Genie-TTS ONNX HTTP service.")
    parser.add_argument("--host", default=os.environ.get("AMADEUS_TTS_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AMADEUS_GENIE_TTS_PORT", DEFAULT_PORT)))
    parser.add_argument("--genie-dir", default=os.environ.get("AMADEUS_GENIE_DIR", DEFAULT_GENIE_DIR))
    parser.add_argument("--onnx-model-dir", default=os.environ.get("AMADEUS_GENIE_ONNX_DIR", DEFAULT_ONNX_DIR))
    parser.add_argument("--output-dir", default=os.environ.get("AMADEUS_TTS_OUTPUT_DIR", DEFAULT_OUTPUT_DIR))
    parser.add_argument("--ref-audio", default=os.environ.get("AMADEUS_TTS_REF_AUDIO", ""))
    parser.add_argument("--ref-text", default=os.environ.get("AMADEUS_TTS_REF_TEXT", ""))
    parser.add_argument("--character-name", default=os.environ.get("AMADEUS_GENIE_CHARACTER_NAME", DEFAULT_CHARACTER_NAME))
    parser.add_argument("--language", default=os.environ.get("AMADEUS_GENIE_LANGUAGE", DEFAULT_LANGUAGE))
    parser.add_argument("--ref-language", default=os.environ.get("AMADEUS_GENIE_REF_LANGUAGE", DEFAULT_LANGUAGE))
    parser.add_argument("--model-kind", choices=("v2", "v2proplus"), default=os.environ.get("AMADEUS_GENIE_MODEL_KIND", "v2proplus"))
    parser.add_argument("--max-text-length", type=int, default=DEFAULT_MAX_TEXT_LENGTH)
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("AMADEUS_TTS_DRY_RUN", "") == "1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_loopback_host(str(args.host))
    config = ServiceConfig(
        genie_dir=Path(args.genie_dir).expanduser().resolve(),
        onnx_model_dir=Path(args.onnx_model_dir).expanduser().resolve(),
        output_dir=Path(args.output_dir).expanduser().resolve(),
        ref_audio=Path(args.ref_audio).expanduser().resolve() if args.ref_audio else None,
        ref_text=str(args.ref_text),
        host=str(args.host),
        port=int(args.port),
        character_name=str(args.character_name),
        language=str(args.language),
        ref_language=str(args.ref_language),
        model_kind=str(args.model_kind),
        max_text_length=int(args.max_text_length),
        dry_run=bool(args.dry_run),
    )
    ensure_output_dir_outside_repo(config.output_dir)
    runtime = TtsRuntime(config)
    server = ThreadingHTTPServer((config.host, config.port), make_handler(runtime))
    print(f"Amadeus Genie ONNX service listening on http://{config.host}:{config.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
