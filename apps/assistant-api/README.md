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

Default server URL: `http://localhost:4100`

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
  "messageMetadata": { "optional": "metadata" },
  "model": "optional-model-name"
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
- `AI_GATEWAY_BASE_URL` (optional, default `https://ai-gateway.vercel.sh/v1`)
- `ASSISTANT_MODEL` (optional, default `anthropic/claude-haiku-4.5`)
- `ASSISTANT_DB_PATH` (optional, default `~/.octavio/assistant.sqlite`)
- `PORT` (optional, default `4100`)

## Built-in tools

- `read_file`
- `patch_file`
