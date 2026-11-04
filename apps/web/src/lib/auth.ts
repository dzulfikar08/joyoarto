import { queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import type { Session } from "./auth-client";
import { SERVER_URL, queryClient } from "./orpc";

/**
 * The signed-in session, or null. A plain GET of better-auth's /get-session (what `authClient.getSession()` sends), so
 * the landing page and the app shell do not load the better-auth client. Only `user.email` and truthiness are read;
 * dates stay ISO strings here.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<Session | null> => {
    const res = await fetch(`${SERVER_URL}/api/auth/get-session`, { credentials: "include" });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? ((JSON.parse(text) as Session | null) ?? null) : null;
  },
  staleTime: 5 * 60_000,
});

/** beforeLoad guard: signed-out visitors go to /login and come back afterwards. */
export async function requireSession({ location }: { location: { href: string } }) {
  const session = await queryClient.ensureQueryData(sessionQuery);
  if (!session) throw redirect({ to: "/login", search: { redirect: location.href } });
  return { session };
}

export async function signOut() {
  const { authClient } = await import("./auth-client");
  await authClient.signOut();
  queryClient.clear();
  location.assign("/login");
}
