# octavio-review

CI-first PR review gate that returns a GitHub check result (pass/fail) and uploads a report artifact.

## What It Does

1. Builds PR context from changed files.
2. Generates a markdown review report with OpenCode.
3. Extracts structured findings from the report JSON block.
4. Compares current findings to the previous run artifact (`new`, `persisting`, `resolved`).
5. Applies fail policy from instruction frontmatter.

No GitHub review comments are created or updated.

## Install

```bash
bun install
```

## Environment

Create `.env` with:

```bash
GITHUB_TOKEN=...
OPENCODE_MODEL=openai/gpt-5
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096
```

## Local Run

```bash
bun run review-bot --owner acme --repo web --pr 123 --instructions prompts/code-review.md --workdir .
```

Optional flags:

- `--report-output path/to/report.md`
- `--findings-output path/to/findings.json`
- `--result-output path/to/result.json`
- `--previous-findings path/to/previous-findings.json`

## Policy Configuration

Policy is read from YAML frontmatter in the instructions markdown:

```yaml
---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
---
```

Supported scope: `any`, `new`, `persisting`, `resolved`.

If policy is missing or invalid, the runner uses fail-open fallback and reports warnings in `result.json`.

## GitHub Action

Workflow file: `.github/workflows/review-check.yml`

- Posts a concise summary in the job summary panel.
- Uploads `report.md`, `findings.json`, and `result.json` as artifacts.
- Reuses previous findings artifact by PR number for comparison.

## Layout

- `apps/review-bot-cli` CLI entrypoint.
- `packages/config` env/config parsing.
- `packages/opencode-runner` OpenCode report generation with locked permissions.
- `packages/github-review` GitHub REST helpers for PR metadata and file diffs.
- `packages/agent-code-review` report parsing, previous-run comparison, and policy evaluation.
