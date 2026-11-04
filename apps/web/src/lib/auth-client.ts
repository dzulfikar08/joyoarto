import { createAuthClient } from "better-auth/react";

import { SERVER_URL } from "./orpc";

/**
 * The better-auth client (sign-in, sign-out, the OAuth consent calls). Kept out of lib/auth.ts so the first page load
 * does not ship it: the session check there is a plain fetch, and only the pages that sign in or out import this.
 */
export const authClient = createAuthClient({ baseURL: `${SERVER_URL}/api/auth` });

export type Session = typeof authClient.$Infer.Session;
