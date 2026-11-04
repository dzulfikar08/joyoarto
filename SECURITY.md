# Security policy

JoyoArto holds people's household finances, so security reports are welcome and handled first.

## Reporting a vulnerability

Email **dzulfikar.at@gmail.com** with "JoyoArto security" in the subject. Please do **not** open a public issue, pull
request or discussion for a vulnerability.

Include what you found, how to reproduce it (requests, accounts or steps), and what an attacker could reach. If you can,
use a test household of your own; never access, change or keep other people's data, and stop as soon as you see any.

What to expect:

- an acknowledgement within 3 working days;
- an assessment and a plan within 10 working days;
- a fix as soon as we can for the hosted service (https://arto.joyorogo.com), then a release note here once it is
  safe to describe. Tell us if you would like to be credited.

## Scope

- This repository: the Worker (`apps/server`), API and services (`packages/*`), web app (`apps/web`) and Android app
  (`apps/mobile`).
- The hosted service at `arto.joyorogo.com` and `app.arto.joyorogo.com`, including `/api`, `/mcp` and the OAuth flow.

Out of scope: denial of service and volume testing, social engineering, spam to the waitlist, findings that need a
rooted device or a compromised Google account, and reports from automated scanners without a working impact.

## Self-hosting

If you run your own copy, keep secrets in `wrangler secret put` (never in `wrangler.jsonc` or the repo), set your own
`ALLOWED_EMAILS` and `ADMIN_EMAILS`, and never set `DEV_LOGIN` outside local development.
