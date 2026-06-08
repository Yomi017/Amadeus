# Git Workflow

Amadeus is intended for serial collaboration by multiple agents and humans.

## Rules

- Do not revert or overwrite changes you did not make.
- Check `git status --short` before and after edits.
- Keep each stage scoped to its approved objective.
- Do not commit or push unless explicitly asked.
- Do not install dependencies or create lockfiles unless the active stage explicitly allows it.
- Record unresolved blockers in the final handoff.

## Stage Handoff

Each module agent should report:

- changed files
- verification commands run
- commands intentionally skipped
- unfinished items or blockers

## Sensitive Material

Never commit API keys, tokens, cookies, credentials, proprietary game assets, extracted character materials, generated speech cache, model weights, or Hermes private state.

