# GPT-SoVITS TTS

Stage 4 defines a local HTTP boundary for GPT-SoVITS. It does not commit model weights, reference audio, generated WAV files, or extracted game material.

## Service

Run the service from the repository root after preparing a separate GPT-SoVITS checkout and local model artifacts:

```bash
AMADEUS_GPT_SOVITS_DIR=/path/to/GPT-SoVITS \
AMADEUS_TTS_MODEL_DIR=/path/to/private/model-dir \
AMADEUS_TTS_GPT_CHECKPOINT=/path/to/private/model.ckpt \
AMADEUS_TTS_SOVITS_CHECKPOINT=/path/to/private/model.pth \
AMADEUS_TTS_REF_AUDIO=/path/to/private/reference.ogg \
AMADEUS_TTS_REF_TEXT='reference transcript in Japanese' \
AMADEUS_TTS_OUTPUT_DIR=/path/to/runtime/tts-cache \
python tools/tts/gpt_sovits_http_service.py
```

Use dry-run mode for integration checks without loading GPT-SoVITS:

```bash
AMADEUS_TTS_DRY_RUN=1 python tools/tts/gpt_sovits_http_service.py
```

The service exposes:

- `GET /status`
- `POST /synthesize`
- `GET /audio/<generated-file>.wav`

Example request:

```bash
curl -s http://127.0.0.1:48162/synthesize \
  -H 'content-type: application/json' \
  -d '{"id":"local-test","text":"おはよう。"}'
```

`POST /synthesize` returns an HTTP `audioUrl` such as:

```json
{
  "audioUrl": "http://127.0.0.1:48162/audio/local-test.wav"
}
```

The desktop app plays that URL directly. Generated audio remains in the runtime cache outside the repository.

## Repository Hygiene

Keep the following outside Git:

- model directories and checkpoint files
- reference voice samples
- generated audio cache
- extracted game assets
- Hermes private state and credentials
