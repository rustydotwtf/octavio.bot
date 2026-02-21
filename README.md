# octavio-review

CI-first PR review gate that returns a GitHub check result (pass/fail) and uploads a report artifact.

## What It Does

1. Builds PR context from changed files.
2. Instructs OpenCode to write artifacts directly to disk using an Artifact Schema.
3. Validates artifacts with `bun run validate-artifacts`.
4. Compares current findings to the previous run artifact (`new`, `persisting`, `resolved`).
5. Applies fail policy from profile config or instruction frontmatter.

No GitHub review comments are created or updated.

## Install

```bash
bun install
```

## Environment

Create `.env` with:

```bash
GITHUB_TOKEN=...
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096
# OPENCODE_MODEL=... (optional; if omitted, OpenCode default model is used)
# OPENCODE_API_KEY=... (required for OpenCode Zen in CI)
```

For free OpenCode Zen models, use one of:

- `opencode/minimax-m2.5-free`
- `opencode/glm-5-free`

## Local Run

```bash
bun run review-bot --owner acme --repo web --pr 123 --instructions-profile balanced --workdir .
```

Optional flags:

- `--report-output path/to/review.md`
- `--findings-output path/to/confidence.json`
- `--result-output path/to/result.json`
- `--previous-findings path/to/previous-confidence.json`
- `--instructions-profile balanced`
- `--artifact-execution agent|host`

Instruction resolution order:

1. `--instructions` (explicit path)
2. `--instructions-profile` from `.octavio/review.config.json`
3. `defaultProfile` from `.octavio/review.config.json`
4. `@octavio.bot/prompts` package default (`balanced`)

Policy resolution order:

1. profile policy from `.octavio/review.config.json` (`policy.failOn`)
2. instruction frontmatter policy (`policy.fail_on`)
3. fail-open fallback

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
        "validatorCommand": "bun run validate-artifacts --dir artifacts",
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
- Provided but empty (`[]`) or invalid: treat config as selected, then fail-open with warnings.

Frontmatter example:

```yaml
---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
---
```

Supported scope: `any`, `new`, `persisting`, `resolved`.

When both are present, profile config wins.

If policy is missing or invalid, the runner uses fail-open fallback and reports warnings in `result.json`.

## Artifact Schema

Default artifact schema writes these files into `artifacts/`:

- `review.md` - human-readable review report
- `confidence.json` - machine-readable summary and findings

Validation is enforced by `bun run validate-artifacts --dir artifacts`.

`confidence.json` schema requires:

- `summary` (string)
- `overallConfidence` (`low|medium|high`)
- `findings` (array; each finding requires `id`, `severity`, `title`, `path`, `line`, `comment`)
- `meta` (object)

## GitHub Action

Workflow file: `.github/workflows/review-check.yml`

- Posts a concise summary in the job summary panel.
- Uploads `review.md`, `confidence.json`, and `result.json` as artifacts.
- Reuses previous confidence artifact by PR number and profile for comparison.
- Runs a profile matrix (`balanced`, `styling`, `security`) with `max-parallel: 1` so matrix jobs execute one at a time.
- Defaults `OPENCODE_MODEL` to `opencode/minimax-m2.5-free` unless overridden by repository variable.

## Layout

- `apps/review-bot-cli` CLI entrypoint.
- `packages/config` env/config parsing.
- `packages/opencode-runner` OpenCode report generation with locked permissions.
- `packages/github-review` GitHub REST helpers for PR metadata and file diffs.
- `packages/agent-code-review` report parsing, previous-run comparison, and policy evaluation.
- `packages/prompts` publishable prompt package (`@octavio.bot/prompts`).
