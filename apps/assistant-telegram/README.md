# assistant-telegram

Telegram adapter for the local assistant runtime. It shares the same SQLite
store and active conversation pointer as `apps/assistant-api`, so all messages
from API and Telegram flow through one continuous conversation.

## Run

From repository root:

```bash
bun run assistant:telegram:dev
```

Run both API + Telegram locally:

```bash
bun run assistant:dev
```

## Modes

- `polling` - long polling with `getUpdates` (default)
- `webhook` - Elysia endpoint for Telegram webhooks

## Environment

- `TELEGRAM_BOT_TOKEN` (required)
- `AI_GATEWAY_API_KEY` (required)
- `BRAVE_SEARCH_API_KEY` (required for `web_search` tool calls)
- `TELEGRAM_WEBHOOK_SECRET` (required in webhook mode)

The `dev` script loads env from the repository root `.env` (`../../.env`).

All assistant non-secret runtime defaults now come from root `settings.ts`.

- `assistant.model` is fixed to `zai/glm-5`
- `assistant.databasePath` defaults to `~/.octavio/assistant.sqlite`
- `assistant.debugLogMb` defaults to `64` (`0` disables debug-event writes)
- `assistantTelegram.mode` defaults to `polling`
- `assistantTelegram.allowedChatIds` defaults to allow all chats
- `assistantTelegram.pollTimeoutSeconds` defaults to `30`
- `assistantTelegram.pollIdleDelayMs` defaults to `300`
- `assistantTelegram.port` defaults to `4200` (webhook mode)
- `assistantTelegram.webhookUrl` defaults to `undefined`
- `assistantTelegram.setWebhookOnStartup` defaults to `false`

## Behavior

- `/new` rotates the single shared active conversation for all interfaces.
- Non-text Telegram updates are ignored.
- Telegram replies are compact and omit tool-call traces.
- Empty assistant output no longer falls back to "Done.".

## Troubleshooting Debug Logs

This adapter writes detailed model/runtime telemetry to `debug_events` in the shared DB.
If you changed `settings.assistant.databasePath`, use that path instead.

```bash
sqlite3 "$HOME/.octavio/assistant.sqlite" "SELECT created_at, channel, source, event_type, request_id FROM debug_events WHERE channel = 'telegram' ORDER BY created_at DESC LIMIT 50;"
```

Current debug log size (MB):

```bash
sqlite3 "$HOME/.octavio/assistant.sqlite" "SELECT ROUND(COALESCE(SUM(payload_bytes),0) / 1024.0 / 1024.0, 2) AS mb FROM debug_events;"
```
