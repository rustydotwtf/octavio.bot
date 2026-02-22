# Assistant API Agent Notes

Scope: applies to files under `apps/assistant-api`.

## Package Intent

- This app is a local-first assistant API service.
- Keep it slim and practical.
- Prefer pushing reusable behavior down into `packages/assistant-core`.

## Commands

Run from repository root:

- `bun run assistant:dev`
- `bun run --cwd apps/assistant-api dev`

## Runtime

- Uses Elysia for HTTP routing.
- Uses Vercel AI SDK through `@octavio.bot/assistant-core`.
- Persists chat history, tool calls, and the active conversation pointer in SQLite.
- Shares one active conversation with other interfaces (for example Telegram) when
  they use the same `ASSISTANT_DB_PATH`.
- `POST /chat` with `"/new"` rotates the shared active conversation.

## Documentation Sync

- If app behavior, commands, or runtime settings change, update both:
  - `apps/assistant-api/README.md`
  - root `README.md`
