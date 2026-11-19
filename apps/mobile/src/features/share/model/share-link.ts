export function isIncomingShareLink(path: string): boolean {
  try {
    const url = new URL(path);
    // OpenBot Local: the app scheme is `openbotlocal`, so expo-sharing opens `openbotlocal://expo-sharing`.
    return (url.protocol === "openbot:" || url.protocol === "openbotlocal:") && url.host === "expo-sharing";
  } catch {
    return false;
  }
}
