const { withMainActivity } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// Android: ask for the display's highest refresh rate at the current resolution. Some OEM skins
// (ColorOS/Realme "Auto") keep apps that do not ask at 60 Hz. Android still lowers the rate on still
// content where the panel supports it (LTPO).
const SNIPPET = `    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      display?.let { screen ->
        val current = screen.mode
        val best = screen.supportedModes
          .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
          .maxByOrNull { it.refreshRate }
        if (best != null && best.modeId != current.modeId) {
          window.attributes = window.attributes.also { it.preferredDisplayModeId = best.modeId }
        }
      }
    }`;

/** @param {string} contents */
function addHighRefreshRate(contents) {
  if (!/super\.onCreate\(/.test(contents)) {
    console.warn("[with-high-refresh-rate] MainActivity has no super.onCreate call; skipped.");
    return contents;
  }
  return mergeContents({
    src: contents,
    newSrc: SNIPPET,
    tag: "openbot-high-refresh-rate",
    anchor: /super\.onCreate\(/,
    offset: 1,
    comment: "//",
  }).contents;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      console.warn("[with-high-refresh-rate] MainActivity is not Kotlin; skipped.");
      return mod;
    }
    mod.modResults.contents = addHighRefreshRate(mod.modResults.contents);
    return mod;
  });

module.exports.addHighRefreshRate = addHighRefreshRate;
