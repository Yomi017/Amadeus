# Amadeus

Amadeus is a Tauri v2, React, and TypeScript monorepo for a Hermes-based desktop pet.

This repository is currently at Stage 6: v0 integration skeleton. The app has a rights-clean desktop pet screen, a compact chat input, a Hermes CLI chat bridge, Japanese speech text generation before TTS, a local GPT-SoVITS HTTP TTS bridge, audio playback state, a static fallback renderer boundary, and an optional local-only private static character image for development. Live2D model loading is still deferred.

## Workspace Layout

- `apps/desktop` - Tauri v2 desktop application shell with React UI, mock chat, and fallback character preview.
- `packages/core` - Shared domain primitives, service status, chat message, character state, and Hermes adapter contract types.
- `packages/hermes-adapter` - Mock/real Hermes adapter boundary with injected transport support and output sanitization.
- `packages/tts-gpt-sovits` - GPT-SoVITS HTTP TTS provider/client boundary.
- `packages/renderer-static` - Rights-clean static renderer fallback and private asset configuration boundary.
- `docs` - Architecture notes, references, and collaboration workflow.

## Scripts

The root `package.json` uses npm workspaces:

```sh
npm run dev
npm run build
npm run typecheck
npm run test
```

Dependencies are installed with npm workspaces and pinned by `package-lock.json`.

## Local Run

Start the GPT-SoVITS service first, then launch the desktop app:

```sh
AMADEUS_TTS_DRY_RUN=1 python tools/tts/gpt_sovits_http_service.py
npm run dev
```

For real voice, replace dry-run with the private model/reference environment variables described in `docs/tts-gpt-sovits.md`. The desktop app calls Hermes through the local `hermes chat` CLI, and on Windows it uses `wsl.exe` to reach the WSL Hermes install.

To test the optional Genie-TTS ONNX engine shape without loading a real model:

```sh
AMADEUS_TTS_DRY_RUN=1 python tools/tts/genie_http_service.py
AMADEUS_TTS_ENGINE=genie-onnx npm run dev
```

For real Genie ONNX inference, first convert the private GPT-SoVITS checkpoints outside this repository, then run `tools/tts/genie_http_service.py` with the private paths described in `docs/tts-genie-onnx.md`.

## Local Private Character Image

For local private prototyping, copy `.env.example` to `apps/desktop/.env.local` and set:

```sh
VITE_AMADEUS_PRIVATE_CHARACTER_IMAGE=/path/to/private/character.png
```

`apps/desktop/.env.local` is ignored by Git. Do not commit proprietary character art or extracted game assets.

## Hygiene

The repository intentionally ignores proprietary assets, extracted game materials, model weights, generated audio, runtime caches, and Hermes private state. Keep rights-sensitive materials out of Git.

## Current Limits

- Hermes real mode shells out to local Hermes/WSL Hermes and does not read or print private Hermes files.
- TTS real mode requires an explicitly configured local HTTP endpoint and does not read model files from the frontend package.
- Character rendering can display one local private static image during development, but Live2D model loading is still deferred.
- Full Tauri native build currently requires Linux system packages from the Tauri Linux prerequisites.
