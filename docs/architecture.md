# Architecture

## Current Stage

Amadeus is currently at Stage 2: desktop shell. Stage 1 established the monorepo skeleton; Stage 2 adds a local mock desktop pet screen, chat panel, service status display, fallback character preview, and local speech-like UI actions.

## Runtime Shape

Amadeus is organized as a Tauri v2 desktop app with a React and TypeScript frontend:

- Tauri owns the desktop shell, native window, future privileged APIs, and app packaging.
- React owns the webview-rendered interface.
- TypeScript packages define boundaries for domain logic, Hermes communication, TTS integration, and renderer-facing helpers.
- Rust code exposes only local mock Tauri commands in this stage.

## Package Boundaries

`@amadeus/core` contains shared types and constants that do not depend on desktop APIs, including service status, chat message, and character state contracts.

`@amadeus/hermes-adapter` is reserved for future Hermes connection, state synchronization, and protocol translation. Stage 1 only defines a placeholder export.

`@amadeus/tts-gpt-sovits` is reserved for future GPT-SoVITS client and speech pipeline code. Stage 1 only defines a placeholder export.

`@amadeus/renderer-static` is reserved for static renderer helpers and package-owned renderer metadata. It must not contain proprietary model, character, voice, CG, or extracted game assets.

`@amadeus/desktop` composes the packages into a Tauri application shell. The current React screen provides the Stage 2 rights-clean mock UI and does not call real Hermes, TTS, Live2D, or network services.

## Security and Asset Hygiene

Treat character rights, voice-cloning rights, and proprietary source assets as unresolved unless explicitly narrowed to local private prototyping in a later approved stage.

Do not commit:

- proprietary Live2D models or textures
- extracted game voice, CG, scripts, or character materials
- model weights and checkpoints
- generated WAV or TTS cache output
- Hermes private runtime state
- API keys, cookies, tokens, credentials, or private account data

## Stage Boundaries

Stage 2 is limited to local UI behavior:

- mock chat messages
- local replay and stop-speech state
- fallback CSS character preview
- static service status badges
- mock Tauri commands with no file, network, or private service access

Stages 3-6 remain deferred:

- real or configurable Hermes adapter behavior
- GPT-SoVITS local service
- private static character asset loading
- integrated chat -> TTS -> audio playback -> speaking state flow
