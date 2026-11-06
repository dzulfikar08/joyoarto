# What the operator can see (BRK-56)

JoyoArto runs on one Cloudflare Worker with a D1 database and an R2 bucket. Whoever holds the Cloudflare account (the
operator) could, before this change, read every member's finances by opening the D1 console or running
`wrangler d1 execute --remote`. End-to-end encryption was considered and rejected for now: the server has to read the
data to parse statements, answer Joyo AI, serve the Claude connector (MCP) and import statements sent by email.

So the goal is narrower and honest: **make it hard to see member data by accident or out of curiosity, make deliberate
access traceable, and say plainly what is still possible.**

## Threat model in plain words

| Situation | Protected? |
| --- | --- |
| Someone opens the D1 console or runs `wrangler d1 execute` and browses tables | **Yes** for the encrypted columns below: they show `enc:v1:…`. No for the plaintext columns. |
| A D1 export (`wrangler d1 export`), Time Travel restore or backup copy leaks | Same as above: encrypted columns stay ciphertext. |
| Someone browses the R2 bucket | **Yes** for photos uploaded with the key set (and old ones after the backfill): objects are opaque bytes. |
| A leaked Cloudflare API token with D1/R2 read access, without the Worker secret | **Yes** for the encrypted columns and photos. |
| Casual curiosity by the operator or a helper with dashboard access | **Mostly**: amounts, dates, merchants and bank descriptions remain readable (see below). |
| An admin page or API that lists member data | **Yes**: there is none, and a test pins that (see "Operator surface"). |
| Request logs (`wrangler tail`, Workers Logs) | **Yes** for query strings: the request log prints method, path and status only. |
| An operator who deploys code that decrypts and prints data | **No.** The Worker holds the key; code running in it can read everything. This is traceable (below), not prevented. |
| An operator compelled by law, or whose Cloudflare account is fully taken over (including the ability to deploy) | **No.** |
| Cloudflare itself | Out of scope: Cloudflare runs the code and holds the secret. |

## How it works

- Worker secret **`DATA_KEY`**: 32 random bytes, base64. Cloudflare Worker secrets are write-only: the dashboard and API
  list their names but never return their values
  ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). The key is never stored in D1.
- `packages/api/src/lib/field-crypto.ts` (pure, tested): AES-256-GCM via WebCrypto, a random 12-byte IV per value.
  Text is stored as `enc:v1:<kid>:<base64url(iv ‖ ciphertext ‖ tag)>`; files as the same prefix in bytes followed by
  `iv ‖ ciphertext ‖ tag`. `<kid>` is the first 8 hex digits of SHA-256(key): it names the key without revealing it.
  Values without the prefix are plaintext and pass through unchanged, so old and new rows coexist.
- `packages/api/src/lib/data-key.ts`: the keyring, configured once per isolate by `apps/server` from `DATA_KEY` (and
  `DATA_KEY_PREVIOUS` during a rotation). The services call `sealText`/`sealJson`/`sealBytes` when writing and
  `unsealText`/`unsealJson`/`unsealBytes` when reading, so oRPC, REST, MCP, Joyo AI, the web and the phone see
  plaintext exactly as before. **No `DATA_KEY` = nothing changes** (dev, tests, self-hosts).
- A ciphertext read without its key is an error (`DataKeyError`), never shown as gibberish to a member.
- No schema migration: encrypted values fit the existing `text` columns. Encrypted receipt objects get the key suffix
  `.enc` so the backfill can tell them apart from the rows alone.

### What is encrypted

The list lives in `ENCRYPTED_COLUMNS` (`packages/api/src/services/encryption.ts`).

| Column | Why it can be encrypted |
| --- | --- |
| `transaction.note` | Free text, often the most personal. Only read in the Worker; search matches notes in the Worker (below). |
| R2 receipt photos (`attachment` objects) | Only served through `GET /api/attachments/{id}` and the claim PDF. |
| `joyo_conversation.title`, `joyo_message.content`, `.steps`, `.proposals` | Chat history: read whole by the server, never queried. |
| `reimbursement_profile.claimant_name`, `employee_id`, `department`, `approver_name`, `approver_email` | Personal details printed on claims only. |
| `reimbursement_claim.notes`, `.snapshot` | The frozen printed report (items, names, notes). |
| `plan_scenario.plan`, `.view` | Saved plans (income, loans, baby costs). The scenario `name` stays plaintext: it has a unique index. |
| `inbound_email.subject`, `.detail` | Import email log. The sender address is a member's own email (already in `user`). |
| `import_batch.file_name` | Statement file names often contain the account holder's name. |
| `mcp_audit.args` | AI connector call arguments include search text and quick-add descriptions. |

### What stays plaintext, and why

| Column | Why |
| --- | --- |
| `transaction.description` | Search `LIKE`, rules (`description contains …`), the dedupe key, reconciliation and statement parsing all run in SQL or need it before insert. |
| `transaction.merchant` | Search, rules, merchant grouping in reports and spending cuts (`GROUP BY merchant`), the merchant index. |
| Amounts, dates, balances, categories, account names | Every report, budget, dashboard and plan is SQL aggregation over them. Account and category names are short labels. |
| `fin_account.last4` | Only the last digits (never a full number); used to match Jago pockets. Low value, and encrypting it would hide nothing that the account name does not. |
| `payment_hint.merchant` | The same merchant name ends up in `transaction.merchant`; encrypting the hint alone would protect nothing. |
| `household.name`, members' names and emails | Needed for invites, sign-in and the members list; not finance data. |
| `waitlist_signup` | Not member finance data; the operator needs it to contact people. |

### Search over encrypted notes

`transactions.search` with `q` matched `description`, `merchant` and `note` with `LIKE`. With `DATA_KEY` set, notes
are matched in the Worker: the household's rows that have a note (`id`, `note` only, household-scoped) are decrypted
and filtered, and the matching ids go back into the SQL as one JSON parameter (`id in (select value from
json_each(?))`), so any number of matches stays within D1's 100-parameter limit. Notes are on a small share of rows,
so this is cheap; it is the same plan proposed below for descriptions.

## Descriptions and merchants: the owner's decision

Encrypting `description` and `merchant` would hide the most revealing plaintext left (who you pay). It is not in this
change because they are used inside SQL. Two concrete options:

1. **Search and match in the Worker.** Keep amounts, dates and categories in SQL; encrypt description and merchant.
   - Search: load the household's candidate rows (date range, account, category filters still in SQL), decrypt, match
     in the Worker, page in the Worker. A household has thousands, not millions, of rows; a year is roughly
     2–5k rows, a few hundred KB to decrypt per search. Acceptable for search; too slow for every dashboard load.
   - Rules: already evaluated in the Worker at import (`lib/rules.ts`); "apply to existing" would decrypt the
     uncategorised rows in pages.
   - Dedupe: the key is a hash computed before insert, unaffected. Reconciliation already happens in the Worker.
   - Reports grouped by merchant (top merchants, spending cuts, savings habits) would decrypt the period's rows and
     group in the Worker.
   - Cost: every query that touches merchants changes; moderate work, mostly in `services/reports.ts`,
     `services/savings.ts`, `services/dashboard.ts`, `services/transactions.ts`, `services/rules.ts`.
2. **Keyed blind indexes.** Store `merchant_bidx = HMAC(key2, normalise(merchant))` next to the ciphertext. Exact
   matches and `GROUP BY` work in SQL on the index; the display name is decrypted for output. Substring search (`LIKE`)
   does not work; it would need token indexes (HMAC per word or n-gram), which leak word frequency and grow the table.
   Rules with `contains` would run in the Worker as in option 1.
   - Leak: equal merchants have equal indexes, so the operator sees "this household pays the same payee 30 times",
     but not who.

Recommendation: option 1 for `description` (search and rules only), option 2 for `merchant` (grouping in reports).
Either needs a migration and a backfill like the one here. Not started; the owner decides.

## Backfill

Rows written before `DATA_KEY` was set stay plaintext until the backfill seals them:

```sh
# As an operator: a browser session whose email is in ADMIN_EMAILS (the same as /admin/waitlist).
# From the browser devtools console on https://app.arto.joyorogo.com:
await (await fetch("/api/admin/encryption/backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()
```

- Each call seals up to `limit` values per column (default 100, max 200) in one D1 batch per column, and up to `files`
  receipt photos (default 10, max 25): each photo is read, sealed into `<key>.enc`, the row moved, the old object
  deleted. Repeat until the answer says `"done": true`.
- The answer holds the key id and counts per column only: `encrypted`, `remaining`, `missingFiles`, `done`. Never data.
- Safe to repeat and to run while members use the app: a value is only replaced while it is still the plaintext that
  was read; sealed values are never selected again. A photo whose object is already gone has its row marked and keeps
  answering 404.
- Refused (412) when `DATA_KEY` is not set. `{"limit": 0, "files": 0}` only counts what is left.

## Operator surface (audit for BRK-56)

What an operator can reach in the app itself, checked by `packages/api/src/routers/admin-surface.test.ts` (it lists
every procedure behind `adminProcedure` and fails when a new one appears without a leak check):

| Route | Returns | Member finance data? |
| --- | --- | --- |
| `GET /api/waitlist` (`waitlist.list`, page `/admin/waitlist`) | Kept waitlist sign-ups: email, name, banks they ticked, source, language | No (people who are not members) |
| `POST /api/admin/demo/reset` | The demo household's id and row counts | No (made-up demo data) |
| `POST /api/admin/encryption/backfill` | Key id and counts | No |

Also checked:

- **Internal Joyo Pro status**: JoyoArto only *calls* JoyoRogo's `/api/internal/joyo-pro/status` (with a Google sub and
  a verified email); it has no internal endpoint of its own.
- **MCP audit log** (`mcp_audit`): no route reads it except the member's own export. Its `args` held search text and
  quick-add descriptions in plaintext: now encrypted.
- **Debug endpoints**: none. `/api/docs` and `/api/spec.json` are the public API description, no data.
- **Request log**: Hono's `logger()` printed full URLs, so `?q=<search text>`, dates and amounts in query strings
  reached `wrangler tail`. It now prints the path without the query string (`apps/server/src/log.ts`).
- **Error logs**: a few `console.error(error)` calls (MCP tool failures, email import failures, 5xx in the API) log the
  error object. Errors from the services carry messages like "Transaction <id> not found", not row contents; worth
  keeping in mind when adding errors.

## How deliberate access shows up

- **Code.** The repository is public (AGPL). Production is deployed only by `.github/workflows/deploy.yml` after CI
  passes on `main`, so code that decrypts and prints member data would have to be in public git history, or be deployed
  by hand with an API token (which leaves an audit log entry, below).
- **Cloudflare account audit log.** [Audit Logs v2](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/)
  record user-initiated actions through the API and the dashboard, including `view` actions for supported endpoints,
  kept 18 months (the dashboard shows 90 days; the API and Logpush the rest). D1 console queries and
  `wrangler d1 execute --remote` go through the account API (`/accounts/{id}/d1/database/{id}/query`), and
  `wrangler secret put` / deploys through the Workers API, so they are user-initiated API actions. Cloudflare's page does
  not list D1 or Workers by name and says a small number of endpoints are excluded: **the owner should run one D1
  console query and check that it appears** before relying on it. Queries the Worker itself makes through its binding are
  not in the audit log (they are the app running). [Audit Logs v1](https://developers.cloudflare.com/fundamentals/account/account-security/review-audit-logs/)
  covers changes and logins only.
- **Secrets.** Changing `DATA_KEY` is a Workers API action (audit log) and makes old ciphertext unreadable unless the
  old key is passed as `DATA_KEY_PREVIOUS`, so a swap would be noticed at once.

## What the operator can still do

- Read every plaintext column (amounts, dates, merchants, descriptions, account and category names) in the D1 console.
- Deploy code that decrypts. Traceable, not preventable.
- Read the key while it is being created (before `wrangler secret put`), or from wherever the backup copy is kept.
- See metadata: which household has how many rows, when members are active, sizes of photos.

## Recommended owner settings

- **Branch protection on `main`**: require a pull request and passing CI; no force pushes; include administrators.
- **Required reviewer on the `production` environment** (GitHub → Settings → Environments → production): a deploy waits
  for an approval. With one maintainer this mostly adds a deliberate click; with a second person it is a real check.
- **Scoped Cloudflare API token for CI**: only what `deploy.yml` lists (Workers Scripts, D1, R2, Routes, DNS on the two
  zones), only this account, ideally with a TTL. No global API key anywhere. Separate, short-lived tokens for any manual work.
- **2FA** on the Cloudflare account and GitHub (security keys if possible); no shared logins.
- **Audit log**: look at it now and then; Logpush to storage outside the account if longer retention is wanted.
- **Key custody**: keep one offline copy of `DATA_KEY` (a password manager entry with 2FA, or paper in a safe). Losing
  it loses every encrypted value and photo.

## Key rotation

1. Generate a new key. Set `DATA_KEY_PREVIOUS` to the old key (comma-separate several), then `DATA_KEY` to the new one.
2. New writes use the new key; reads accept both (the key id in each value picks the key).
3. Re-sealing old values with the new key is not built yet: it would be the backfill selecting `enc:v1:<old kid>:%`.
   Until then keep the old key in `DATA_KEY_PREVIOUS`.

## Future option: opt-in end-to-end encryption

A household could choose to encrypt everything with a key derived on members' devices (passkey or passphrase), so the
server only stores ciphertext. What it would turn off for that household:

- the Claude connector (MCP) and the REST API for scripts and Shortcuts (the server cannot read or write rows);
- Joyo AI on the hosted model (it could only run on the device, with the member's own key);
- import by email, server-side PDF reading (the phone's statement upload), and receipt reading on the server;
- server-side reports: the dashboard, plan and spending cuts would have to compute on the device;
- account recovery: a lost key means lost data; family members need key sharing.

It is a different product mode, not a setting, and is not planned for now.
