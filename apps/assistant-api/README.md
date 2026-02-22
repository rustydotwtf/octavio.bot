# assistant-api

Local Elysia chat assistant API that uses Vercel AI SDK with SQLite persistence.

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

Response streams assistant text and includes `x-conversation-id` header.

## Environment

- `OPENAI_API_KEY` (required)
- `ASSISTANT_MODEL` (optional, default `gpt-4o-mini`)
- `ASSISTANT_DB_PATH` (optional, default `.octavio/assistant.sqlite`)
- `PORT` (optional, default `4100`)

## Built-in tools

- `read_file`
- `patch_file`
