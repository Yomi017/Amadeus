# Architecture

## Current Stage

Amadeus is currently at Stage 4: GPT-SoVITS TTS provider boundary. Stage 1 established the monorepo skeleton; Stage 2 added a local mock desktop pet screen, chat panel, service status display, fallback character preview, and local speech-like UI actions. Stage 3 added provider-shaped Hermes contracts and a safe mock/real adapter boundary. Stage 4 adds GPT-SoVITS TTS contracts, a local HTTP provider, and a configurable service script without committing private voice or model material.

## Runtime Shape

Amadeus is organized as a Tauri v2 desktop app with a React and TypeScript frontend:

- Tauri owns the desktop shell, native window, future privileged APIs, and app packaging.
- React owns the webview-rendered interface.
- TypeScript packages define boundaries for domain logic, Hermes communication, TTS integration, and renderer-facing helpers.
- Rust code exposes only local mock Tauri commands in this stage.

## Package Boundaries

`@amadeus/core` contains shared types and constants that do not depend on desktop APIs, including service status, chat message, character state, assistant reply, Hermes request, safe result, and adapter contracts.

`@amadeus/hermes-adapter` implements the Stage 3 Hermes boundary. Mock mode is deterministic and local. Real mode requires an injected transport; it does not read Hermes private files, environment secrets, local credentials, or runtime state by itself.

`@amadeus/tts-gpt-sovits` implements the Stage 4 GPT-SoVITS boundary. Mock mode is deterministic and local. HTTP mode only talks to an explicitly configured local endpoint; it does not read model weights, reference audio, generated audio, or private paths from package code.

`@amadeus/renderer-static` is reserved for static renderer helpers and package-owned renderer metadata. It must not contain proprietary model, character, voice, CG, or extracted game assets.

`@amadeus/desktop` composes the packages into a Tauri application shell. The current React screen provides the rights-clean mock UI, uses the Hermes adapter mock reply helper, and can use TTS provider status/results through the package boundary without loading private model files. Full audio playback and speaking-state synchronization remain deferred.

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

Stage 3 is limited to:

- shared Hermes request/reply contracts
- safe degraded result and error types
- mock Hermes status and replies
- injected real transport boundary
- output sanitization for private paths and secret-like values
- desktop mock helper usage with no real Hermes calls

Stage 4 is limited to:

- shared TTS request/result/provider contracts
- GPT-SoVITS HTTP provider status and synthesize client
- local Python HTTP service script with explicit external model/reference paths
- mock TTS result behavior for UI and testability
- docs for running a private local service outside Git

Stages 5-6 remain deferred:

- private static character asset loading
- integrated chat -> TTS -> audio playback -> speaking state flow
