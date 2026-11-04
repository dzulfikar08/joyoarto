// The iOS share extension opens joyoarto://dataUrl=joyoartoShareKey; that is not a route, so send it to the
// import screen (expo-share-intent reads the shared files there).
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes("dataUrl=")) return "/import";
  return path;
}
