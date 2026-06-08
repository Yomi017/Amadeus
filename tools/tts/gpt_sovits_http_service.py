#!/usr/bin/env python3
"""Local GPT-SoVITS HTTP service for Amadeus.

The script intentionally reads model, GPT-SoVITS checkout, reference audio,
and cache paths from environment variables or CLI flags. Do not hard-code
private model, voice, or extracted asset paths in this repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 48162
DEFAULT_VERSION = "v2ProPlus"
DEFAULT_MAX_TEXT_LENGTH = 500
DEFAULT_OUTPUT_DIR = str(Path(tempfile.gettempdir()) / "amadeus-tts-cache")
SAFE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,78}[A-Za-z0-9_])?$")


class ServiceConfig:
    def __init__(
        self,
        *,
        gpt_sovits_dir: Path,
        model_dir: Path,
        gpt_checkpoint: Path,
        sovits_checkpoint: Path,
        output_dir: Path,
        ref_audio: Path,
        ref_text: str,
        host: str,
        port: int,
        version: str,
        is_half: str,
        max_text_length: int,
        dry_run: bool,
    ) -> None:
        self.gpt_sovits_dir = gpt_sovits_dir
        self.model_dir = model_dir
        self.gpt_checkpoint = gpt_checkpoint
        self.sovits_checkpoint = sovits_checkpoint
        self.output_dir = output_dir
        self.ref_audio = ref_audio
        self.ref_text = ref_text
        self.host = host
        self.port = port
        self.version = version
        self.is_half = is_half
        self.max_text_length = max_text_length
        self.dry_run = dry_run

class TtsRuntime:
    def __init__(self, config: ServiceConfig) -> None:
        self.config = config
        self._loaded = False
        self._get_tts_wav: Any | None = None
        self._i18n: Any | None = None

    def status(self) -> dict[str, Any]:
        missing: list[str] = []
        if not self.config.dry_run:
            for path in [
                self.config.gpt_sovits_dir,
                self.config.model_dir,
                self.config.ref_audio,
                self.config.gpt_checkpoint,
                self.config.sovits_checkpoint,
            ]:
                if not path.exists():
                    missing.append(label_path(path))

        if missing:
            return {
                "available": False,
                "detail": "Missing GPT-SoVITS runtime paths",
                "missing": missing,
                "dryRun": self.config.dry_run,
            }

        return {
            "available": True,
            "detail": "GPT-SoVITS service ready" if self._loaded else "GPT-SoVITS service configured",
            "dryRun": self.config.dry_run,
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
            self._load()
            assert self._get_tts_wav is not None
            assert self._i18n is not None

            result = list(
                self._get_tts_wav(
                    ref_wav_path=str(self.config.ref_audio),
                    prompt_text=self.config.ref_text,
                    prompt_language=self._i18n("日文"),
                    text=text,
                    text_language=self._i18n("日文"),
                    top_p=float(payload.get("topP", 1.0)),
                    temperature=float(payload.get("temperature", 1.0)),
                    speed=float(payload.get("speed", 1.0)),
                )
            )
            if not result:
                raise RuntimeError("GPT-SoVITS returned no audio")

            sample_rate, audio = result[-1]
            import soundfile as sf

            sf.write(output, audio, sample_rate)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "id": f"tts-{request_id}",
            "requestId": request_id,
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

        os.chdir(self.config.gpt_sovits_dir)
        sys.path.insert(0, str(self.config.gpt_sovits_dir))
        sys.path.insert(0, str(self.config.gpt_sovits_dir / "GPT_SoVITS"))
        os.environ.setdefault("version", self.config.version)
        os.environ.setdefault("is_half", self.config.is_half)
        os.environ["gpt_path"] = str(self.config.gpt_checkpoint)
        os.environ["sovits_path"] = str(self.config.sovits_checkpoint)
        patch_torchaudio_load()

        from tools.i18n.i18n import I18nAuto
        from GPT_SoVITS.inference_webui import get_tts_wav

        self._i18n = I18nAuto()
        self._get_tts_wav = get_tts_wav
        self._loaded = True


class ClientError(Exception):
    pass


def patch_torchaudio_load() -> None:
    import soundfile as sf
    import torch
    import torchaudio

    def load_with_soundfile(uri: str, *args: Any, **kwargs: Any) -> tuple[Any, int]:
        data, sample_rate = sf.read(str(uri), dtype="float32", always_2d=True)
        return torch.from_numpy(data.T.copy()), sample_rate

    torchaudio.load = load_with_soundfile


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


def label_path(path: Path) -> str:
    return path.name or str(path)


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
                        "error": "GPT-SoVITS synthesis failed",
                        "errorId": error_id,
                        "errorKind": type(error).__name__,
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
    ]:
        sanitized = pattern.sub("[redacted]", sanitized)
    return sanitized[:500]


def env_path(name: str, fallback: str) -> Path:
    value = os.environ.get(name, fallback)
    return Path(value).expanduser().resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Amadeus local GPT-SoVITS HTTP service.")
    parser.add_argument("--host", default=os.environ.get("AMADEUS_TTS_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AMADEUS_TTS_PORT", DEFAULT_PORT)))
    parser.add_argument("--gpt-sovits-dir", default=os.environ.get("AMADEUS_GPT_SOVITS_DIR", ""))
    parser.add_argument("--model-dir", default=os.environ.get("AMADEUS_TTS_MODEL_DIR", ""))
    parser.add_argument("--gpt-checkpoint", default=os.environ.get("AMADEUS_TTS_GPT_CHECKPOINT", ""))
    parser.add_argument("--sovits-checkpoint", default=os.environ.get("AMADEUS_TTS_SOVITS_CHECKPOINT", ""))
    parser.add_argument("--output-dir", default=os.environ.get("AMADEUS_TTS_OUTPUT_DIR", DEFAULT_OUTPUT_DIR))
    parser.add_argument("--ref-audio", default=os.environ.get("AMADEUS_TTS_REF_AUDIO", ""))
    parser.add_argument("--ref-text", default=os.environ.get("AMADEUS_TTS_REF_TEXT", ""))
    parser.add_argument("--version", default=os.environ.get("AMADEUS_TTS_VERSION", DEFAULT_VERSION))
    parser.add_argument("--is-half", default=os.environ.get("AMADEUS_TTS_IS_HALF", "True"))
    parser.add_argument("--max-text-length", type=int, default=DEFAULT_MAX_TEXT_LENGTH)
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("AMADEUS_TTS_DRY_RUN", "") == "1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = ServiceConfig(
        gpt_sovits_dir=Path(args.gpt_sovits_dir).expanduser().resolve(),
        model_dir=Path(args.model_dir).expanduser().resolve(),
        gpt_checkpoint=Path(args.gpt_checkpoint).expanduser().resolve(),
        sovits_checkpoint=Path(args.sovits_checkpoint).expanduser().resolve(),
        output_dir=Path(args.output_dir).expanduser().resolve(),
        ref_audio=Path(args.ref_audio).expanduser().resolve(),
        ref_text=str(args.ref_text),
        host=str(args.host),
        port=int(args.port),
        version=str(args.version),
        is_half=str(args.is_half),
        max_text_length=int(args.max_text_length),
        dry_run=bool(args.dry_run),
    )
    ensure_output_dir_outside_repo(config.output_dir)
    if not config.dry_run and not config.ref_text:
        raise SystemExit("AMADEUS_TTS_REF_TEXT or --ref-text is required")

    runtime = TtsRuntime(config)
    server = ThreadingHTTPServer((config.host, config.port), make_handler(runtime))
    print(f"Amadeus GPT-SoVITS service listening on http://{config.host}:{config.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
