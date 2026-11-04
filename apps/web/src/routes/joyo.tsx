import { createFileRoute } from "@tanstack/react-router";

import { JoyoPage } from "@/components/joyo/joyo-page";
import { requireSession } from "@/lib/auth";

type JoyoSearch = { c?: string };

/** Joyo AI, the finance chat. `?c=` is the open conversation (absent = a new one). */
export const Route = createFileRoute("/joyo")({
  beforeLoad: requireSession,
  validateSearch: (search: Record<string, unknown>): JoyoSearch => (typeof search.c === "string" && /^[\w-]{1,64}$/.test(search.c) ? { c: search.c } : {}),
  component: JoyoRoute,
});

function JoyoRoute() {
  const { c } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <JoyoPage conversationId={c} onConversation={(id) => void navigate({ search: id ? { c: id } : {}, replace: !!id })} />;
}
