# Octavio Monorepo

This repository is a Bun workspace for building multiple Octavio agents and shared tooling packages.

## Workspace Structure

- `apps/` - runnable agent/CLI applications
- `packages/` - reusable shared libraries used across apps

Current app:

- `apps/review-bot-cli` - publishable PR review CLI package (`@octavio.bot/review`)
- `apps/site` - static product site for `octavio.bot`

Current shared packages:

- `packages/config` - runtime env and CLI config parsing
- `packages/opencode-runner` - OpenCode SDK wrapper and artifact generation runtime
- `packages/github-review` - GitHub PR metadata and changed-file helpers
- `packages/agent-code-review` - review orchestration and policy evaluation
- `packages/prompts` - publishable prompt package (`@octavio.bot/prompts`)

Prompt authoring and packaging:

- Author prompt markdown only in `packages/prompts/prompts/*.md`
- `apps/review-bot-cli/prompts/` is generated during `build`/`prepack` for npm tarballs

## App Documentation

App-specific setup, usage, and behavior live with each app.

- Review CLI docs: `apps/review-bot-cli/README.md`
- Site docs: `apps/site/README.md`

## Development Commands

```bash
bun install
bun run sync
bun run check
bun run build
bun run test
```

Root `check`, `build`, and `test` commands are orchestrated via Turborepo (`turbo run ...`).
Root `sync` runs workspace sync tasks (currently prompt bundling for the review CLI).

Useful workflow commands:

- Local review CLI source run: `bun run review-bot ...`
- Build publishable review CLI: `bun run review-cli:build`
- Run site locally: `bun run --cwd apps/site dev`
- Build site: `bun run --cwd apps/site build`
- Deploy site (Vercel): `bun run --cwd apps/site deploy`
- Initialize Octavio files in any repo: `bunx --bun @octavio.bot/review@latest init --workdir .`

## CI

- `.github/workflows/ci.yml` runs `bun run sync` and fails on tracked drift, then runs workspace lint/build/test and a published CLI smoke check
- `.github/workflows/review-check.yml` runs PR review profiles via `bunx --bun @octavio.bot/review@latest`
- `.github/workflows/publish-review.yml` is manual (`workflow_dispatch`) and publishes `@octavio.bot/review` from `apps/review-bot-cli`
