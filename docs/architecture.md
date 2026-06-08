# Architecture

## Stage 1 Scope

Stage 1 establishes a monorepo skeleton for a desktop pet application without implementing the interactive UI, Hermes runtime behavior, Live2D rendering, or TTS pipeline.

## Runtime Shape

Amadeus is organized as a Tauri v2 desktop app with a React and TypeScript frontend:

- Tauri owns the desktop shell, native window, future privileged APIs, and app packaging.
- React owns the webview-rendered interface.
- TypeScript packages define boundaries for domain logic, Hermes communication, TTS integration, and renderer-facing helpers.
- Rust code is limited to the minimal Tauri bootstrap in this stage.

## Package Boundaries

`@amadeus/core` contains shared types and constants that do not depend on desktop APIs.

`@amadeus/hermes-adapter` is reserved for future Hermes connection, state synchronization, and protocol translation. Stage 1 only defines a placeholder export.

`@amadeus/tts-gpt-sovits` is reserved for future GPT-SoVITS client and speech pipeline code. Stage 1 only defines a placeholder export.

`@amadeus/renderer-static` is reserved for static renderer helpers and package-owned renderer metadata. It must not contain proprietary model, character, voice, CG, or extracted game assets.

`@amadeus/desktop` composes the packages into a Tauri application shell. The current React screen is only a scaffold marker.

## Security and Asset Hygiene

Treat character rights, voice-cloning rights, and proprietary source assets as unresolved unless explicitly narrowed to local private prototyping in a later approved stage.

Do not commit:

- proprietary Live2D models or textures
- extracted game voice, CG, scripts, or character materials
- model weights and checkpoints
- generated WAV or TTS cache output
- Hermes private runtime state
- API keys, cookies, tokens, credentials, or private account data

## Stage 2 Boundary

Future UI work should be proposed and approved separately. Stage 2 should not be inferred from the existence of the desktop shell files in this scaffold.

