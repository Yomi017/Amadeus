# Amadeus

Amadeus is a Tauri v2, React, and TypeScript monorepo for a Hermes-based desktop pet.

This repository is currently at Stage 5: static renderer boundary. The app has a rights-clean local mock desktop pet screen, service status strip, chat panel, local replay/stop-speech state, a provider-shaped Hermes adapter, a GPT-SoVITS HTTP TTS boundary, and a static fallback renderer boundary. Real Hermes chat, Live2D rendering, private character asset loading, generated audio commits, and full chat-to-audio playback integration are still deferred.

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

## Hygiene

The repository intentionally ignores proprietary assets, extracted game materials, model weights, generated audio, runtime caches, and Hermes private state. Keep rights-sensitive materials out of Git.

## Current Limits

- Hermes real mode requires an injected transport and does not auto-discover private Hermes files.
- TTS real mode requires an explicitly configured local HTTP endpoint and does not read model files from the frontend package.
- Character rendering uses a CSS fallback silhouette; private character image paths are configuration-only and not loaded in Stage 5.
- Full Tauri native build currently requires Linux system packages such as `pkg-config` and `libdbus-1-dev`.
