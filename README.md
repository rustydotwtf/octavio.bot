# Octavio Monorepo

This repository is a Bun workspace for building multiple Octavio agents and shared tooling packages.

## Workspace Structure

- `apps/` - runnable agent/CLI applications
- `packages/` - reusable shared libraries used across apps

Current app:

- `apps/review-bot-cli` - publishable PR review CLI package (`@octavio.bot/review`)

Current shared packages:

- `packages/config` - runtime env and CLI config parsing
- `packages/opencode-runner` - OpenCode SDK wrapper and artifact generation runtime
- `packages/github-review` - GitHub PR metadata and changed-file helpers
- `packages/agent-code-review` - review orchestration and policy evaluation
- `packages/prompts` - publishable prompt package (`@octavio.bot/prompts`)

## App Documentation

App-specific setup, usage, and behavior live with each app.

- Review CLI docs: `apps/review-bot-cli/README.md`

## Development Commands

```bash
bun install
bun run check
bun run build
bun run test
```

Useful workflow commands:

- Local review CLI source run: `bun run review-bot ...`
- Build publishable review CLI: `bun run review-cli:build`

## CI

- `.github/workflows/ci.yml` runs workspace lint/build/test and a published CLI smoke check
- `.github/workflows/review-check.yml` runs PR review profiles via `bunx --bun @octavio.bot/review@latest`
