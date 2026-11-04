# JoyoArto (codebase: baroka): notes for agents

- Read README.md first (layout, money/date conventions).
- Typecheck: `bunx tsc --noEmit` in each package/app (web: run `bunx vite build` first to generate `routeTree.gen.ts`). Tests: `bun test src` in packages/api.
- Every finance query filters by `householdId` from the principal; never by user id alone. Membership lives in `household_member`.
- New API features: add a service in packages/api/src/services, a procedure with `.route()` in routers/index.ts, and, if Claude should use it, an entry in TOOLS in packages/api/src/tools.ts (the tool calls the same procedure; the MCP server registers every entry, Joyo AI the ones marked `chat`: "read" runs, "propose" only suggests a write the member confirms).
- D1: max 100 bound parameters per statement. Chunk anything caller-sized (`lib/d1.ts`).
- Schema change: edit packages/db/src/schema, `bun run db:generate`, `bun run db:migrate:local`.
- UI: use `@baroka/ui` components and tokens (bg-card, text-muted-foreground, primary/positive/warning/destructive); no raw stone/emerald colours. Dark mode is the `.dark` class.
- Dropdowns: `Select` (short lists) or `Combobox` (searchable; categories, accounts, anything over ~10 options; `lazy` in table rows) from `@baroka/ui`. No native `<select>`. Category/account items come from `apps/web/src/lib/options.ts`.
