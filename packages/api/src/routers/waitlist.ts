import { schema } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { publicProcedure, sessionProcedure } from "../index";
import * as waitlist from "../services/waitlist";

const tags = ["waitlist"];

/** Operators only: a signed-in browser session whose email is in ADMIN_EMAILS. */
export const adminProcedure = sessionProcedure.use(async ({ context, next }) => {
  const admins = context.request?.adminEmails ?? [];
  const [u] = await context.db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, context.principal.userId));
  if (!u || !admins.includes(u.email.toLowerCase())) throw new ORPCError("FORBIDDEN", { message: "Only JoyoArto's operators can see this." });
  return next();
});

export const waitlistRouter = {
  join: publicProcedure
    .route({ method: "POST", path: "/waitlist", tags, summary: "Join the waitlist for hosted JoyoArto (no account needed)" })
    .input(waitlist.joinInput)
    .handler(async ({ context, input }) => {
      const req = context.request;
      if (req?.allow && !(await req.allow("waitlist", req.ip ?? "unknown"))) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Terlalu banyak percobaan. Coba lagi sebentar lagi." });
      }
      const ipHash = req?.ip ? await waitlist.hashIp(req.ip, req.ipSalt) : null;
      return waitlist.joinWaitlist(context.db, input, ipHash);
    }),
  list: adminProcedure
    .route({ method: "GET", path: "/waitlist", tags, summary: "Waitlist sign-ups, newest first, with counts (operators)" })
    .input(waitlist.listInput)
    .handler(({ context, input }) => waitlist.listWaitlist(context.db, input)),
};
