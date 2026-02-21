# Golden Rule

AGENTS.md is a living guide for agents working in this repo. Edit it freely.

If you discover a mismatch between this file and the actual project (conventions, commands, structure, expectations), update AGENTS.md as part of your change.

Do not only append. Prune outdated guidance aggressively so this file stays representative of the current repository, not historical decisions.

When AGENTS.md and README overlap, keep both in sync in the same change. Remove or rewrite stale sections rather than preserving contradictory text.

Treat AGENTS.md as producer-focused guidance (for maintainers/agents) and README as consumer-focused guidance (for users of the CLI/packages). Update each document for its audience whenever behavior, package boundaries, commands, or outputs change.

As the project grows, add AGENTS.md files to folders that need extra context. These files are auto-loaded when that folder is explored.

---

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Product Posture

- Treat this repository as a development playground for building reusable agent/tooling packages, not a legacy compatibility surface.
- Optimize for clean package boundaries, code reuse, and separation of concerns across workspace packages.
- Do not keep speculative extension points "just in case". Add abstractions only when there are at least two real call sites or an active near-term need.
- Prefer simple, composable APIs that are easy to rename/refactor over wide, compatibility-heavy surfaces.

### Package Boundary & Publishing Posture

- Be explicit about package intent: either publishable library package or internal workspace implementation detail.
- Default to internal (`private: true`) unless there is a concrete plan to publish and support external consumers.
- Promote to publishable only when the API is intentionally designed, documented, and versioned.
- Keep apps as orchestration entrypoints and packages as reusable units; do not split into a package if there is only one call site and no near-term reuse.
- When introducing a new package, define ownership expectations in its README/AGENTS context (what is stable API vs refactor-friendly internals).

### Compatibility Posture

- Do not add backward-compatibility paths, shims, aliases, dual-read logic, or legacy imports unless explicitly requested for a specific migration.
- Prefer replacing old behavior outright instead of preserving multiple historical formats.
- If an old path still exists, remove it and update callers/tests/docs in the same change.
- Reusability is encouraged, but compatibility layers are not: share code through small focused modules, not through fallbacks.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

## Documentation Ownership

- Update `README.md` when changes affect how consumers install, configure, run, or integrate the tooling.
- Update `AGENTS.md` when changes affect engineering conventions, architecture posture, package boundaries, or agent workflow expectations.
- If a change affects both audiences, update both files in the same PR.
- Prefer deleting stale documentation over keeping historical notes that no longer match current behavior.

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.

---

## Project Layout (Monorepo)

This repository now uses a Bun workspace monorepo:

- `apps/review-bot-cli` - publishable CLI package (`@octavio.bot/review`, binary `octavio-review`)
- `packages/config` - runtime env and CLI config parsing
- `packages/opencode-runner` - OpenCode SDK wrapper for artifact-schema generation and validation retries
- `packages/github-review` - GitHub REST helpers for PR metadata and changed files
- `packages/agent-code-review` - report parsing and instruction-driven policy evaluation
- `packages/prompts` - publishable prompt package (`@octavio.bot/prompts`) and helper utilities

Notes:

- `packages/*` is the canonical workspace package boundary. Do not keep placeholder package directories.
- Every package directory must contain a tracked `package.json` and source files. If a package is empty or unused, delete the directory.
- App-specific contributor guidance should live in per-app `AGENTS.md` files (for example `apps/review-bot-cli/AGENTS.md`).

### Common Commands

- Run local source bot: `bun run review-bot --owner <owner> --repo <repo> --pr <number> [--instructions /absolute/or/workspace/path.md] [--instructions-profile <name>] [--artifact-execution agent|host] [--install-opencode] --workdir .`
- Run published CLI: `bunx --bun @octavio.bot/review@latest review --owner <owner> --repo <repo> --pr <number> --workdir .`
- Doctor command: `bunx --bun @octavio.bot/review@latest doctor`
- Build publishable CLI dist: `bun run review-cli:build`
- Run GitHub review workflow: `.github/workflows/review-check.yml` on pull requests
- Run manual npm publish workflow: `.github/workflows/publish-review.yml` (`workflow_dispatch`, publishes from `apps/review-bot-cli`)
- Lint and format check: `bun x ultracite check`
- Auto-fix style/lint: `bun x ultracite fix`

### Runtime Expectations

- `.env` should include `GITHUB_TOKEN`, OpenCode connection settings (`OPENCODE_HOSTNAME`, `OPENCODE_PORT`), and `OPENCODE_API_KEY` for OpenCode Zen; `OPENCODE_MODEL` is optional
- CLI requires `opencode` binary: local mode is detect-only; CI mode auto-installs when missing; `--install-opencode` forces local auto-install
- Default artifact execution is `agent` (OpenCode can write artifacts in-workspace); `external_directory` remains denied
- Keep OpenCode prompts constrained to the provided workspace directory
- Fail policy can come from profile config (`policy.failOn`) or instruction frontmatter (`policy.fail_on`)

### Instruction Profiles

- Repo config file: `.octavio/review.config.json` (committed in this repository)
- CLI supports `--instructions-profile <name>` to select a profile
- Security prompt profile (`security`) also treats PR title/description vs code mismatches as security-relevant deception signals
- Profiles can define `artifactExecution` and `artifactSchema` (`artifactDir`, `reviewFile`, `confidenceFile`, `maxAttempts`)
- Profile prompt selection uses `instructionsPrompt` (`balanced|styling|security`)
- Instruction resolution order: explicit `--instructions`, then profile prompt, then `defaultProfile`, then package default prompt (`balanced`)
- Policy resolution order: profile `policy.failOn`, then instructions frontmatter `policy.fail_on`
- Policy mode is fail-closed: missing/empty/invalid policy configuration is an error
- GitHub review workflow runs a profile matrix (`balanced`, `styling`, `security`) with `max-parallel: 1`; each matrix job sets `OCTAVIO_INSTRUCTIONS_PROFILE` to the active profile and executes `bunx --bun @octavio.bot/review@latest`

## Linked Context

- @README.md
- @apps/review-bot-cli/README.md
