# @octavio.bot/assistant-core

Reusable assistant runtime for local tools and chat persistence.

Includes:

- chat runner built on Vercel AI SDK
- SQLite persistence with Bun SQLite
- built-in tools (`read_file`, `patch_file`, `web_search`)
- `read_file` and `patch_file` stay constrained to the configured workspace directory
- bounded debug event log (`debug_events`) for LLM/runtime troubleshooting

## Tool Environment

- `web_search` uses Brave Search and requires `BRAVE_SEARCH_API_KEY`.

## Debug Logging

- Detailed events are stored in the shared SQLite `debug_events` table.
- The table is a rolling buffer capped by `ChatStore` `debugLogMb` (default `64`).
- Set `debugLogMb` to `0` to disable debug event persistence.
- Events include model middleware telemetry (`llm.*`) and runtime lifecycle events (`assistant.*`).
