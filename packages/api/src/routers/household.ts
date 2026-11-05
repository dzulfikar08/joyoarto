import { z } from "zod";

import { readProcedure, sessionProcedure } from "../index";
import { refuseDemo } from "../lib/demo";
import * as account from "../services/account";
import * as household from "../services/household";

const tags = ["household"];

/**
 * Family households: members, invites and which household is active. Every change needs a signed-in session (the web
 * app's cookie or the phone app's session bearer), never a `brk_` token or AI connection: a leaked token must not be
 * able to invite its holder in, move members around or switch households. Owner-only checks live in the service.
 */
export const householdRouter = {
  get: readProcedure
    .route({
      method: "GET",
      path: "/household",
      tags,
      summary: "The active household: name, your role, members, pending invites (owners)",
    })
    .handler(({ context }) => household.householdInfo(context.db, context.principal)),
  rename: sessionProcedure
    .route({
      method: "PATCH",
      path: "/household",
      tags,
      summary: "Rename the active household (owner)",
    })
    .input(household.renameInput)
    .handler(({ context, input }) => household.renameHousehold(context.db, context.principal, input)),
  list: readProcedure
    .route({ method: "GET", path: "/households", tags, summary: "Every household you belong to" })
    .handler(({ context }) => household.listHouseholds(context.db, context.principal)),
  switch: sessionProcedure
    .route({
      method: "PUT",
      path: "/households/active",
      tags,
      summary: "Make one of your households the active one (web app, tokens and AI connections)",
    })
    .input(household.switchInput)
    .handler(({ context, input }) => household.switchHousehold(context.db, context.principal, input)),
  delete: sessionProcedure
    .route({
      method: "POST",
      path: "/household/delete",
      tags,
      summary: "Delete the active household and all its finance data (owner, session only; type its name to confirm)",
    })
    .input(account.deleteHouseholdInput)
    .handler(({ context, input }) => {
      refuseDemo(context.principal.userId, "deleteHousehold");
      return account.deleteHousehold(context.db, context.principal, input, context.files);
    }),
  leave: sessionProcedure
    .route({
      method: "POST",
      path: "/household/leave",
      tags,
      summary: "Leave the active household (not as its last owner)",
    })
    .handler(({ context }) => {
      refuseDemo(context.principal.userId, "leaveHousehold");
      return household.leaveHousehold(context.db, context.principal);
    }),

  members: {
    setRole: sessionProcedure
      .route({
        method: "PATCH",
        path: "/household/members/{userId}",
        tags,
        summary: "Change a member's role (owner)",
      })
      .input(household.memberRoleInput)
      .handler(({ context, input }) => household.setMemberRole(context.db, context.principal, input)),
    remove: sessionProcedure
      .route({
        method: "DELETE",
        path: "/household/members/{userId}",
        tags,
        summary: "Remove a member (owner)",
      })
      .input(z.object({ userId: z.string() }))
      .handler(({ context, input }) => household.removeMember(context.db, context.principal, input.userId)),
  },

  invites: {
    create: sessionProcedure
      .route({
        method: "POST",
        path: "/household/invites",
        tags,
        summary: "Invite an email address (owner); the link is shown once",
      })
      .input(household.inviteInput)
      .handler(({ context, input }) => {
        refuseDemo(context.principal.userId, "invite");
        return household.createInvite(context.db, context.principal, input, context.billing);
      }),
    revoke: sessionProcedure
      .route({
        method: "DELETE",
        path: "/household/invites/{id}",
        tags,
        summary: "Revoke a pending invite (owner)",
      })
      .input(z.object({ id: z.string() }))
      .handler(({ context, input }) => household.revokeInvite(context.db, context.principal, input.id)),
    preview: readProcedure
      .route({
        method: "POST",
        path: "/household/invites/preview",
        tags,
        summary: "Household, inviter and status of an invite token",
      })
      .input(household.tokenInput)
      .handler(({ context, input }) => household.previewInvite(context.db, context.principal, input)),
    accept: sessionProcedure
      .route({
        method: "POST",
        path: "/household/invites/accept",
        tags,
        summary: "Join the invite's household and make it active",
      })
      .input(household.tokenInput)
      .handler(({ context, input }) => {
        refuseDemo(context.principal.userId, "acceptInvite");
        return household.acceptInvite(context.db, context.principal, input, context.billing);
      }),
  },
};
