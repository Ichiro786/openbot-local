import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";

export function useBrowserFeature(): boolean {
  return devFeatureOverride("browser") ?? true;
}
