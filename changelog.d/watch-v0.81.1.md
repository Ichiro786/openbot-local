### Changed

- Engine: rebase the six local patches onto upstream 0.81.1. All six apply clean with no conflicts. Upstream adds no new capabilities, so protocol-9 stays exactly 256 and no trim is needed.
- App: import upstream 0.81.1 over v0.81.0 (30 files). The fork look stays: ColorOS toggle and frost, zoom open, predictive Back, Back handling, and avatars. Upstream changes are logic only: queue a phone agent's model change while the agent works, and show joined-server pictures in synced agents.
- App: upstream mobile version rises to 1.4.15, which adds the Apple Watch app and complications. The fork keeps its gauge and checkmark complication view.
- App: raise Android versionCode to 10438.
