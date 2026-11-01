import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";

/**
 * Whether this app version may show a host's browser.
 *
 * Upstream reads the `browser` flag from the account server the phone signed in to. That server
 * gates the flag by app version, and turns it off for any version newer than the store's latest. The
 * OpenBot Local fork ships its own version (1.4.5 while the store had 1.4.4), so the answer was always
 * `browser: false`, and a takeover card showed only "I'm done" with no "Open browser". The fork does not
 * ask the account server: the host still decides, through its `browser-control` and `browser-view`
 * capabilities (`browserViewSupport`). A development override still wins.
 */
export function useBrowserFeature(): boolean {
  return devFeatureOverride("browser") ?? true;
}
