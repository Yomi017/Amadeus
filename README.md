# Amadeus

Amadeus is a Tauri v2, React, and TypeScript monorepo for a Hermes-based desktop pet.

This repository is currently at Stage 2: desktop shell. The app has a rights-clean local mock desktop pet screen, service status strip, chat panel, and local replay/stop-speech state. Real Hermes chat, GPT-SoVITS synthesis, Live2D rendering, private character assets, and generated audio are still deferred.

## Workspace Layout

- `apps/desktop` - Tauri v2 desktop application shell with React UI, mock chat, and fallback character preview.
- `packages/core` - Shared domain primitives, service status, chat message, and character state types.
- `packages/hermes-adapter` - Placeholder boundary for future Hermes integration.
- `packages/tts-gpt-sovits` - Placeholder boundary for future GPT-SoVITS TTS integration.
- `packages/renderer-static` - Placeholder boundary for static renderer assets and helpers.
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

- Hermes is mock-only.
- TTS is mock-only and does not generate or play audio.
- Character rendering uses a CSS fallback silhouette, not private character assets.
- Full Tauri native build currently requires Linux system packages such as `pkg-config` and `libdbus-1-dev`.
