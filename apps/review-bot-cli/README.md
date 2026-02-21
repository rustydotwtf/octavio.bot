# @octavio.bot/review

CI-first PR review CLI that returns a pass/fail result and writes report artifacts.

## What It Does

1. Builds PR context from changed files.
2. Instructs OpenCode to write artifacts directly to disk using an artifact schema.
3. Validates artifacts in host runtime.
4. Applies fail policy from profile config or instruction frontmatter.

No GitHub review comments are created or updated.

## Run Published CLI

```bash
bunx --bun @octavio.bot/review@latest review --owner acme --repo web --pr 123 --workdir .
```

Initialize Octavio in your repository:

```bash
bunx --bun @octavio.bot/review@latest init --workdir .
```

This scaffolds:

- `.octavio/review.config.json`
- `.github/workflows/review-check.yml`

The generated workflow defaults to `OPENCODE_MODEL=opencode/minimax-m2.5-free` and sets `OPENCODE_API_KEY` to an empty fallback (`''`). If you move to a non-free model, set repository secret `OPENCODE_API_KEY`.

CLI binary name: `octavio-review`.

## OpenCode Detection and Install

- The CLI checks for `opencode` before running reviews.
- Local default is detect-only. If missing, the CLI prints install steps and exits.
- CI default (`GITHUB_ACTIONS=true`) auto-installs OpenCode when missing.
- `--install-opencode` forces local auto-install.

Manual install command:

```bash
curl -fsSL https://opencode.ai/install | bash
```

Helpful commands:

```bash
bunx --bun @octavio.bot/review@latest doctor
bunx --bun @octavio.bot/review@latest install-opencode
```

## Environment

```bash
GITHUB_TOKEN=...
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096
# OPENCODE_MODEL=... (optional; OpenCode default is used if omitted)
# OPENCODE_API_KEY=... (required for OpenCode Zen in CI)
```

Free OpenCode Zen model options:

- `opencode/minimax-m2.5-free`
- `opencode/glm-5-free`

## Local Source Development

From repo root:

```bash
bun install
bun run review-bot --owner acme --repo web --pr 123 --instructions-profile balanced --workdir .
```

Build and packaging notes:

- `bun run review-cli:build` builds the CLI bundle and syncs prompt markdown into `apps/review-bot-cli/prompts/`
- `bun run sync` from repo root runs the CLI `sync` task through Turborepo and refreshes generated prompts
- Prompt source-of-truth lives in `packages/prompts/prompts/*.md`; the app-level `prompts/` directory is generated for publishing

Optional flags:

- `--report-output path/to/review.md`
- `--findings-output path/to/confidence.json`
- `--result-output path/to/result.json`
- `--instructions-profile balanced`
- `--artifact-execution agent|host`
- `--install-opencode`

Init flags:

- `--workdir path/to/repo`
- `--force` (overwrite existing scaffolded files)

## Instruction Profiles

Instruction resolution order:

1. `--instructions` (explicit path)
2. `--instructions-profile` from `.octavio/review.config.json`
3. `defaultProfile` from `.octavio/review.config.json`
4. `@octavio.bot/prompts` package default (`balanced`)

Policy resolution order:

1. profile policy from `.octavio/review.config.json` (`policy.failOn`)
2. instruction frontmatter policy (`policy.fail_on`)

This repository includes three profiles in `.octavio/review.config.json`:

- `balanced`
- `styling`
- `security` (includes PR metadata/code mismatch checks)

## Artifact Outputs

Default artifact schema writes these files into `artifacts/`:

- `review.md` - human-readable review report
- `confidence.json` - machine-readable summary and findings

`confidence.json` requires:

- `summary` (string)
- `overallConfidence` (`low|medium|high`)
- `findings` (array with `id`, `severity`, `title`, `path`, `line`, `comment`)
- `meta` (object)

## Workflows

- Review workflow: `.github/workflows/review-check.yml`
  - Runs profile matrix (`balanced`, `styling`, `security`) with `max-parallel: 1`
  - Uses `bunx --bun @octavio.bot/review@latest`
  - Defaults to `OPENCODE_MODEL=opencode/minimax-m2.5-free`
  - Uses `OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY || '' }}`
  - Uploads `review.md`, `confidence.json`, and `result.json`
- CI workflow: `.github/workflows/ci.yml`
  - Includes smoke test: `bunx --bun @octavio.bot/review@latest doctor`
- Publish workflow: `.github/workflows/publish-review.yml`
  - Manual only (`workflow_dispatch`)
  - Publishes from `apps/review-bot-cli` using npm trusted publishing (OIDC)

## Troubleshooting

- If runs fail after changing models, set repository secret `OPENCODE_API_KEY`.
- If OpenCode is unreachable, verify `OPENCODE_HOSTNAME` and `OPENCODE_PORT`.
- If GitHub API requests fail, verify `GITHUB_TOKEN` permissions.
