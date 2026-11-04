# Handoff (4 Nov 2026): Mac → Linux

Work on JoyoArto moved from the Mac (T3 Code) to the Linux box (`linuxbox`, claude-hub).
Start a session in `~/Documents/JoyoDigitama/joyoarto` with `claude-hub`, then read this file, README.md, AGENTS.md and
the Atur project **BRK** (workspace `joyodigitama`).

## Where things are

| What | Where |
| --- | --- |
| Code | github.com/dzulfikar08/joyoarto (renamed from `baroka`; packages and the Worker are still named `baroka`) |
| Production | app: https://app.arto.joyorogo.com · landing: https://arto.joyorogo.com · old https://baroka.by.dzulfikar.com redirects |
| Deploys | GitHub Actions: `ci.yml` → `deploy.yml` (D1 migrations + `wrangler deploy` + smoke test). Secret `CLOUDFLARE_API_TOKEN` in environment `production`. Don't deploy from a laptop. |
| Android | `android.yml` builds the APK artifact `joyoarto-android-apk` (`gh run download <id> -n joyoarto-android-apk`). Release signing secrets (`ANDROID_KEYSTORE_*`) not set yet: debug-signed. |
| MCP | claude-hub has `joyoarto` (https://app.arto.joyorogo.com/mcp, its own `brk_` token) and `atur`. |
| Task tracking | Atur project BRK (Backlog/Todo/In Progress/Done/Cancelled). |

## Working rules (from the owner)

- Never build or deploy on the laptops; push to main and let Actions do it.
- Keep work moving: put multi-step builds on background agents (one schema-migration owner at a time), merge, push, and file everything in Atur BRK.
- Every finance query is scoped by `householdId` (see CLAUDE.md).

## Open items

1. **Email-in routing:** Cloudflare Email Routing is enabled for `arto.joyorogo.com` and subaddressing is on for joyorogo.com. **Missing:** a routing rule `import@arto.joyorogo.com` → *Send to a Worker* → `baroka` (dash → joyorogo.com → Email Routing → Routing rules). Then turn the address on in Settings → Import by email and forward a PDF to test it.
2. **Android app v1:** the first CI build is running or done. Install it on a real phone and check:
   - notification capture with real Jago/GoPay notifications (add the real texts to `apps/mobile/src/capture/parsers/samples.ts`);
   - "Allow restricted settings" on Android 13+;
   - share PDF → `/api/imports/statement-file`.
   - Later: release keystore secrets; OAuth sign-in (needs a `joyoarto://` redirect, and REST must accept OAuth access tokens).
3. **README rewrite with screenshots:** take them from production using a demo household (never the owner's real data). Cover the phone and desktop dashboard, transactions, import, plan, Joyo AI and the Claude connector.
4. **Uncategorized transactions (about 29):** ask the owner about the remaining merchants and personal transfers (see `search_transactions uncategorized=true` in the live ledger; never list counterparties in the repo).
5. **Backlog in Atur:** BCA PDF parser (waiting on a sample), Plan upgrade-path UX, shorter share links, BCA CSV check against a real export, Cloudflare WAF skip for /api and /mcp, audit pruning cron, own Google OAuth brand.
6. **Pro billing (built, not live):** README "JoyoArto Pro". Before launch: confirm prices, founder offer, grandfather date
   and refund policy (wrangler vars, `/syarat`); set the DOKU (sandbox first) and Polar secrets and webhook URLs; switch
   `DOKU_ENV`/`POLAR_SERVER` to `production`. Limits stay off until a gateway's secrets exist.
