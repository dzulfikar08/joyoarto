import { ORPCError, os } from "@orpc/server";

import type { Context, Scope } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.principal) throw new ORPCError("UNAUTHORIZED", { message: "Sign in or send a valid API token." });
  return next({ context: { principal: context.principal } });
});

export const authedProcedure = publicProcedure.use(requireAuth);

/** Needs a signed-in browser session: a token or an AI connection cannot mint tokens or invite people. */
export const sessionProcedure = authedProcedure.use(({ context, next }) => {
  if (context.principal.via !== "session") throw new ORPCError("FORBIDDEN", { message: "Do this from the JoyoArto web app." });
  return next();
});

const scoped = (scope: Scope) =>
  authedProcedure.use(async ({ context, next }) => {
    if (!context.principal.scopes.includes(scope)) {
      throw new ORPCError("FORBIDDEN", { message: `This token or connection lacks the "${scope}" permission.` });
    }
    return next();
  });

export const readProcedure = scoped("finance:read");
export const writeProcedure = scoped("finance:write");
