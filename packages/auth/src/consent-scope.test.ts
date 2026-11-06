// The connector's consent page (apps/web/src/routes/connect.tsx) lets a member approve read-only access: it sends the
// narrowed scope set to /oauth2/consent, and the access token must really lack finance:write.

import { expect, test } from "bun:test";

import { createHash } from "node:crypto";

import { testDb } from "../../api/src/test/d1";
import { createAuth } from "./index";
import { MCP_PATH } from "./mcp-scopes";
import { verifyMcpAccessToken } from "./mcp-token";

const BASE = "http://localhost:3000";
const env = { BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: "x".repeat(32), CORS_ORIGIN: BASE, DEV_LOGIN: "1" };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const b64url = (buf: Buffer) => buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function flow(requested: string, accepted: string | undefined) {
  const { db } = await testDb();
  const auth = createAuth(env, db);
  const json = { "Content-Type": "application/json", Origin: BASE };

  const login = await auth.handler(new Request(`${BASE}/api/auth/sign-in/dev-user`, { method: "POST", headers: json }));
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

  // What claude.ai does: dynamic registration, then the authorization request with the scopes from our metadata.
  const reg = await auth.handler(
    new Request(`${BASE}/api/auth/oauth2/register`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    }),
  );
  expect(reg.status).toBeLessThan(300);
  const clientId = ((await reg.json()) as { client_id: string }).client_id;

  const verifier = b64url(Buffer.from(crypto.getRandomValues(new Uint8Array(32))));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const authorize = new URL(`${BASE}/api/auth/oauth2/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: requested, state: "s1", code_challenge: challenge, code_challenge_method: "S256" })) {
    authorize.searchParams.set(k, v);
  }
  const toConsent = await auth.handler(new Request(authorize.toString(), { headers: { cookie }, redirect: "manual" }));
  const consentPage = new URL(toConsent.headers.get("location") ?? "");
  expect(consentPage.pathname).toBe("/connect");
  const oauthQuery = consentPage.search.slice(1);

  const consent = await auth.handler(
    new Request(`${BASE}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery, ...(accepted ? { scope: accepted } : {}) }),
    }),
  );
  expect(consent.status).toBe(200);
  const back = new URL(((await consent.json()) as { url: string }).url);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await auth.handler(
    new Request(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: `${BASE}${MCP_PATH}` }),
    }),
  );
  expect(token.status).toBe(200);
  const tokens = (await token.json()) as { access_token: string; refresh_token?: string; scope: string };
  const principal = await verifyMcpAccessToken(auth, new Request(`${BASE}${MCP_PATH}`, { headers: { authorization: `Bearer ${tokens.access_token}` } }), BASE);

  // A refresh keeps what was granted, never what was first requested.
  const refreshed = await auth.handler(
    new Request(`${BASE}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token ?? "", client_id: clientId, resource: `${BASE}${MCP_PATH}` }),
    }),
  );
  expect(refreshed.status).toBe(200);
  const again = (await refreshed.json()) as { access_token: string };
  const later = await verifyMcpAccessToken(auth, new Request(`${BASE}${MCP_PATH}`, { headers: { authorization: `Bearer ${again.access_token}` } }), BASE);

  return { scope: tokens.scope, scopes: principal.scopes, refreshedScopes: later.scopes };
}

test("read-only consent to claude.ai's request gives a token without finance:write", async () => {
  // claude.ai asks for what the WWW-Authenticate challenge advertises (finance:read finance:write).
  const r = await flow("finance:read finance:write", "finance:read offline_access");
  expect(r.scopes).toEqual(["finance:read"]);
  expect(r.scope.split(" ")).not.toContain("finance:write");
  expect(r.refreshedScopes).toEqual(["finance:read"]);
});

test("consenting to everything requested keeps finance:write", async () => {
  const r = await flow("finance:read finance:write", undefined);
  expect(r.scopes.sort()).toEqual(["finance:read", "finance:write"]);
  expect(r.refreshedScopes.sort()).toEqual(["finance:read", "finance:write"]);
});

test("a scope that was not requested cannot be added at consent", async () => {
  await expect(flow("finance:read", "finance:read finance:write offline_access")).rejects.toThrow();
});
