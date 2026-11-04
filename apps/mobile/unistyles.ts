import { StyleSheet } from "react-native-unistyles";

import { darkTheme, lightTheme } from "./theme";

const breakpoints = { xs: 0, sm: 576, md: 768, lg: 992 } as const;

type AppBreakpoints = typeof breakpoints;
type AppThemes = { light: typeof lightTheme; dark: typeof darkTheme };

declare module "react-native-unistyles" {
  export interface UnistylesBreakpoints extends AppBreakpoints {}
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  breakpoints,
  themes: { light: lightTheme, dark: darkTheme },
  settings: { adaptiveThemes: true },
});
