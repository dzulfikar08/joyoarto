import { ensureHousehold } from "@baroka/api/lib/household";
import { demoLogin } from "@baroka/api/services/demo";
import { hasPendingInvite } from "@baroka/api/services/household";
import { createAuth as buildAuth } from "@baroka/auth";
import type { BarokaAuth } from "@baroka/auth";
import { createDb } from "@baroka/db";
import type { Database } from "@baroka/db";

import { env } from "./env";

let db: Database | undefined;
let auth: BarokaAuth | undefined;

export function getDb(): Database {
  db ??= createDb(env.DB);
  return db;
}

export function getAuth(): BarokaAuth {
  auth ??= buildAuth(env, getDb(), {
    onUserCreated: async (user) => {
      await ensureHousehold(getDb(), user.id, user.name);
    },
    canSignUp: (email) => hasPendingInvite(getDb(), email),
    demoSignIn: async (code) => {
      if (!env.DEMO_LOGIN_CODE?.trim()) return { ok: false, reason: "off" };
      try {
        return { ok: true, ...(await demoLogin(getDb(), code, env.DEMO_LOGIN_CODE)) };
      } catch (error) {
        if ((error as { code?: string }).code === "UNAUTHORIZED") return { ok: false, reason: "wrong" };
        throw error;
      }
    },
  });
  return auth;
}
