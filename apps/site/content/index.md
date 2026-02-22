---
title: octavio.bot
group: main
order: 1
icon: home
---

# Every Rusty Needs an Octavio They Can Trust

Introducing... octavio.bot

## Review CLI

`@octavio.bot/review` is a CI-first pull request review CLI that runs OpenCode with profile-driven policies and writes deterministic report artifacts.

- Returns pass or fail for each run
- Produces `review.md`, `confidence.json`, and `result.json`
- Supports `balanced`, `styling`, and `security` instruction profiles
- Designed for GitHub Actions and local validation

### Install

```bash
bunx --bun @octavio.bot/review@latest doctor
```

### Run against a pull request

```bash
bunx --bun @octavio.bot/review@latest review --owner acme --repo web --pr 123 --workdir .
```

### Initialize Octavio in a repository

```bash
bunx --bun @octavio.bot/review@latest init --workdir .
```

Read the full CLI docs in this monorepo at `apps/review-bot-cli/README.md`.

## Next products

New sections are added here only when they are shipped.
