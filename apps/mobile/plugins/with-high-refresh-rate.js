const { withMainActivity } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// Android: ask for the display's highest refresh rate at the current resolution. Some OEM skins
// (ColorOS/Realme "Auto") keep apps that do not ask at 60 Hz. Android still lowers the rate on still
// content where the panel supports it (LTPO).
// Build 11.3 motion B1 (audit F42): always ask (an LTPO panel that happens to run at 120 Hz at launch
// got no preference before), and ask again on every resume (some skins drop it in the background).
// Never per frame: only when the window's preference is not the best mode yet.
const SNIPPET = `    val openbotHighRefreshRate = {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        display?.let { screen ->
          val current = screen.mode
          val best = screen.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .maxByOrNull { it.refreshRate }
          if (best != null && window.attributes.preferredDisplayModeId != best.modeId) {
            window.attributes = window.attributes.also { it.preferredDisplayModeId = best.modeId }
          }
          android.util.Log.i("OpenBotRefreshRate", "active \${current.refreshRate} Hz, preferred \${best?.refreshRate} Hz")
        }
      }
    }
    openbotHighRefreshRate()
    lifecycle.addObserver(androidx.lifecycle.LifecycleEventObserver { _, event ->
      if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) openbotHighRefreshRate()
    })`;

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
