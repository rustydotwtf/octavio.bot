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

- `polling` - long polling with `getUpdates` (default when no webhook URL)
- `webhook` - Elysia endpoint for Telegram webhooks
- `auto` - selects `webhook` when `TELEGRAM_WEBHOOK_URL` is set, otherwise `polling`

## Environment

- `TELEGRAM_BOT_TOKEN` (required)
- `AI_GATEWAY_API_KEY` (required)
- `TELEGRAM_MODE` (`auto|polling|webhook`, default `auto`)
- `TELEGRAM_ALLOWED_CHAT_IDS` (optional comma-separated allowlist)
- `TELEGRAM_WEBHOOK_URL` (optional, used for `auto` and `setWebhook`)
- `TELEGRAM_WEBHOOK_SECRET` (required in webhook mode)
- `TELEGRAM_SET_WEBHOOK` (optional `true|false`, default `false`)
- `TELEGRAM_POLL_TIMEOUT_SECONDS` (optional, default `30`)
- `TELEGRAM_POLL_IDLE_DELAY_MS` (optional, default `300`)
- `ASSISTANT_MODEL` (optional, default `openai/gpt-5-mini`)
- `ASSISTANT_DB_PATH` (optional, default `~/.octavio/assistant.sqlite`)
- `ASSISTANT_DEBUG_LOG_MB` (optional, default `64`, set `0` to disable debug events)
- `PORT` (optional, webhook mode only, default `4200`)

## Behavior

- `/new` rotates the single shared active conversation for all interfaces.
- Non-text Telegram updates are ignored.
- Telegram replies are compact and omit tool-call traces.

## Troubleshooting Debug Logs

This adapter writes detailed model/runtime telemetry to `debug_events` in the shared DB.

```bash
sqlite3 "$ASSISTANT_DB_PATH" "SELECT created_at, channel, source, event_type, request_id FROM debug_events WHERE channel = 'telegram' ORDER BY created_at DESC LIMIT 50;"
```

Current debug log size (MB):

```bash
sqlite3 "$ASSISTANT_DB_PATH" "SELECT ROUND(COALESCE(SUM(payload_bytes),0) / 1024.0 / 1024.0, 2) AS mb FROM debug_events;"
```
