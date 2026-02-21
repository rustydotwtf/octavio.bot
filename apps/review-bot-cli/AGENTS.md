# Review CLI Agent Notes

Scope: applies to files under `apps/review-bot-cli`.

## Package Intent

- This app is the publishable CLI package `@octavio.bot/review`.
- Binary name is `octavio-review`.
- Keep CLI UX stable and explicit; avoid adding compatibility aliases unless requested.

## Key Behavior

- Primary command is `review`.
- Support commands: `doctor`, `install-opencode`.
- OpenCode handling posture:
  - Local default: detect-only, print install command when missing.
  - CI default (`GITHUB_ACTIONS=true`): auto-install when missing.
  - `--install-opencode` forces local auto-install.

## Development Commands

Run from repo root:

- Build CLI bundle: `bun run review-cli:build`
- Run local source CLI: `bun run review-bot ...`
- Validate workspace quality: `bun run check && bun run build && bun run test`

## Publishing Notes

- Package metadata lives in `apps/review-bot-cli/package.json`.
- Keep `bin`, `files`, and `prepack` accurate for npm consumers.
- Prompt source-of-truth is `packages/prompts/prompts/*.md`.
- `apps/review-bot-cli/prompts/` is generated via `bun run sync` (or `bun run sync:prompts`) and is not source-authored.
- `prepack` must produce an executable `dist/index.mjs` and include generated `prompts/*.md` in the published tarball (the bundled CLI resolves default prompt files from package-relative paths).
- If CLI behavior or flags change, update both:
  - `apps/review-bot-cli/README.md`
  - root `README.md` links/overview where relevant
