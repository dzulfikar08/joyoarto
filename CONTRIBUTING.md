# Contributing

Thanks for helping. JoyoArto is AGPL-3.0-or-later; by sending a contribution you agree that it is licensed under the
same terms.

1. Read [README.md](README.md) (layout, money and date conventions) and [AGENTS.md](AGENTS.md) (house rules: every
   finance query is scoped by `householdId`, D1's 100-parameter limit, `@baroka/ui` components and tokens).
2. Open an issue first for anything bigger than a small fix, so we can agree on the shape.
3. Keep changes focused. Add or update tests next to the code (`bun test src` in `packages/api`, `bun test ./src/` in
   `apps/mobile`) and run `bunx tsc --noEmit` in the packages you touched.
4. **Never commit real financial data.** Statement samples, notification texts and fixtures must be made up or fully
   anonymised: fake names, account and pocket numbers, transaction ids and amounts. No real bank statements, screenshots
   of a real ledger, `.dev.vars`, tokens or API keys.
5. Security issues go by email, not issues: see [SECURITY.md](SECURITY.md).

The names JoyoArto and Joyo AI and the logo are trademarks (see [NOTICE](NOTICE)); forks need their own name.
