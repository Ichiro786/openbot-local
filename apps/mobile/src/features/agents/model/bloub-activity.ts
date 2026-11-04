import { COLOR_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import { type AvatarTint, feltColor } from "./avatar-color";

/** The felt colour of a plush. A custom colour is clamped so near-black and near-white felt keep its shading. */
export function getBloubAvatarColor(seed: string, hue: AvatarTint): string {
  if (typeof hue === "string") return feltColor(hue);
  const profile = bloubAvatarProfile(seed, hue);
  return COLOR_BY_ID.get(profile.color)?.hex ?? "#8b5cf6";
}
