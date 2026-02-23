# Assistant API Agent Notes

Scope: applies to files under `apps/assistant-api`.

## Package Intent

- This app is a local-first assistant API service.
- Keep it slim and practical.
- Prefer pushing reusable behavior down into `packages/assistant-core`.

## Commands

Run from repository root:

- `bun run assistant:dev`
- `bun run assistant:api:dev`
- `bun run --cwd apps/assistant-api dev`

## Runtime

- Uses Elysia for HTTP routing.
- Uses Vercel AI SDK through `@octavio.bot/assistant-core`.
- Persists chat history, tool calls, and the active conversation pointer in SQLite.
- Persists memory entries in a separate SQLite database through `MemoryStore`.
- Shares one active conversation with other interfaces (for example Telegram) when
  they use the same `settings.assistant.databasePath` value.
- Shares memory history with other interfaces when they use the same
  `settings.assistant.memoryDatabasePath` value.
- `POST /chat` with `"/new"` rotates the shared active conversation.
- Default bind is `settings.assistantApi.host = 127.0.0.1`.
- This service is intentionally local-first and currently has no built-in API auth.

## Documentation Sync

- If app behavior, commands, or runtime settings change, update both:
  - `apps/assistant-api/README.md`
  - root `README.md`
