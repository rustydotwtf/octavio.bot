# assistant-api

Local Elysia chat assistant API that uses Vercel AI SDK with SQLite persistence.
The server keeps exactly one active conversation at a time, and the active
conversation pointer is stored in SQLite for durability across restarts.

## Run

From repository root:

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
  "message": "read README.md",
  "model": "optional-model-name"
}
```

Behavior:

- Send `{"message":"/new"}` to start a new active conversation.
- `/new` returns plain text: `Started a new conversation.`
- `/new` includes the new conversation id in `x-conversation-id`.
- For normal messages, the server always uses the current active conversation.
- `conversationId` is accepted for compatibility but ignored in this mode.

Responses include `x-conversation-id`.

## Environment

- `OPENAI_API_KEY` (required)
- `ASSISTANT_MODEL` (optional, default `gpt-4o-mini`)
- `ASSISTANT_DB_PATH` (optional, default `.octavio/assistant.sqlite`)
- `PORT` (optional, default `4100`)

## Built-in tools

- `read_file`
- `patch_file`
