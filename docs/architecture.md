# Architecture

## Current Stage

Amadeus is currently at Stage 6: v0 integration skeleton. Stage 1 established the monorepo skeleton; Stage 2 added a local mock desktop pet screen, chat panel, service status display, fallback character preview, and local speech-like UI actions. Stage 3 added provider-shaped Hermes contracts and a safe mock/real adapter boundary. Stage 4 added GPT-SoVITS TTS contracts, a local HTTP provider, and a configurable service script without committing private voice or model material. Stage 5 added a rights-clean static renderer boundary and private asset path guardrails without loading proprietary character assets. Stage 6 wires the desktop mock chat flow through Hermes reply text, TTS metadata, and static renderer state.

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

`@amadeus/renderer-static` implements the Stage 5 static renderer boundary. It exports rights-clean fallback metadata and renderer state helpers. Private character image paths are treated as configuration-only and are not read, copied, rendered, or committed in Stage 5.

`@amadeus/desktop` composes the packages into a Tauri application shell. The current React screen provides the rights-clean mock UI, uses the Hermes adapter mock reply helper, attaches GPT-SoVITS mock speech metadata, and displays static fallback renderer state. Real audio playback and private asset loading remain deferred.

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

Stage 5 is limited to:

- static renderer request/snapshot/config contracts
- rights-clean CSS fallback asset descriptor
- private image path guardrails and redaction
- renderer status/snapshot tests
- desktop fallback descriptor display

Stage 6 is limited to:

- user input to Hermes mock reply orchestration
- assistant reply to TTS mock metadata
- speech job metadata on assistant messages
- static renderer class metadata for speaking/idle state
- local stop/replay state transitions

Remaining deferred work:

- private static character asset loading
- real audio playback and audio lifecycle
- real Hermes transport integration
