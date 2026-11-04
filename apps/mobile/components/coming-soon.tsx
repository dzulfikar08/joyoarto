import { Linking } from "react-native";

import { Button, Card, EmptyState, Screen, Text, type IconName } from "@/components/ui";
import { useSession } from "@/src/lib/auth";
import { storeSafe } from "@/src/lib/platform";

/**
 * A placeholder for a screen a follow-up builds (apps/mobile/AGENTS.md "Screens still to build"): what it will do,
 * and (not on iOS, App Review 3.1.1: no pointers to the web app) a link to the same page on the web.
 */
export function ComingSoon({ icon, title, description, webPath, points = [] }: { icon: IconName; title: string; description: string; webPath: string; points?: string[] }) {
  const session = useSession();
  return (
    <Screen>
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={!storeSafe && session ? <Button title="Open on the web" variant="secondary" small icon="open-outline" onPress={() => void Linking.openURL(`${session.server}${webPath}`)} /> : undefined}
      />
      {points.length ? (
        <Card title="Coming to the app">
          {points.map((p) => (
            <Text key={p} tone="muted">
              • {p}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
