import { Redirect } from "expo-router";

/** The Joyo AI tab slot. Its button pushes the chat (app/joyo.tsx) as a full screen without the tab bar; see (tabs)/_layout.tsx. */
export default function JoyoTabRoute() {
  return <Redirect href="/joyo" />;
}
