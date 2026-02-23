# @octavio.bot/assistant-core

Reusable assistant runtime for local tools and chat persistence.

Includes:

- chat runner built on Vercel AI SDK
- SQLite persistence with Bun SQLite
- built-in tools (`read_file`, `patch_file`, `web_search`, `save_memory`, `get_memory`, `search_memory`, `list_memories`)
- `read_file` and `patch_file` stay constrained to the configured workspace directory
- separate memory SQLite store for append-only title/body memory entries
- bounded debug event log (`debug_events`) for LLM/runtime troubleshooting

## Memory Store

- Memory entries are stored in a dedicated SQLite database (`MemoryStore`).
- Each memory row includes:
  - internal `id` (UUID)
  - public `joyful_id` (human-friendly unique identifier)
  - `title` (duplicates are allowed)
  - `body_markdown`
  - `created_at`
- `save_memory` always inserts a new row, even when the same title already exists.
- `get_memory` returns exact-title matches ordered newest-first.
- `search_memory` does case-insensitive substring search over titles and bodies and returns concise snippets plus markdown guidance to fetch full details with `get_memory`.
- `list_memories` returns paginated memory listings (`page`/`limit`) with concise markdown snippets and next-page guidance.

## Tool Environment

- `web_search` uses Brave Search and requires `BRAVE_SEARCH_API_KEY`.

## Debug Logging

- Detailed events are stored in the shared SQLite `debug_events` table.
- The table is a rolling buffer capped by `ChatStore` `debugLogMb` (default `64`).
- Set `debugLogMb` to `0` to disable debug event persistence.
- Events include model middleware telemetry (`llm.*`) and runtime lifecycle events (`assistant.*`).
