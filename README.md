# octavio-review

CI-first PR review gate that returns a GitHub check result (pass/fail) and uploads report artifacts.

## What It Does

1. Builds PR context from changed files.
2. Instructs OpenCode to write artifacts directly to disk using an artifact schema.
3. Validates artifacts in host runtime.
4. Applies fail policy from profile config or instruction frontmatter.

No GitHub review comments are created or updated.

## CLI Package

Published CLI package: `@octavio.bot/review`.

Run without local install:

```bash
bunx --bun @octavio.bot/review@latest review --owner acme --repo web --pr 123 --workdir .
```

CLI binary name: `octavio-review`.

### OpenCode Detection and Install

- The CLI checks for `opencode` before running reviews.
- Local default: detect-only. If missing, it prints install steps and exits.
- CI default (`GITHUB_ACTIONS=true`): auto-installs OpenCode when missing.
- You can force auto-install locally with `--install-opencode`.

Manual install command:

```bash
curl -fsSL https://opencode.ai/install | bash
```

Useful commands:

```bash
bunx --bun @octavio.bot/review@latest doctor
bunx --bun @octavio.bot/review@latest install-opencode
```

## Environment

Provide these variables:

```bash
GITHUB_TOKEN=...
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096
# OPENCODE_MODEL=... (optional; OpenCode default is used if omitted)
# OPENCODE_API_KEY=... (required for OpenCode Zen in CI)
```

For free OpenCode Zen models, use one of:

- `opencode/minimax-m2.5-free`
- `opencode/glm-5-free`

## Local Development

Install workspace dependencies:

```bash
bun install
```

Run local source CLI:

```bash
bun run review-bot --owner acme --repo web --pr 123 --instructions-profile balanced --workdir .
```

Optional flags:

- `--report-output path/to/review.md`
- `--findings-output path/to/confidence.json`
- `--result-output path/to/result.json`
- `--instructions-profile balanced`
- `--artifact-execution agent|host`
- `--install-opencode`

Instruction resolution order:

1. `--instructions` (explicit path)
2. `--instructions-profile` from `.octavio/review.config.json`
3. `defaultProfile` from `.octavio/review.config.json`
4. `@octavio.bot/prompts` package default (`balanced`)

Policy resolution order:

1. profile policy from `.octavio/review.config.json` (`policy.failOn`)
2. instruction frontmatter policy (`policy.fail_on`)

### Optional review config

Create `.octavio/review.config.json` to manage instruction profiles and policy overrides:

```json
{
  "defaultProfile": "balanced",
  "profiles": {
    "balanced": {
      "artifactExecution": "agent",
      "artifactSchema": {
        "artifactDir": "artifacts",
        "reviewFile": "review.md",
        "confidenceFile": "confidence.json",
        "maxAttempts": 2
      },
      "instructionsPrompt": "balanced",
      "policy": {
        "failOn": ["new:high", "new:critical"]
      }
    },
    "security": {
      "instructionsPrompt": "security",
      "policy": {
        "failOn": ["new:medium", "new:high", "new:critical"]
      }
    }
  }
}
```

This repository includes a committed `.octavio/review.config.json` with three profiles:

- `balanced` (`@octavio.bot/prompts` `balanced` prompt)
- `styling` (`@octavio.bot/prompts` `styling` prompt)
- `security` (`@octavio.bot/prompts` `security` prompt, including PR metadata/code mismatch checks)

## Policy Configuration

Policy can be set either in profile config (`policy.failOn`) or in YAML frontmatter in instructions (`policy.fail_on`).

`policy.failOn` semantics:

- Omitted (`undefined`): evaluate frontmatter `policy.fail_on`.
- Provided but empty (`[]`) or invalid: error (fail-closed).

Frontmatter example:

```yaml
---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
---
```

Supported scope: `any`, `new`.

When both are present, profile config wins.

If policy is missing or invalid, the runner errors (fail-closed).

## Artifact Schema

Default artifact schema writes these files into `artifacts/`:

- `review.md` - human-readable review report
- `confidence.json` - machine-readable summary and findings

`confidence.json` schema requires:

- `summary` (string)
- `overallConfidence` (`low|medium|high`)
- `findings` (array; each finding requires `id`, `severity`, `title`, `path`, `line`, `comment`)
- `meta` (object)

## GitHub Actions

- Review workflow: `.github/workflows/review-check.yml`
  - Runs profile matrix (`balanced`, `styling`, `security`) with `max-parallel: 1`
  - Uses `bunx --bun @octavio.bot/review@latest`
  - Auto-installs OpenCode when missing in CI
  - Uploads `review.md`, `confidence.json`, and `result.json` artifacts
- CI workflow: `.github/workflows/ci.yml`
  - Runs lint/build/test on workspace source
  - Includes a published CLI smoke check via `bunx --bun @octavio.bot/review@latest doctor`

## Layout

- `apps/review-bot-cli` publishable CLI package (`@octavio.bot/review`).
- `packages/config` env/config parsing.
- `packages/opencode-runner` OpenCode report generation with locked permissions.
- `packages/github-review` GitHub REST helpers for PR metadata and file diffs.
- `packages/agent-code-review` report parsing and policy evaluation.
- `packages/prompts` publishable prompt package (`@octavio.bot/prompts`).

`packages/*` remains the canonical reusable workspace boundary. Empty or placeholder package directories are removed rather than kept around.
