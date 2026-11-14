import { describe, expect, it } from "vitest";
import { OPENBOT_UI_LEVELS, openbotUiSettingJson, parseOpenbotUiSetting } from "./openbot-ui-setting";

describe("openbot-ui setting file", () => {
  it("defaults to on + balanced for a missing, empty or broken file", () => {
    for (const text of ["", "{not json", "null", "[]"])
      expect(parseOpenbotUiSetting(text)).toEqual({ enabled: true, level: "balanced" });
  });

  it("reads build 15's v1 file as balanced", () => {
    expect(parseOpenbotUiSetting('{"version":1,"enabled":false}')).toEqual({ enabled: false, level: "balanced" });
    expect(parseOpenbotUiSetting('{"version":1,"enabled":true}')).toEqual({ enabled: true, level: "balanced" });
  });

  it("round-trips every v2 level and both switch states", () => {
    for (const level of OPENBOT_UI_LEVELS)
      for (const enabled of [true, false]) {
        const json = openbotUiSettingJson({ enabled, level });
        expect(JSON.parse(json)).toEqual({ version: 2, enabled, level });
        expect(parseOpenbotUiSetting(json)).toEqual({ enabled, level });
        // Written inside single quotes in a shell command.
        expect(json).not.toContain("'");
      }
  });

  it("treats an unknown level as balanced", () => {
    expect(parseOpenbotUiSetting('{"version":2,"enabled":true,"level":"max"}').level).toBe("balanced");
  });
});
