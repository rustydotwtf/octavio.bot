# Site Agent Notes

Scope: applies to files under `apps/site`.

## Package Intent

- This app is the static `octavio.bot` site.
- Keep it focused on shipped products and product docs entry points.
- Do not add speculative pages for unshipped products.

## Source of Truth

- Page content lives in `content/*.md`.
- Prompt source markdown lives in `../../packages/prompts/prompts/*.md`; `content/prompts-*.md` is generated via sync.
- Shared shell/layout behavior lives in `src/ui/` and `styles/tailwind.css`.
- Site-level config lives in `site.jsonc`.

## Commands

Run from repository root:

- `bun run site:dev`
- `bun run site:sync:watch`
- `bun run --cwd apps/site watch:prompts`
- `bun run --cwd apps/site dev`
- `bun run --cwd apps/site build`
- `bun run --cwd apps/site preview`
- `bun run --cwd apps/site check`
- `bun run --cwd apps/site sync`

## Deployment

- Primary deployment target is Vercel.
- Use `bun run --cwd apps/site deploy`.

## Documentation Sync

- If app behavior, structure, or commands change, update both:
  - `apps/site/README.md`
  - root `README.md` (workspace overview)
