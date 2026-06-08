# TTS Benchmark

This benchmark compares local Amadeus-compatible TTS endpoints. It is safe to run against dry-run services and does not require committing generated audio.

## Command

```bash
python tools/tts/benchmark_tts_engines.py --engine both --repeat 1
```

Defaults:

- PyTorch GPT-SoVITS: `http://127.0.0.1:48162`
- Genie ONNX: `http://127.0.0.1:48163`

The script only accepts loopback HTTP endpoints with explicit ports, posts 20 fixed Japanese prompts to `/synthesize`, and emits JSON to stdout.

## Current Status

Engineering integration is ready:

- PyTorch and Genie services share the same `/status`, `/synthesize`, and `/audio/<id>.wav` shape.
- The desktop app can switch with `AMADEUS_TTS_ENGINE`.
- Genie remains opt-in until real ONNX conversion and subjective voice checks pass.

Real benchmark numbers are intentionally not recorded in Git because generated audio and private model artifacts are local-only.

## Acceptance

Genie can become the default only after:

- all 20 prompts synthesize successfully in repeated runs,
- warm latency and RTF are better than PyTorch,
- generated speech is subjectively close enough for the private prototype,
- no private paths, model filenames, generated WAV files, or logs are committed.
