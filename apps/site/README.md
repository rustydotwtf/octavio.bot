# octavio.bot site

Static marketing/docs site for shipped Octavio products. The first section covers the Review CLI.

## Local development

From repository root:

```bash
bun install
bun run --cwd apps/site dev
```

Useful app commands:

- `bun run --cwd apps/site build`
- `bun run --cwd apps/site preview`
- `bun run --cwd apps/site check`
- `bun run --cwd apps/site smoke`

## Content and structure

- `content/` markdown pages (`index.md` maps to `/`)
- `src/ui/` shell/layout components
- `styles/tailwind.css` site theme and typography
- `site.jsonc` navigation and site config
- `assets/` static icons/images

## Deploy

This app is initialized for Vercel:

```bash
bun run --cwd apps/site deploy
```

Use `bun run --cwd apps/site build` before deployment if you want to validate generated output locally.
