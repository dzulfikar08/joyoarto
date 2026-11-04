// Order matters: unistyles must be configured before any StyleSheet.create runs, and the headless
// capture task must be registered before the router mounts (Android may start the JS runtime only for it).
import "./unistyles";
import "./src/capture/headless";
import "expo-router/entry";
