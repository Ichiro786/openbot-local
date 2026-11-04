// Frozen optional avatar-color-v1 wire contract (OpenBot Local fork only).
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member reads
// the custom avatar colours of the agents, and sets or clears one the same way any member edits an
// agent's appearance through `PATCH /v1/agents/:id`. A colour is lowercase `#rrggbb`. Setting one also
// sets the agent's `avatarHue` to the nearest preset, so a client without this capability still draws
// a close colour; choosing a preset hue or seed through the agent edit clears the custom colour.
// Widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const AVATAR_COLOR_CAPABILITY = "avatar-color-v1";
export const AVATAR_COLOR_ROUTES = {
  read: "/v1/avatar-colors",
  set: "/v1/avatar-colors/set",
} as const;

const color: AdminDecoder = (input) => {
  if (typeof input !== "string" || !/^#[0-9a-f]{6}$/.test(input)) throw new Error("Invalid avatar colour.");
  return input;
};
const colorOrNull: AdminDecoder = (input) => (input === null ? null : color(input));
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid avatar colour request.");
    return decode(input);
  };
const snapshot = fields({ agents: list(fields({ agentId: identifier, color }), 1000) });

export const AVATAR_COLOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AVATAR_COLOR_ROUTES.read, adminRoute(empty, snapshot)],
  [
    AVATAR_COLOR_ROUTES.set,
    adminRoute(exact(["agentId", "color"], fields({ agentId: identifier, color: colorOrNull })), snapshot),
  ],
]);
