# Listing JoyoArto in Claude's connectors directory (BRK-54)

Goal: Indonesians find JoyoArto under **Customize → Connectors → Browse** in Claude instead of pasting
`https://app.arto.joyorogo.com/mcp` as a custom connector. Anthropic's "Personal Finance in Claude" (launched
2026-11-05) is US-only via Plaid; Plaid has no Indonesian banks, so JoyoArto is the data source for Indonesia.

Requirements researched on 2026-11-06. Anthropic changes these pages; re-read the first three before submitting.

## Sources

| # | Page | URL |
| --- | --- | --- |
| S1 | Submit a connector to the directory | https://claude.com/docs/connectors/building/submission |
| S2 | Connector pre-submission checklist (review criteria) | https://claude.com/docs/connectors/building/review-criteria |
| S3 | Authentication for connectors | https://claude.com/docs/connectors/building/authentication |
| S4 | Anthropic Software Directory Policy | https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy |
| S5 | Anthropic Software Directory Terms | https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms |
| S6 | Publish to the directory (who can submit) | https://claude.com/docs/directory/publish |
| S7 | Manage your directory listing (editable fields, health metrics) | https://claude.com/docs/connectors/building/managing-your-listing |
| S8 | Add a connector that isn't in the directory (user-facing menus) | https://claude.com/docs/connectors/custom/add-unlisted |
| S9 | Supported countries and regions | https://www.anthropic.com/supported-countries |
| S10 | MCP authorization spec (2025-11-25) | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization |
| S11 | Anthropic egress IP addresses | https://platform.claude.com/docs/en/api/ip-addresses |

## Requirements checklist

✅ met · ⚠️ met with a caveat or needs the owner · ❌ not met

### Server and transport

| Requirement | Source | Status |
| --- | --- | --- |
| Remote server over HTTPS with a certificate from a recognised CA | S1, S4 | ✅ `https://app.arto.joyorogo.com/mcp` (Cloudflare) |
| Streamable HTTP transport (SSE tolerated) | S4 | ✅ `WebStandardStreamableHTTPServerTransport`, JSON responses, stateless |
| Server domain matches the service; first-party API (or legitimately proxied) | S2 | ✅ own API: every tool calls the same oRPC procedure as the REST API |
| Not a money-movement / crypto / AI-media connector | S2, S4 | ✅ reads and records a ledger; it cannot move money (no bank credentials at all) |
| Errors are actionable, not generic | S2, S4 | ✅ zod issues are returned per field; internal errors say "try again"; plan, scope and rate-limit refusals explain themselves |
| Responses reasonably sized, tokens used economically | S2, S4 | ✅ paginated search (`nextCursor`), summaries instead of dumps |
| No conversation data beyond the tool's need; no access to Claude memory/chat history/files | S2, S4 | ✅ the server only sees tool arguments. The audit log keeps tool name, arguments (≤500 chars, import rows summarised, `rawText` omitted), outcome and duration for 90 days |
| Must not steer Claude to other tools, override instructions, hide instructions or promote products | S2, S4 | ✅ descriptions describe behaviour. `MCP_INSTRUCTIONS` (server instructions) gives domain conventions and import steps only. The Free-plan refusal tells the user where Pro is; it only appears to Free households |
| Every tool returns success with valid parameters | S2 | ✅ every listed tool works for the connection: a Free household (or a read-only consent) is only offered the read tools, so no tool answers "needs Pro" |
| Reads and writes in separate tools; no catch-all request tool | S2 | ✅ 34 purpose-built tools |

### Tool annotations and names

| Requirement | Source | Status |
| --- | --- | --- |
| Every tool has a `title` | S1, S2, S4 | ✅ `title` on every `ToolDef` (`packages/api/src/tools.ts`), checked by `tools.test.ts` |
| `readOnlyHint: true` on read-only tools | S1, S2, S4 | ✅ every `finance:read` tool (test-enforced) |
| `destructiveHint: true` on tools that modify or delete data | S2, S4, MCP spec | ✅ since this branch. Destructive: `update_transaction`, `categorize`, `create_rule` (can rename merchants on past rows), `set_budget`, `save_scenario` (replaces by id or name), `delete_scenario`, `mark_reimbursable`, `set_claim_status`, `undo_import`. Additive (`destructiveHint: false`): `add_transaction`, `quick_add`, `create_account`, `create_category`, `import_transactions`, `import_statement_text` (imports only add rows; a matching pending quick add is confirmed, keeping its category, merchant and note). Before this branch every write tool said `false` |
| `idempotentHint` | MCP spec (optional) | ✅ reads, plus writes that are safe to repeat (`add_transaction`, imports, `update_transaction`, `set_budget`, ...) |
| Tool names ≤ 64 characters | S2, S4 | ✅ longest is `list_reimburse_profiles` (23), test-enforced |
| Server name/title/version/website/icons | (portal shows serverInfo) | ✅ `SERVER_INFO` in `apps/server/src/mcp.ts`: `joyoarto` / JoyoArto / 1.0.0, `websiteUrl` https://arto.joyorogo.com/claude, icons 512 PNG + SVG |

### Authentication

| Requirement | Source | Status |
| --- | --- | --- |
| OAuth 2.0 for user-account services | S1, S3, S4 | ✅ better-auth OAuth 2.1 provider (`packages/auth`) |
| `401` with `WWW-Authenticate: Bearer resource_metadata=…` on unauthenticated calls | S3 | ✅ live: `resource_metadata="https://app.arto.joyorogo.com/.well-known/oauth-protected-resource/mcp", scope="finance:read finance:write"` |
| Protected resource metadata `resource` equals the URL users enter, path included | S3 | ✅ live: `"resource":"https://app.arto.joyorogo.com/mcp"` |
| `authorization_servers[0]` is the issuer; AS metadata at `/.well-known/` (RFC 8414 or OIDC) | S3 | ✅ issuer `https://app.arto.joyorogo.com/api/auth`; served at the origin root and under the issuer path |
| Client registration: DCR (`registration_endpoint`) or CIMD | S3 | ✅ DCR (`/api/auth/oauth2/register`, unauthenticated). CIMD is not advertised: optional, see Open issues |
| PKCE S256, advertised in `code_challenge_methods_supported` | S3, S10 | ✅ live |
| Redirect URI `https://claude.ai/api/mcp/auth_callback` accepted | S3 | ✅ no allowlist to update: with DCR Claude registers its own redirect URIs. Nothing restricts them by host |
| Claude Code loopback redirect on any port (`localhost` and `127.0.0.1`) | S3 | ✅ DCR registers loopback URIs as `native` clients (`nativeRegistration` hook); better-auth matches loopback ports per RFC 8252 |
| Consent screen shows the redirect host | S3, S10 | ✅ `/connect` shows "you will return to <host>" |
| Refresh tokens: `offline_access` advertised, rotation for public clients, `invalid_grant` on dead tokens | S3 | ✅ `offline_access` in `scopes_supported` and added to every authorize request; refresh tokens rotate (30 days) |
| Token endpoint accepts `application/x-www-form-urlencoded`; endpoints answer within 10 s (refresh 30 s) | S3 | ✅ better-auth defaults on Workers |
| Reachable from Anthropic's egress `160.79.104.0/21`; no WAF in the way | S3, S11 | ✅ no IP rules. Since this branch the per-IP DCR limiter skips that range (all claude.ai registrations come from it) |
| No redirects on `/mcp`, `/.well-known/*` or OAuth endpoints | (third-party checklists; S3 implies) | ✅ live probes answered 200/401 directly |

### Listing, documentation, privacy, support, review

| Requirement | Source | Status |
| --- | --- | --- |
| Public documentation: setup, usage, troubleshooting, **at least three example prompts** | S1, S2, S4 | ✅ https://arto.joyorogo.com/claude (Indonesian + English toggle; five example prompts). Live after this branch is deployed |
| Privacy policy URL that covers collection, use, storage, sharing, retention, contact | S1, S4 | ✅ https://arto.joyorogo.com/privasi already covers the connector: connected apps and the MCP log (§ data), consent as the basis for connecting AI, Anthropic receiving what a request needs "only if you connect it", MCP log 90 days, withdrawing consent, contact. No legal text was changed on this branch |
| Verified support contact and channel for product and security issues | S1, S4 | ✅ `support@joyorogo.com` (Cloudflare Email Routing to the owner); also on the connector guide |
| Icon | S1 | ✅ `apps/web/public/icon-512.png` (512×512 PNG), `apps/web/public/icon.svg` (vector). The portal doesn't publish a size; upload the 512 PNG |
| Test account: fully populated, with sample data | S1, S2, S4 | ✅ since this branch: the store reviewers' demo account can connect AI apps (it was refused before). See [Test & launch](#8-test--launch) |
| Tested every tool via MCP Inspector or as a custom connector | S1, S2 | ⚠️ owner confirms this in the portal; it needs a signed-in Claude account |
| Paid Claude plan (Pro, Max, Ultra, Team Owner, Enterprise Owner/Directory role) | S6 | ⚠️ owner |
| Region: Anthropic-supported countries | S4, S9 | ✅ Indonesia is supported (the list takes effect 2026-11-12) |
| Finance is a high-risk area under the Usage Policy: human-in-the-loop safeguards and consumer disclosure | S4 | ⚠️ see [Open issues](#open-issues). What exists: no money movement; writes need the user's approval in Claude and destructive ones are marked; plan results carry "not financial advice" and `MCP_INSTRUCTIONS` tells Claude never to present a verdict as certain or as advice |
| MCP App screenshots, allowed link URIs | S1 | n/a: no MCP App UI, no `ui/open-link` |

## Submission draft (portal fields, in portal order)

Portal: https://claude.ai/directory/manage → **Submit new** → **MCP connector** (S1).

### 1. Connection

- Server URL: `https://app.arto.joyorogo.com/mcp`
- How users connect: **Universal URL** (everyone uses the same URL).

### 2. Tools

Synced from the live server. All 34 tools should show a title and land in read (19) or write (15) without warnings,
once this branch is deployed. If the portal flags anything, fix it in `packages/api/src/tools.ts`.

### 3. Listing

| Field | Limit | Draft |
| --- | --- | --- |
| Server name | 100 | `JoyoArto` |
| One-liner | 200 | `Your Indonesian household's money in Claude: Bank Jago, GoPay and other bank statements, budgets and "can we afford it?" plans.` |
| Description | 2,000 | below |
| Categories | 1–5 | Finance (primary). Add Productivity if the portal offers it. Pick from the portal's list; these are guesses |
| Documentation URL | | `https://arto.joyorogo.com/claude` |
| Privacy policy URL | | `https://arto.joyorogo.com/privasi` |
| Support contact | | `support@joyorogo.com` |
| Icon | | `apps/web/public/icon-512.png` (512×512 PNG; JoyoArto "J" with the gold coin on arto blue `#3752ae`) |
| URL slug | permanent | `joyoarto` |

Description (EN, about 1,350 characters):

> JoyoArto is a household finance ledger for Indonesia. Bank accounts, credit cards and e-wallets live in one ledger
> that you and your partner share, and Claude can read it after you connect and approve it.
>
> JoyoArto reads Bank Jago monthly statements and GoPay e-statements itself and checks every running balance. Claude
> can import any other bank's statement (BCA, BRI, Mandiri, and more) from a PDF, screenshot or CSV you share in the
> chat, after a preview with a balance check. Amounts are in rupiah, dates in WIB.
>
> Ask in plain Indonesian or English:
> • "How much did we spend on food this month compared with last month?"
> • "Which budgets are over or nearly used up?"
> • "Can we afford a Rp 250 million car with 30% down over 4 years, with a baby on the way?"
> • "Just bought a 25k coffee with GoPay."
>
> Tools cover search, spending and cashflow summaries, budgets, categorisation rules, reimbursable work expenses, and
> an affordability planner: emergency fund, debt ratio and month-by-month balances from your own history. It computes;
> it is not financial advice.
>
> JoyoArto never asks for bank logins and cannot move money. You can grant read-only access. Tools that change or
> delete data are marked so Claude asks first, and you can disconnect at any time in JoyoArto or in Claude. Reading
> and asking is free; adding and changing data from Claude is part of Joyo Pro. JoyoArto is open source (AGPL).

### 4. Use cases

- Primary use cases: spending questions over Indonesian bank/e-wallet history; importing and categorising statements;
  budgets; affordability planning (car loan, baby, moving house); reimbursable expenses.
- What users need first: a JoyoArto account (free sign-up with Google or Apple at https://app.arto.joyorogo.com) and
  for writes, **Joyo Pro** (Free households get the read tools only). Statements
  imported, or imported through Claude.
- Reads or writes: **both** (the user can grant read-only at consent).

### 5. Company

- Company: JoyoDigitama (Dzulfikar Ats Tsauri, Indonesia)
- Website: https://arto.joyorogo.com
- Primary contact: support@joyorogo.com

### 6. Authentication

- Authentication requirement: **Always required**.
- Method: OAuth sign-in, client registered by Claude (**Dynamic Client Registration**). No Anthropic-held client needed.
- Scopes Claude will request (from the 401): `finance:read finance:write`, plus `offline_access`.

### 7. Data handling

- Underlying API: **our own** (first-party).
- Personal health data: **no**. Sponsored content: **no**.

### 8. Test & launch

Paste into the reviewer instructions, replacing `<REVIEW_DEMO_CODE>` with the code **only in the portal's credentials
field**. The code is the Worker secret `DEMO_LOGIN_CODE` (the same code Google Play and App Store reviewers get; see
docs/HANDOFF.md item 8 and docs/ios-release.md). Never commit it or put it in this file.

> JoyoArto uses Google or Apple sign-in, so reviewers use the demo account: a Joyo Pro household with about three months
> of made-up Indonesian transactions (Bank Jago pockets, a GoPay wallet, categorised spending, budgets, rules, pending
> quick adds and a saved plan scenario).
>
> 1. In Claude, add the connector (server URL https://app.arto.joyorogo.com/mcp) and click Connect.
> 2. On the JoyoArto page that opens, click **Sign in**. On the sign-in page, open **Demo account (reviewers)** at the
>    bottom (do not use Google), enter the demo code `<REVIEW_DEMO_CODE>` and click **Open the demo**.
> 3. You return to the consent page ("Claude wants to connect to JoyoArto"). Click **Allow**.
> 4. Try: "What did we spend most on last month?", "Which budgets are over?", "Can we afford a Rp 250 juta car with 30%
>    down over 48 months at 3.5% flat?", "Catat kopi 25rb pakai GoPay".
>
> Notes: the demo data resets every day at 03:00 WIB (and whenever someone opens the demo with the code), so writes do
> not persist. A demo connection lasts 7 days; after that, connect again with the code. The demo cannot invite people
> or import statements by email.

Then confirm in the portal that every tool was run (owner: run each through MCP Inspector or a custom connector first;
the demo account is fine for this).

### 9. Compliance

Seven acknowledgements (directory guidelines, first-party API, financial transactions, AI media generation, prompt
injection, conversation data collection, public documentation). All are true for JoyoArto as shipped on this branch.

## Open issues

Things this branch could not close, and why:

1. **Deploy first.** The portal syncs tools from the live server and reviewers read the live docs page. The new
   annotations, demo connections, the DCR limiter change and https://arto.joyorogo.com/claude only exist after this PR
   is merged and deployed.
2. **Read-only choice.** The docs page says the user can choose read-only access on the consent page. That ships with
   `feat/read-only-choice` (another branch). Merge it before submitting, or the docs overstate the consent page.
3. **Free plan:** resolved 2026-11-06. Free households get the read tools only (writes are Pro), so no tool answers with an error because of the plan.
4. **Finance as a high-risk use case (S4 → Usage Policy).** The policy asks high-risk software for human-in-the-loop
   measures and consumer disclosure. What is in place is listed in the checklist above. Whether JoyoArto, as a data
   source with a planner that computes rather than advises, needs more (for example a visible "not financial advice"
   line in every plan result, or a statement in the listing) is a legal reading for the owner. Nothing was invented
   here.
5. **CIMD.** Claude prefers a Client ID Metadata Document ("Use Claude's published identity") and warns that DCR
   creates a client per new connection (S3). DCR works; registrations are small rows. If `oauth_client` grows too
   much after listing, advertise `client_id_metadata_document_supported` (needs better-auth support) or enter an
   Anthropic-held client in the portal (`oauth_anthropic_creds`, redirect `https://claude.ai/api/mcp/auth_callback`;
   Claude Code keeps using DCR/CIMD).
6. **better-auth's own rate limits** on `/oauth2/token` and `/oauth2/register` (120 and 60 per minute) are per
   isolate and keyed by client IP. All claude.ai refreshes come from Anthropic's range; watch for 429s on
   `/api/auth/oauth2/token` after listing and raise or key them differently if they appear.
7. **Support address**: support@joyorogo.com (Cloudflare Email Routing, forwards to the owner).

## Owner steps

1. Merge `feat/read-only-choice`, then this PR; let `deploy.yml` deploy (or deploy as usual).
2. Check the live server: `curl -s https://arto.joyorogo.com/claude | grep -c Claude` and, from Claude, that the
   connector's tool list shows read and write groups.
3. Confirm `DEMO_LOGIN_CODE` is set (`cd apps/server && bunx wrangler secret list`). Then sign in with the demo code
   through a custom connector in your own Claude and run every tool once (or use MCP Inspector).
4. From a paid Claude account (your Pro/Max account is enough), open https://claude.ai/directory/manage → **Submit
   new** → **MCP connector** and fill in the fields above. Put the demo code only in the portal's credentials field.
5. Watch the submission status in the portal. Escalations: mcp-review@anthropic.com.
6. After publishing, update the landing page and Settings ("Find JoyoArto in the connectors directory") and track the
   portal's health badge (issue 3 above).
