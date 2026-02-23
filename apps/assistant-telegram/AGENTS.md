# Assistant Telegram Agent Notes

Scope: applies to files under `apps/assistant-telegram`.

## Package Intent

- This app is a Telegram transport adapter for the shared assistant runtime.
- Keep transport-specific logic here; keep reusable chat/runtime behavior in
  `packages/assistant-core`.
- Preserve one shared active conversation across interfaces unless explicitly
  changed by product direction.

## Commands

Run from repository root:

- `bun run assistant:telegram:dev`
- `bun run assistant:dev`

## Runtime

- Supports `polling` and `webhook` modes.
- Polling should be conservative (long-poll timeout + bounded retry backoff).
- Webhook endpoint must require `TELEGRAM_WEBHOOK_SECRET`.
- Use `settings.assistantTelegram.allowedChatIds` when restricting access.
- Shares both chat history and memory tools through `@octavio.bot/assistant-core`
  using the configured assistant SQLite paths.

## Documentation Sync

- If Telegram behavior, commands, or environment variables change, update both:
  - `apps/assistant-telegram/README.md`
  - root `README.md`
