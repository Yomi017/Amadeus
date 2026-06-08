#!/usr/bin/env python3
"""Benchmark local TTS engines through their /synthesize HTTP endpoint."""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib import error, request
from urllib.parse import urlparse


DEFAULT_PY_ENDPOINT = "http://127.0.0.1:48162"
DEFAULT_GENIE_ENDPOINT = "http://127.0.0.1:48163"
UNSAFE_PATTERNS = (
    re.compile(r"(?:/home|/Users|/mnt/c/Users)/[^\s'\"<>)]*", re.I),
    re.compile(r"[A-Z]:\\Users\\[^\s'\"<>)]*", re.I),
    re.compile(r"(?:token|secret|credential|password|cookie|api[_-]?key)\s*[:=]\s*[^\s'\"<>]+", re.I),
    re.compile(r"Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}", re.I),
)

SENTENCES = [
    "おはようございます。今日も一緒にがんばりましょう。",
    "少し休憩して、深呼吸してみませんか。",
    "予定を確認しました。次の作業に進めます。",
    "この返答は、音声合成の自然さを確認するためのものです。",
    "こんにちは。ご用件を聞かせてください。",
    "すみません、もう一度ゆっくり説明してもらえますか。",
    "ありがとうございます。とても助かりました。",
    "今の状態を保存してから、次の手順に移りましょう。",
    "窓の外は静かですが、部屋の中は少し明るいです。",
    "長い文章でも、聞き取りやすい速度を保てるか確認します。",
    "短い一言です。",
    "疑問文の抑揚は自然に聞こえますか。",
    "驚いたときの声の変化も試してみます。",
    "落ち着いた声で、やさしく案内してください。",
    "数字を含む文章です。三つの項目を順番に読みます。",
    "英字を含むテストです。API と TTS の発音を確認します。",
    "句読点が多い文章です。まず確認し、次に実行し、最後に報告します。",
    "少し長めの説明を続けます。音の途切れや待ち時間を測定します。",
    "感情を控えめにして、安定した読み上げをお願いします。",
    "これで最後のテスト文です。結果を JSON で出力します。",
]


def main() -> int:
    args = parse_args()
    selected_engines = resolve_engines(args.engine)
    endpoints = {
        "py": normalize_endpoint(args.py_endpoint),
        "genie": normalize_endpoint(args.genie_endpoint),
    }

    results: list[dict[str, Any]] = []
    for engine in selected_engines:
        for repeat_index in range(1, args.repeat + 1):
            for sentence_index, sentence in enumerate(SENTENCES, start=1):
                result = run_case(
                    engine=engine,
                    endpoint=endpoints[engine],
                    repeat_index=repeat_index,
                    sentence_index=sentence_index,
                    text=sentence,
                    timeout=args.timeout,
                )
                results.append(result)

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "config": {
            "engine": args.engine,
            "repeat": args.repeat,
            "timeout": args.timeout,
            "endpoints": {engine: endpoints[engine] for engine in selected_engines},
            "sentenceCount": len(SENTENCES),
        },
        "results": results,
        "summary": summarize(results),
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark PyTorch and Genie TTS /synthesize endpoints."
    )
    parser.add_argument(
        "--engine",
        choices=("py", "genie", "both"),
        default="both",
        help="Engine to benchmark. Defaults to both.",
    )
    parser.add_argument(
        "--repeat",
        type=positive_int,
        default=1,
        help="Number of times to run the fixed 20-sentence set per engine.",
    )
    parser.add_argument(
        "--timeout",
        type=positive_float,
        default=120.0,
        help="Per-request timeout in seconds.",
    )
    parser.add_argument(
        "--py-endpoint",
        default=DEFAULT_PY_ENDPOINT,
        help=f"PyTorch service endpoint. Defaults to {DEFAULT_PY_ENDPOINT}.",
    )
    parser.add_argument(
        "--genie-endpoint",
        default=DEFAULT_GENIE_ENDPOINT,
        help=f"Genie service endpoint. Defaults to {DEFAULT_GENIE_ENDPOINT}.",
    )
    return parser.parse_args()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be >= 1")
    return parsed


def positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be > 0")
    return parsed


def resolve_engines(engine: str) -> list[str]:
    if engine == "both":
        return ["py", "genie"]
    return [engine]


def normalize_endpoint(endpoint: str) -> str:
    endpoint = endpoint.strip()
    if not endpoint:
        raise SystemExit("endpoint must not be empty")
    parsed = urlparse(endpoint)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.port is None:
        raise SystemExit("endpoint must be a loopback HTTP URL with an explicit port")
    return endpoint.rstrip("/")


def run_case(
    *,
    engine: str,
    endpoint: str,
    repeat_index: int,
    sentence_index: int,
    text: str,
    timeout: float,
) -> dict[str, Any]:
    request_id = make_request_id(engine, repeat_index, sentence_index)
    body = {
        "id": request_id,
        "text": text,
        "locale": "ja",
        "emotion": "neutral",
        "speed": 1,
        "topP": 1,
        "temperature": 1,
    }

    started = time.perf_counter()
    status = None
    audio_url = None
    error_message = None
    ok = False

    try:
        response_status, response_body = post_json(
            f"{endpoint}/synthesize",
            body,
            timeout=timeout,
        )
        status = response_status
        audio_url = response_body.get("audioUrl") if isinstance(response_body, dict) else None
        if isinstance(audio_url, str) and is_allowed_audio_url(audio_url, endpoint):
            ok = True
        else:
            audio_url = None
            error_message = "response did not include a safe loopback audioUrl"
    except Exception as exc:  # Keep benchmarking after per-case failures.
        error_message = format_error(exc)

    latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
    return {
        "engine": engine,
        "endpoint": endpoint,
        "repeat": repeat_index,
        "sentenceIndex": sentence_index,
        "id": request_id,
        "text": text,
        "latencyMs": latency_ms,
        "audioUrl": audio_url,
        "ok": ok,
        "error": error_message,
        "httpStatus": status,
    }


def make_request_id(engine: str, repeat_index: int, sentence_index: int) -> str:
    return f"bench-{engine}-r{repeat_index:02d}-s{sentence_index:02d}"


def post_json(url: str, body: dict[str, Any], *, timeout: float) -> tuple[int, Any]:
    data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, read_json_response(response)
    except error.HTTPError as exc:
        detail = read_error_detail(exc)
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def read_json_response(response: Any) -> Any:
    raw = response.read()
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def read_error_detail(exc: error.HTTPError) -> str:
    raw = exc.read()
    if not raw:
        return exc.reason or "request failed"
    text = raw.decode("utf-8", errors="replace").strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(parsed, dict):
        for key in ("error", "message", "detail"):
            value = parsed.get(key)
            if isinstance(value, str) and value:
                return value
    return text


def format_error(exc: Exception) -> str:
    message = str(exc).strip()
    return sanitize_text(message or exc.__class__.__name__)


def is_allowed_audio_url(audio_url: str, endpoint: str) -> bool:
    if not audio_url.endswith(".wav"):
        return False

    endpoint_parts = urlparse(endpoint)
    audio_parts = urlparse(audio_url)
    return (
        audio_parts.scheme == "http"
        and audio_parts.hostname == "127.0.0.1"
        and audio_parts.port == endpoint_parts.port
        and audio_parts.path.startswith("/audio/")
        and ".." not in audio_parts.path
    )


def sanitize_text(text: str) -> str:
    sanitized = text[:500]
    for pattern in UNSAFE_PATTERNS:
        sanitized = pattern.sub("[redacted]", sanitized)
    return sanitized


def summarize(results: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    for engine in ("py", "genie"):
        engine_results = [result for result in results if result["engine"] == engine]
        if not engine_results:
            continue
        ok_results = [result for result in engine_results if result["ok"]]
        ok_latencies = [float(result["latencyMs"]) for result in ok_results]
        summary[engine] = {
            "count": len(engine_results),
            "ok": len(ok_results),
            "error": len(engine_results) - len(ok_results),
            "latencyMs": latency_summary(ok_latencies),
        }
    return summary


def latency_summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {
            "min": None,
            "max": None,
            "mean": None,
            "median": None,
        }
    return {
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "mean": round(statistics.fmean(values), 3),
        "median": round(statistics.median(values), 3),
    }


if __name__ == "__main__":
    raise SystemExit(main())
