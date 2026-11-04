import { ensureHousehold } from "@baroka/api/lib/household";
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
  });
  return auth;
}
