# Amadeus

Amadeus is a Tauri v2, React, and TypeScript monorepo scaffold for a Hermes-based Live2D desktop pet.

This repository is currently at Stage 1: scaffold and repo hygiene. The checked-in files define the workspace layout, package boundaries, Tauri desktop shell skeleton, and documentation baseline. Stage 2 UI behavior is intentionally not implemented here.

## Workspace Layout

- `apps/desktop` - Tauri v2 desktop application shell with a minimal React entry point.
- `packages/core` - Shared domain primitives and cross-package types.
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

Dependencies are declared but not installed by this scaffold. Do not run `npm install` unless a later approved stage explicitly allows dependency installation.

## Hygiene

The repository intentionally ignores proprietary assets, extracted game materials, model weights, generated audio, runtime caches, and Hermes private state. Keep rights-sensitive materials out of Git.

