# octavio-review

CI-first PR review gate that returns a GitHub check result (pass/fail) and uploads a report artifact.

## What It Does

1. Builds PR context from changed files.
2. Generates a markdown review report with OpenCode.
3. Extracts structured findings from SDK JSON schema output (with markdown JSON fallback).
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
bun run review-bot --owner acme --repo web --pr 123 --instructions prompts/code-review.md --workdir .
```

Optional flags:

- `--report-output path/to/report.md`
- `--findings-output path/to/findings.json`
- `--result-output path/to/result.json`
- `--previous-findings path/to/previous-findings.json`
- `--instructions-profile balanced`

Instruction resolution order:

1. `--instructions` (explicit path)
2. `--instructions-profile` from `.octavio/review.config.json`
3. `defaultProfile` from `.octavio/review.config.json`
4. `prompts/code-review.md`

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
      "instructionsPath": "prompts/code-review.md",
      "policy": {
        "failOn": ["new:high", "new:critical"]
      }
    },
    "security": {
      "instructionsPath": "prompts/security-review.md",
      "policy": {
        "failOn": ["new:medium", "new:high", "new:critical"]
      }
    }
  }
}
```

## Policy Configuration

Policy can be set either in profile config (`policy.failOn`) or in YAML frontmatter in instructions (`policy.fail_on`).

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

## GitHub Action

Workflow file: `.github/workflows/review-check.yml`

- Posts a concise summary in the job summary panel.
- Uploads `report.md`, `findings.json`, and `result.json` as artifacts.
- Reuses previous findings artifact by PR number for comparison.
- Supports profile selection via repo variable `OCTAVIO_INSTRUCTIONS_PROFILE`.

## Layout

- `apps/review-bot-cli` CLI entrypoint.
- `packages/config` env/config parsing.
- `packages/opencode-runner` OpenCode report generation with locked permissions.
- `packages/github-review` GitHub REST helpers for PR metadata and file diffs.
- `packages/agent-code-review` report parsing, previous-run comparison, and policy evaluation.
