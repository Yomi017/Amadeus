#!/usr/bin/env python3
"""Convert a private GPT-SoVITS checkpoint pair to Genie-TTS ONNX artifacts.

All source checkpoints and generated ONNX files must stay outside this
repository. The script is intentionally a thin wrapper over Genie-TTS'
documented Python API so conversion behavior stays owned by Genie.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path
from typing import Any


DEFAULT_GENIE_DIR = "/home/shinku/data/code/Genie-TTS"
DEFAULT_OUTPUT_DIR = "/home/shinku/data/plan/tts-desktop-pet/work/genie_onnx/shinku_v2proplus_v1"
REQUIRED_ONNX_FILES = {
    "t2s_encoder_fp32.bin",
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp16.bin",
    "vits_fp32.onnx",
}


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    genie_dir = resolve_path(args.genie_dir)
    output_dir = resolve_path(args.output_dir)
    torch_ckpt_path = resolve_path(args.torch_ckpt_path)
    torch_pth_path = resolve_path(args.torch_pth_path)

    ensure_file(torch_ckpt_path, "GPT checkpoint")
    ensure_file(torch_pth_path, "SoVITS checkpoint")
    ensure_directory(genie_dir, "Genie-TTS checkout")
    ensure_output_dir(repo_root, output_dir, force=args.force)

    if args.dry_run:
        print_jsonish(
            {
                "dryRun": True,
                "genieDir": label_path(genie_dir),
                "outputDir": label_path(output_dir),
                "torchCkpt": label_path(torch_ckpt_path),
                "torchPth": label_path(torch_pth_path),
            }
        )
        return 0

    sys.path.insert(0, str(genie_dir / "src"))
    import genie_tts as genie  # type: ignore[import-not-found]

    genie.convert_to_onnx(
        torch_pth_path=str(torch_pth_path),
        torch_ckpt_path=str(torch_ckpt_path),
        output_dir=str(output_dir),
    )
    validate_converted_output(output_dir)
    print_jsonish(
        {
            "converted": True,
            "outputDir": label_path(output_dir),
            "requiredFilesPresent": True,
        }
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert GPT-SoVITS checkpoints to Genie-TTS ONNX artifacts.")
    parser.add_argument("--genie-dir", default=os.environ.get("AMADEUS_GENIE_DIR", DEFAULT_GENIE_DIR))
    parser.add_argument("--output-dir", default=os.environ.get("AMADEUS_GENIE_ONNX_DIR", DEFAULT_OUTPUT_DIR))
    parser.add_argument("--torch-ckpt-path", default=os.environ.get("AMADEUS_TTS_GPT_CHECKPOINT", ""))
    parser.add_argument("--torch-pth-path", default=os.environ.get("AMADEUS_TTS_SOVITS_CHECKPOINT", ""))
    parser.add_argument("--force", action="store_true", help="Remove an existing non-empty output directory before conversion.")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs without importing Genie or writing ONNX files.")
    return parser.parse_args()


def resolve_path(value: str) -> Path:
    if not value:
        raise SystemExit("required path is missing")
    return Path(value).expanduser().resolve()


def ensure_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise SystemExit(f"{label} file is missing: {path.name}")


def ensure_directory(path: Path, label: str) -> None:
    if not path.is_dir():
        raise SystemExit(f"{label} directory is missing: {path}")


def ensure_output_dir(repo_root: Path, output_dir: Path, *, force: bool) -> None:
    ensure_outside_repo(repo_root, output_dir, "Genie ONNX output directory")
    if output_dir.exists() and any(output_dir.iterdir()):
        if not force:
            raise SystemExit("Genie ONNX output directory is not empty; pass --force to replace it")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)


def ensure_outside_repo(repo_root: Path, path: Path, label: str) -> None:
    try:
        path.resolve().relative_to(repo_root.resolve())
    except ValueError:
        return
    raise SystemExit(f"{label} must be outside the repository")


def validate_converted_output(output_dir: Path) -> None:
    existing = {entry.name for entry in output_dir.iterdir() if entry.is_file()}
    missing = sorted(REQUIRED_ONNX_FILES - existing)
    if missing:
        raise SystemExit(f"Genie conversion finished but required files are missing: {', '.join(missing)}")


def label_path(path: Path) -> str:
    return path.name or str(path)


def print_jsonish(payload: dict[str, Any]) -> None:
    import json

    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
