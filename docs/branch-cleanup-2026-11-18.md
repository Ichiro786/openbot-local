# Branch cleanup — 2026-11-18

The user confirmed that APK artifact openbot-local-apk-120 works and installs over the previous app. Main now contains the tested mobile continuation and engine 0.72 source (PR #15).

## Remaining cleanup plan

Keep main as the sole active branch. Before deleting a branch, confirm its tip is unchanged from this inventory. If its history is not contained in main, preserve it as archive/2026-11-18/<branch>. Preserve existing release tags and assets. Do not merge stale test harnesses or untested dependency upgrades to remove branches.

Old build CI branches pin earlier app versions. Dependency branches contain untested upgrades. build11-5 and fix/mobile-ui-audit-apk contain divergent historical work; archive rather than replay against the tested app. research/engine-optimize contains optional performance tooling; preserve its history in an archive tag.

Scheduled Dependabot version updates can recreate branches. Disabling those updates is pending explicit cleanup approval. Branch deletion and archive creation are also pending approval after automatic review rejected the bulk workflow. No cleanup workflow was created.

## Branch tips before consolidation

| Branch | Commit |
| --- | --- |
| `build7-coloros` | `406fcb7fe2dc5100ce3a9b751f369f5a70dd7e3b` |
| `build7-fix` | `f6ffa47fda25db36de3f50ea96cb677168cc48c8` |
| `build8-prep` | `df7528322419c0827c50505fec0d1762cfced396` |
| `build9-coloros` | `7f1fcef729dcfe499f88dadfc43e5d67128e464d` |
| `build9-review-ci` | `988dd666e5f50c22790b093b9053cb7a56ca3e1e` |
| `build10-review-ci` | `590e2b1e8bf5cdb754901b046edc622e06d44607` |
| `build10` | `ad34cebbcc48f40ba78134eb46f1328eeae6ebd0` |
| `build11-2-ci` | `14f89611bd9a1eaec1a6c651480ac9ad49615f17` |
| `build11-2` | `fcaf12c64a6adc47918c16a175cd8e9906392462` |
| `build11-3-batch1` | `c389744e9b1239e0e61f4a8e2843bdb8fbceee57` |
| `build11-3-batch2` | `258c6db045d56f7ee1a5acc5799690e87e5fd26d` |
| `build11-3-diag` | `4696013ed6001fcef849f3b2f6717f800d33f5d5` |
| `build11-3-menufix` | `012c70f5fd2848c3b05771acb4a7b01c0b6af49b` |
| `build11-3-motion` | `5824211d08153b5bc99291409f509f3c72507a7f` |
| `build11-3-pop` | `d01c33b521fbeac3de1f504a6d62e944a28a3e70` |
| `build11-3-zoomfix` | `ecbee25306fa9d6cd338abaafd72e5deef780fcf` |
| `build11-3` | `960cd6199c1a3bfdf8c3aa6fdad49be28f5030d1` |
| `build11-4` | `b6575424bb317bc1f8d6ebddd4350b3649d7d7c4` |
| `build11-5` | `7ae73a17b700de10d45e738adb6ced91928819d0` |
| `build11-review-ci` | `ed3de711e234c42da7666d1bfc017fd05ef85ef3` |
| `build11` | `852b18e762fdd38eab2bcbbb19b9b773eff22648` |
| `build12-ci` | `c92db329ab45297e802a5be9c1acffccef9de743` |
| `build12` | `d296186b16508642fb751b00492a1aa9b0ecafa0` |
| `build13-ci` | `76ea0eca351d41b396e12fe37b7ff3d4030d7fe2` |
| `build13` | `62e3b39aa5700b5c9780efc1f30364e5e047ec6f` |
| `build14-ci` | `24fb80e1e196854c26eb2269516b1a90145552af` |
| `build14` | `0a961f54503bab008bd5f41cfca7282e814f4980` |
| `build15-ci` | `8a40dd30489535df82c2445e4b9b6f6068db24c9` |
| `build15` | `4b326320043add71723b28a48815ba897563a5c6` |
| `build15.1` | `5b601af6b809d42c8cd1454f74f7c2fbb038a0cc` |
| `build15.2` | `437afe7bb7fa1c5292c418f3f61a9cfb773259f7` |
| `build15.3` | `3131a963fc95559638413972d3a6f7a28e7520eb` |
| `build16-ci` | `380e0a8c9ba608ef41ba87ab86b461d1a31820f5` |
| `build16` | `2387ffb290eb6c31889d82bfaefd6b4338d11efe` |
| `build16.1` | `731a6866d6702e1f6df5ce213031a726aaac76b3` |
| `build17` | `0a0cd5f5747734ed50767fcd397ca85413499e6b` |
| `build151-ci` | `28e5432b9097f1ef7ca5ee1e67d6600600370c04` |
| `build153-ci` | `200cd87f633692a1cbd5a3ce1c1d0f6bcf02723b` |
| `build161-ci` | `4e0fd807347dff321ef732dfc0781a7c23f7ca93` |
| `codex/build17-continuation` | `bf5d64a92df6fc1243e55a935acb7f9a0a2602fb` |
| `council-frames` | `06e34fa2395b6adb2bf79cef95de97d94f42ccff` |
| `council-latency` | `90d2583b78859a7b94cc204a52dd0fdabd865cd0` |
| `council-motion` | `0d2e945d65ab0a0e288867f7f79a6436a87001df` |
| `dependabot/bun/compatible-updates-8e56e30b6b` | `dd40da0883b066841968322fa1e1dc6758ad3641` |
| `dependabot/bun/compatible-updates-58641d0907` | `212705e2e46ca01b8ef9de518278f648c4b5146a` |
| `dependabot/bun/compatible-updates-ea20923e58` | `c1e551b5756ec168c5420d5d00df38fe4224a651` |
| `dependabot/bun/kobalte/core-2.0.0-alpha.4` | `9dd533efa43c088121228abccfa409ea28e47fd9` |
| `dependabot/bun/solid-js-2.0.0-rc.19` | `b8015e621563a744c8221a696c4f58552b8d87a0` |
| `dependabot/bun/solidjs/signals-2.0.0-rc.19` | `1b1a433e4b6680eb3d555ad09d257505eac732df` |
| `dependabot/bun/solidjs/vite-plugin-3.0.0-next.52` | `ff80b7759e7f1b01b3821ce7fdd4fffdb49d4b28` |
| `dependabot/github_actions/actions/cache-6` | `c3465d7b1082e0c0d29c0fca97f9b15cb6ca4d02` |
| `dependabot/github_actions/actions/checkout-7` | `31c62f5c558977b57a917362c22719a27b5bfb57` |
| `dependabot/github_actions/actions/upload-artifact-7` | `5cbbf6a068524c1bb67cdd6ca18b49b877de8afe` |
| `engine-0.60` | `953d4d0c74daa4441b24e477e5f7b2224dd0da8f` |
| `engine-0.61` | `a70dc201a51aefbddadf9cbaabd38fc6d2ef6e18` |
| `engine-0.69` | `a1cbf4e353a4d69eb1e8f4eb4a9a8822f661fdd8` |
| `engine-0.70` | `14a4d30207c824f407fddf72505cadc583eef202` |
| `engine-0.71` | `6c99c2bfe60ad65e64b72042b3025af41ecd5df9` |
| `engine-0.72` | `66f8f91877381b5060218607cbaf7573001ba168` |
| `engine-patches-0.60` | `4990d5876172a03848929021e3925ef405a4fc79` |
| `fix/mobile-ui-audit-apk` | `9279514958bd8545c95a0a2475b6c6798c7817ed` |
| `hotfix-11-1` | `1352751e193ec350326bf8471a6eed1c45bb17ec` |
| `research/engine-optimize` | `12496876ab9efd0df7867c440a6ec9e58c037a67` |
