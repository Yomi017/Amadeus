# Amadeus

Amadeus is a Tauri v2, React, and TypeScript monorepo for a Hermes-based desktop pet.

This repository is currently at Stage 6: v0 integration skeleton. The app has a rights-clean local mock desktop pet screen, service status strip, chat panel, local replay/stop-speech state, a provider-shaped Hermes adapter, a GPT-SoVITS HTTP TTS boundary, a static fallback renderer boundary, an optional local-only private static character image for development, and a mock chat-to-speech-metadata-to-renderer flow. Real Hermes chat, Live2D rendering, generated audio commits, and real audio playback are still deferred.

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

## Local Private Character Image

For local private prototyping, copy `.env.example` to `.env.local` and set:

```sh
VITE_AMADEUS_PRIVATE_CHARACTER_IMAGE=/path/to/private/character.png
```

`.env.local` is ignored by Git. Do not commit proprietary character art or extracted game assets.

## Hygiene

The repository intentionally ignores proprietary assets, extracted game materials, model weights, generated audio, runtime caches, and Hermes private state. Keep rights-sensitive materials out of Git.

## Current Limits

- Hermes real mode requires an injected transport and does not auto-discover private Hermes files.
- TTS real mode requires an explicitly configured local HTTP endpoint and does not read model files from the frontend package.
- Character rendering can display one local private static image during development, but Live2D model loading is still deferred.
- Full Tauri native build currently requires Linux system packages from the Tauri Linux prerequisites.
