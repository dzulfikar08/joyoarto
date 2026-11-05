import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { FloatingTabBar } from "@/components/nav/floating-tab-bar";
import { openAddSheet } from "@/src/lib/add-sheet";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IconName, outline: IconName) {
  return ({ focused, size, color }: { focused: boolean; size: number; color: ColorValue }) => <Ionicons name={focused ? name : outline} size={size} color={color as string} />;
}

/**
 * The phone's main navigation, like the web's bottom nav (apps/web/src/components/bottom-nav.tsx): Home,
 * Transactions, a raised centre Add (opens the add sheet, never a screen), Joyo AI, More. Other screens are pushed
 * on the root stack above the tabs (app/_layout.tsx). Joyo AI is one of them: its tab pushes the chat (app/joyo.tsx) as
 * a detail page, so the tab bar is not drawn over the composer.
 */
export default function TabLayout() {
  const router = useRouter();
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} add={{ label: "Add transaction", onPress: () => openAddSheet() }} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ tabBarLabel: "Home", title: "Home", tabBarIcon: tabIcon("home", "home-outline") }} />
      <Tabs.Screen name="transactions" options={{ tabBarLabel: "Transactions", title: "Transactions", tabBarIcon: tabIcon("receipt", "receipt-outline") }} />
      <Tabs.Screen name="add" options={{ title: "Add" }} />
      <Tabs.Screen
        name="joyo-tab"
        options={{ tabBarLabel: "Joyo AI", title: "Joyo AI", tabBarIcon: tabIcon("sparkles", "sparkles-outline") }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/joyo");
          },
        }}
      />
      <Tabs.Screen name="more" options={{ tabBarLabel: "More", title: "More", tabBarIcon: tabIcon("ellipsis-horizontal", "ellipsis-horizontal-outline") }} />
    </Tabs>
  );
}
