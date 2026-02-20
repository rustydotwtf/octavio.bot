# octavio-review

Basic monorepo for a three-phase PR review bot:

1. Generate a markdown report with OpenCode SDK.
2. Evaluate existing review comments.
3. Add or update GitHub PR comments via API.

## Install

```bash
bun install
```

## Environment

Create `.env` with:

```bash
GITHUB_TOKEN=...
VERCEL_AI_GATEWAY_API_KEY=...
REVIEW_MODEL=anthropic/claude-sonnet-4.5
OPENCODE_MODEL=openai/gpt-5
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096
```

## Run

```bash
bun run review-bot --owner acme --repo web --pr 123 --instructions prompts/code-review.md --workdir .
```

Optional flags:

- `--report-output path/to/report.md`

## Layout

- `apps/review-bot-cli` CLI entrypoint.
- `packages/config` env/config parsing.
- `packages/opencode-runner` OpenCode report generation with locked permissions.
- `packages/github-review` GitHub REST helpers for PR files/comments.
- `packages/agent-runtime` AI SDK gateway model wiring.
- `packages/agent-code-review` report + comment reconciliation workflow.
