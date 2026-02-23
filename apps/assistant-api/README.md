# assistant-api

Local Elysia chat assistant API that uses Vercel AI SDK with SQLite persistence.
The server keeps exactly one active conversation at a time, and the active
conversation pointer is stored in SQLite for durability across restarts.
When another interface (for example Telegram) uses the same SQLite file, both
interfaces share the same active conversation.

## Run

From repository root:

```bash
bun run assistant:api:dev
```

Run API + Telegram together:

```bash
bun run assistant:dev
```

Default server URL: `http://127.0.0.1:4100`

## Endpoints

- `GET /health`
- `POST /chat`
- `GET /conversations/:id/messages`

`POST /chat` body:

```json
{
  "conversationId": "optional-existing-id",
  "channel": "optional-source-channel",
  "channelMetadata": { "optional": "metadata" },
  "message": "read README.md",
  "messageMetadata": { "optional": "metadata" }
}
```

Behavior:

- Send `{"message":"/new"}` to start a new active conversation.
- `/new` returns plain text: `Started a new conversation.`
- `/new` includes the new conversation id in `x-conversation-id`.
- For normal messages, the server always uses the current active conversation.
- `conversationId` is accepted for compatibility but ignored in this mode.
- `channel` defaults to `api`.
- `channelMetadata` and `messageMetadata` are stored for interface-specific
  rendering/debugging and do not change LLM context formatting.

Responses include `x-conversation-id`.

## Environment

- `AI_GATEWAY_API_KEY` (required)
- `BRAVE_SEARCH_API_KEY` (required for `web_search` tool calls)

The `dev` script loads env from the repository root `.env` (`../../.env`).

All assistant non-secret runtime defaults now come from root `settings.ts`.

- `assistant.model` is fixed to `zai/glm-5`
- `assistant.databasePath` defaults to `~/.octavio/assistant.sqlite`
- `assistant.debugLogMb` defaults to `64` (`0` disables debug-event writes)
- `assistantApi.host` defaults to `127.0.0.1`
- `assistantApi.port` defaults to `4100`

Security posture:

- This API is intentionally local-first and does not include built-in request auth.
- Keep it bound to loopback (`127.0.0.1`) unless you add your own network/auth controls.

## Built-in tools

- `read_file`
- `patch_file`
- `web_search`

## Troubleshooting Debug Logs

When model/tool behavior looks wrong, inspect `debug_events` in the shared SQLite DB.
If you changed `settings.assistant.databasePath`, use that path instead.

```bash
sqlite3 "$HOME/.octavio/assistant.sqlite" "SELECT created_at, source, event_type, request_id, step_id FROM debug_events ORDER BY created_at DESC LIMIT 50;"
```

Check current debug log size:

```bash
sqlite3 "$HOME/.octavio/assistant.sqlite" "SELECT ROUND(COALESCE(SUM(payload_bytes),0) / 1024.0 / 1024.0, 2) AS mb FROM debug_events;"
```
