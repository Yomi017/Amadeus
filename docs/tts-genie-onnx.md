# Genie-TTS ONNX

Genie-TTS is the optional ONNX acceleration path for Amadeus TTS. It runs beside the current GPT-SoVITS PyTorch HTTP service and uses the same local HTTP API shape so the desktop app can switch endpoints without frontend changes.

## Current Default

Keep the PyTorch GPT-SoVITS service as the default engine until Genie quality and latency are accepted:

```bash
AMADEUS_TTS_ENGINE=py-gpt-sovits
AMADEUS_TTS_ENDPOINT=http://127.0.0.1:48162
```

Enable Genie explicitly:

```bash
AMADEUS_TTS_ENGINE=genie-onnx
AMADEUS_TTS_ENDPOINT=http://127.0.0.1:48163
```

If `AMADEUS_TTS_ENDPOINT` is not set, the desktop app chooses the default endpoint from `AMADEUS_TTS_ENGINE`: `48162` for `py-gpt-sovits`, `48163` for `genie-onnx`.

## Local Paths

Keep all model and generated audio artifacts outside this repository:

```bash
AMADEUS_GENIE_DIR=/home/shinku/data/code/Genie-TTS
AMADEUS_GENIE_ONNX_DIR=/home/shinku/data/plan/tts-desktop-pet/work/genie_onnx/shinku_v2proplus_v1
AMADEUS_TTS_OUTPUT_DIR=/tmp/amadeus-genie-tts-cache
```

The trained source checkpoints stay private and untracked:

```bash
AMADEUS_TTS_GPT_CHECKPOINT=/path/to/private/model.ckpt
AMADEUS_TTS_SOVITS_CHECKPOINT=/path/to/private/model.pth
AMADEUS_TTS_REF_AUDIO=/path/to/private/reference.ogg
AMADEUS_TTS_REF_TEXT='reference transcript in Japanese'
```

## Genie API Facts

The local Genie checkout is `High-Logic/Genie-TTS`. Its public Python API includes:

- `genie_tts.convert_to_onnx(torch_pth_path, torch_ckpt_path, output_dir)`
- `genie_tts.load_character(character_name, onnx_model_dir, language)`
- `genie_tts.set_reference_audio(character_name, audio_path, audio_text, language)`
- `genie_tts.tts(character_name, text, play, split_sentence, save_path)`

The project documents `convert_to_onnx` support for GPT-SoVITS `V2` and `V2ProPlus`. The converted model directory must contain Genie ONNX files such as `t2s_encoder_fp32.onnx`, `t2s_first_stage_decoder_fp32.onnx`, `t2s_stage_decoder_fp32.onnx`, and `vits_fp32.onnx`; V2ProPlus also uses `prompt_encoder_fp32.onnx`.

## HTTP API

The Genie service must match the existing PyTorch service:

- `GET /status`
- `POST /synthesize`
- `GET /audio/<generated-file>.wav`

Example:

```bash
AMADEUS_TTS_DRY_RUN=1 python tools/tts/genie_http_service.py

curl -s http://127.0.0.1:48163/synthesize \
  -H 'content-type: application/json' \
  -d '{"id":"genie-test","text":"おはよう。","locale":"ja"}'
```

Response:

```json
{
  "id": "tts-genie-test",
  "requestId": "genie-test",
  "audioUrl": "http://127.0.0.1:48163/audio/genie-test.wav",
  "format": "wav",
  "mimeType": "audio/wav"
}
```

## Validation

Benchmark PyTorch and Genie before changing defaults:

```bash
python tools/tts/benchmark_tts_engines.py --engine both --repeat 1
```

Accept Genie only if:

- `GET /status` is ready.
- `POST /synthesize` generates valid WAV files repeatedly.
- Warm synthesis latency and RTF are better than PyTorch on the same Japanese prompts.
- Subjective voice similarity is acceptable for the private local prototype.

## Hygiene

Do not commit:

- `.ckpt`, `.pth`, `.onnx`, `.bin`, or converted Genie artifact files
- reference voice samples
- generated WAV output
- extracted game assets
- private Hermes state, tokens, or logs
