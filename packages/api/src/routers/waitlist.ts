import { schema } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { sessionProcedure } from "../index";
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
  list: adminProcedure
    .route({ method: "GET", path: "/waitlist", tags, summary: "Waitlist sign-ups kept from before open sign-up, newest first, with counts (operators)" })
    .input(waitlist.listInput)
    .handler(({ context, input }) => waitlist.listWaitlist(context.db, input)),
};
