# Assistant Core Agent Notes

Scope: applies to files under `packages/assistant-core`.

## Package Intent

- Shared local assistant runtime.
- Keep APIs small and easy to evolve.
- Add abstractions only when there are at least two real call sites.

## Runtime Design

- `ChatStore` owns SQLite persistence.
- `ChatStore` persists the active conversation pointer in SQLite (`app_state`).
- `ChatStore` also stores channel/message metadata so interfaces can render the
  same conversation differently without changing LLM context shape.
- `AssistantRunner` owns model execution and streaming behavior.
- tools should be pure helpers when possible, with thin wrappers for call logging.

## Testing

- Prefer focused unit tests for file tools and persistence helpers.
