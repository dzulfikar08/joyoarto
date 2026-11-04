import { mcp } from "@better-auth/mcp";
import type { Database } from "@baroka/db";
import * as authSchema from "@baroka/db/schema/auth";
import * as oauthSchema from "@baroka/db/schema/oauth";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { bearer, jwt } from "better-auth/plugins";

import { MCP_OFFLINE_SCOPE, MCP_PATH, MCP_SCOPES } from "./mcp-scopes";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  /** Comma-separated origins of the web app. */
  CORS_ORIGIN: string;
  /** Web app origin: the login and consent pages of the MCP connector live there. Empty = BETTER_AUTH_URL. */
  APP_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Non-empty enables the credentialless dev sign-in. Never set it in production. */
  DEV_LOGIN?: string;
  /** Comma-separated emails allowed to sign up. Empty = anyone with a Google account. */
  ALLOWED_EMAILS?: string;
  /**
   * Comma-separated extra Google OAuth client ids whose ID tokens are accepted (`aud`). The phone app's native Google
   * Sign-In on iOS gets tokens for the iOS client; Android's are for GOOGLE_CLIENT_ID (the web client) already.
   */
  GOOGLE_NATIVE_CLIENT_IDS?: string;
  /**
   * Comma-separated iOS bundle ids for native Sign in with Apple (the identity token's audience). Empty = Apple off.
   * No Services ID or key: the app sends Apple's identity token, verified against Apple's JWKS.
   */
  APPLE_BUNDLE_IDS?: string;
};

export type AuthHooks = {
  /** Runs once after a user row is created (gives them a household). */
  onUserCreated?: (user: { id: string; name: string }) => Promise<void>;
  /** Lets an email that is not on ALLOWED_EMAILS sign up (a pending household invite). */
  canSignUp?: (email: string) => Promise<boolean>;
  /**
   * The store reviewers' demo account: checks the code (DEMO_LOGIN_CODE) and resets the demo data. Unset = no
   * /sign-in/demo endpoint at all.
   */
  demoSignIn?: (code: string) => Promise<{ ok: true; userId: string } | { ok: false; reason: "off" | "wrong" }>;
};

export type BarokaAuth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<BarokaAuth["api"]["getSession"]>>;

const DEV_USER = { email: "dev@baroka.local", name: "Dev User" };

/** Credentialless sign-in for local development; the endpoint exists only when DEV_LOGIN is set. */
function devLogin(enabled: boolean): BetterAuthPlugin {
  return {
    id: "dev-login",
    endpoints: enabled
      ? {
          signInDevUser: createAuthEndpoint("/sign-in/dev-user", { method: "POST" }, async (ctx) => {
            const adapter = ctx.context.internalAdapter;
            const found = await adapter.findUserByEmail(DEV_USER.email);
            const user =
              found?.user ??
              (await adapter.createUser(
                { ...DEV_USER, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
                { method: "dev-login" },
              ));
            const session = await adapter.createSession(user.id);
            if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create a dev session" });
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ user });
          }),
        }
      : {},
  };
}

/** Web sign-in to the demo account with a demo code (packages/api/src/services/demo.ts decides and seeds). */
function demoLogin(signIn: AuthHooks["demoSignIn"]): BetterAuthPlugin {
  return {
    id: "demo-login",
    endpoints: signIn
      ? {
          signInDemo: createAuthEndpoint("/sign-in/demo", { method: "POST" }, async (ctx) => {
            const code = typeof (ctx.body as { code?: unknown } | undefined)?.code === "string" ? (ctx.body as { code: string }).code : "";
            if (!code.trim() || code.length > 200) throw new APIError("BAD_REQUEST", { message: "Enter the demo code." });
            const result = await signIn(code);
            if (!result.ok) {
              if (result.reason === "off") throw new APIError("NOT_FOUND", { message: "Demo login is not available on this server." });
              throw new APIError("UNAUTHORIZED", { message: "That demo code is not right." });
            }
            const adapter = ctx.context.internalAdapter;
            const user = await adapter.findUserById(result.userId);
            const session = user && (await adapter.createSession(user.id));
            if (!user || !session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not start a demo session" });
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ user: { id: user.id, name: user.name } });
          }),
        }
      : {},
  };
}

/** Where the connector's access tokens are accepted: the MCP endpoint, which is the `aud` of every token. */
export function mcpResourceUrl(authUrl: string): string {
  return `${authUrl.replace(/\/$/, "")}${MCP_PATH}`;
}

/**
 * OAuth 2.1 authorization server for the MCP connector (claude.ai, Claude Desktop, Claude Code, other MCP clients):
 * authorization code + PKCE, dynamic client registration, resource-bound JWT access tokens (RFC 8707) and rotating
 * refresh tokens. Login and consent are one page of the web app (/connect).
 *
 * `offline_access` is added to every authorization request that names scopes: without it no refresh token is issued
 * and the connector would sign out every hour. A missing `resource` is filled in so the token is a JWT for /mcp.
 */
export function mcpPlugins(env: Pick<AuthConfig, "BETTER_AUTH_URL" | "APP_URL">): BetterAuthPlugin[] {
  const appUrl = (env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "");
  const page = `${appUrl}/connect`;
  const provider = mcp({
    loginPage: page,
    consentPage: page,
    resource: mcpResourceUrl(env.BETTER_AUTH_URL),
    scopes: [...MCP_SCOPES],
    grantTypes: ["authorization_code", "refresh_token"],
    allowPublicClientPrelogin: true,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    accessTokenExpiresIn: 60 * 60,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    rateLimit: {
      token: { window: 60, max: 120 },
      authorize: { window: 60, max: 120 },
      register: { window: 60, max: 60 },
      revoke: { window: 60, max: 60 },
    },
  });
  return [
    jwt({ disableSettingJwtHeader: true }),
    {
      ...provider,
      hooks: {
        ...provider.hooks,
        before: [
          ...(provider.hooks?.before ?? []),
          {
            matcher: (ctx) => ctx.path === "/oauth2/authorize",
            handler: createAuthMiddleware(async (ctx) => {
              const query = (ctx.query ?? {}) as { scope?: unknown; resource?: unknown };
              const scope = typeof query.scope === "string" ? query.scope : undefined;
              const needsScope = scope !== undefined && !scope.split(" ").includes(MCP_OFFLINE_SCOPE);
              const needsResource = query.resource === undefined;
              if (!needsScope && !needsResource) return;
              return {
                context: {
                  query: {
                    ...query,
                    ...(needsScope ? { scope: `${scope} ${MCP_OFFLINE_SCOPE}` } : {}),
                    ...(needsResource ? { resource: mcpResourceUrl(env.BETTER_AUTH_URL) } : {}),
                  },
                },
              };
            }),
          },
          {
            // Better Auth 1.7.3 cannot infer the application type: desktop clients (Claude Code) register loopback or
            // custom-scheme callbacks and must be "native".
            matcher: (ctx) => ctx.path === "/oauth2/register",
            handler: createAuthMiddleware(async (ctx) => {
              const body = ctx.body as { application_type?: unknown; redirect_uris?: unknown } | undefined;
              if (!body || body.application_type !== undefined || !nativeRegistration(body.redirect_uris)) return;
              return { context: { body: { ...body, application_type: "native" } } };
            }),
          },
        ],
      },
    },
  ];
}

function nativeRegistration(redirectUris: unknown): boolean {
  if (!Array.isArray(redirectUris)) return false;
  return redirectUris.some((uri) => {
    try {
      const url = new URL(String(uri));
      if (url.protocol === "https:") return false;
      if (url.protocol !== "http:") return true;
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      return false;
    }
  });
}

/** A comma-separated list, trimmed, without empties or repeats. */
export function parseList(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
}

/** Sign-in providers: Google (web redirect, and ID tokens from the phone app), Apple (phone app only). */
export function socialProviders(env: Pick<AuthConfig, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_NATIVE_CLIENT_IDS" | "APPLE_BUNDLE_IDS">) {
  const apple = parseList(env.APPLE_BUNDLE_IDS);
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            // The first id is the web client (redirect flow); every id is an accepted ID-token audience.
            clientId: [env.GOOGLE_CLIENT_ID, ...parseList(env.GOOGLE_NATIVE_CLIENT_IDS).filter((id) => id !== env.GOOGLE_CLIENT_ID)],
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            overrideUserInfoOnSignIn: true,
          },
        }
      : {}),
    ...(apple.length
      ? {
          apple: {
            clientId: apple[0]!,
            appBundleIdentifier: apple[0]!,
            audience: apple,
            // Apple sends the name only on the first authorization (the app passes it along); never store an empty one.
            mapProfileToUser: (profile: { name?: unknown }) => (profile.name ? {} : { name: "JoyoArto" }),
          },
        }
      : {}),
  };
}

export function parseEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function createAuth(env: AuthConfig, database: Database, hooks: AuthHooks = {}) {
  const allowed = parseEmails(env.ALLOWED_EMAILS);
  return betterAuth({
    database: drizzleAdapter(database, { provider: "sqlite", schema: { ...authSchema, ...oauthSchema } }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // joyoarto:// is the phone app (it signs in with ID tokens and sends no cookies or Origin, so this only matters for
    // a callbackURL it might pass).
    trustedOrigins: [...parseList(env.CORS_ORIGIN), "joyoarto://"],
    socialProviders: socialProviders(env),
    databaseHooks: {
      user: {
        create: {
          // Invite-only: the allowlist and people with a pending household invite may create accounts.
          before: async (user) => {
            const email = user.email.toLowerCase();
            if (!allowed.length || allowed.includes(email) || email === DEV_USER.email) return;
            if (!(await hooks.canSignUp?.(email))) return false;
          },
          after: async (user) => {
            await hooks.onUserCreated?.({ id: user.id, name: user.name });
          },
        },
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: {
      defaultCookieAttributes: { sameSite: "none", secure: true, httpOnly: true },
    },
    disabledPaths: ["/token"],
    // bearer(): the phone app keeps its session token (set-auth-token on sign-in) in the Keychain/Keystore and sends it as
    // `Authorization: Bearer`; apps/server/src/principal.ts tells it apart from `brk_` personal access tokens.
    plugins: [bearer(), devLogin(Boolean(env.DEV_LOGIN)), demoLogin(hooks.demoSignIn), ...mcpPlugins(env)],
  });
}
