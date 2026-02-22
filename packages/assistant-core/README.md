# @octavio.bot/assistant-core

Reusable assistant runtime for local tools and chat persistence.

Includes:

- chat runner built on Vercel AI SDK
- SQLite persistence with Bun SQLite
- built-in tools (`read_file`, `patch_file`)
- bounded debug event log (`debug_events`) for LLM/runtime troubleshooting

## Debug Logging

- Detailed events are stored in the shared SQLite `debug_events` table.
- The table is a rolling buffer capped by `ASSISTANT_DEBUG_LOG_MB` (default `64`).
- Set `ASSISTANT_DEBUG_LOG_MB=0` to disable debug event persistence.
- Events include model middleware telemetry (`llm.*`) and runtime lifecycle events (`assistant.*`).
