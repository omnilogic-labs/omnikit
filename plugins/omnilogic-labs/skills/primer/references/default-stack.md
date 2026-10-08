# Default stack and architecture

This is the opinionated default the skill proposes when the user has no stated
preference. It is a starting point, not a mandate. It is kept in its own file on
purpose so it can be overridden wholesale (see "Overriding" below) without
touching the rest of the skill.

When you write the primer's "Hard constraints" section, draw from whichever
stack applies (user-defined first, then this default), and **re-verify every
version in Phase 2 via context7**. Never copy a version number out of this file;
the numbers here go stale. This file fixes the _choices_, not the _versions_.

## Resolution order

1. **The user stated a stack** (in the conversation or interview). Use it.
2. **A user stack profile exists** at `~/.claude/primer/stack.md`. Use it as the
   default proposal and tell the user you are using their profile.
3. **Neither.** Use the default below, and present it as a proposal the user can
   override.

Always surface the chosen stack as a Judgment Call in the primer so the user can
correct it before decomposition.

## The default (web product)

For a typical web product the default is a TypeScript full-stack app:

- **Language:** TypeScript, strict mode. No plain JavaScript for app code.
- **Framework:** Next.js, App Router. Server Components by default; Client
  Components only where interactivity requires them.
- **Styling:** Tailwind (v4, CSS-first config). No competing CSS-in-JS.
- **Components:** shadcn/ui via its CLI. Override the default shadcn look rather
  than shipping it raw.
- **Data layer:** Drizzle ORM. SQLite (better-sqlite3) for local-first or small
  apps; Postgres for anything that needs concurrency or hosted scale.
- **Auth:** Auth.js (NextAuth) for OAuth, or magic-link where that fits better.
- **LLM access (if the product uses models):** the Vercel AI SDK (`ai` plus the
  relevant `@ai-sdk/*` provider). Default to the latest Claude models.
- **Background work:** a queue (BullMQ + Redis) only when the product genuinely
  needs async jobs; do not add it speculatively.
- **Deploy target:** Render.com (the user's default host; the `render` skill
  covers blueprints and SSH).
- **Package manager:** bun where the project allows it, otherwise pnpm. Match the
  target repo's existing lockfile if one is present.
- **Tests:** Vitest.

## Non-web defaults

- **CLI tool:** TypeScript, run via tsx or bun, distributed as a single file or a
  small bin. Vitest for tests. Avoid a heavy framework for a small CLI.
- **Service / API with no UI:** TypeScript, a thin HTTP layer (Hono or the
  platform's native handler), Drizzle for data, deployed to Render.
- **Desktop:** Electron with Electron Forge + Vite, TypeScript throughout, only
  when a true desktop app is required.

## Cross-cutting conventions (apply regardless of stack)

- No em dashes or en dashes anywhere.
- Verify the latest version of every dependency before adding it; never pin from
  memory. Use context7 for current docs.
- Secrets live in environment variables, never committed. `.env.local` is
  gitignored.
- The first task creates `CLAUDE.md`; later tasks append established patterns to
  it so context flows between isolated task invocations.

## Overriding

To replace this default with your own house stack, create
`~/.claude/primer/stack.md` with the same shape (the choices, not the versions).
The skill reads it in Phase 2 and proposes it instead of this file. You can keep
several profiles (for example `stack-web.md`, `stack-cli.md`) and tell the skill
which to use during the interview. Project-specific constraints stated in the
conversation always win over any profile.
