import { Text } from "@/components/ui";
import { useSession } from "@/src/lib/auth";
import { SESSION_ONLY_MESSAGE } from "@/src/lib/errors";

/**
 * True when signed in with Google or Apple. Access tokens (brk_, the reviewers' demo code) cannot reach the server's
 * session-only procedures: API tokens, invites, email import, export, account deletion.
 */
export function useHasSession(): boolean {
  return useSession()?.kind === "session";
}

/** Shown instead of a control that needs a Google or Apple sign-in. */
export function SessionOnlyNote() {
  return (
    <Text variant="caption" tone="muted">
      {SESSION_ONLY_MESSAGE}
    </Text>
  );
}
