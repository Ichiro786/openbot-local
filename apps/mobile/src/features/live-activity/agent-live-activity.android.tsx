import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import { endLiveUpdate, isEngineSupported, showLiveUpdate } from "../../../modules/openbot-engine";
import type { AgentLiveActivityLoader, AgentLiveActivityNative } from "./agent-live-activity.types";
import type { LiveActivityInstance } from "./model/live-activity-sync";

/**
 * OpenBot Local: the Android side of the Live Activity. `useLiveActivity` keeps the upstream island
 * logic (the same coordinator and props as the iOS widget) and this turns each state into an Android
 * Live Update: a promoted ongoing ProgressStyle notification on Android 16 (realme UI / ColorOS show
 * it as a "Live Alert"), and an ongoing progress notification below. The native side is in
 * modules/openbot-engine (LiveUpdates.kt). Settings › Notifications › Live updates turns it off.
 *
 * Android has no push token for it and no widget extension, so the avatar calls draw nothing and the
 * notification shows the app icon.
 */
class AndroidLiveUpdate implements LiveActivityInstance<AgentLiveActivityProps> {
  readonly startedAt = Date.now();
  #active = true;

  constructor(props: AgentLiveActivityProps) {
    showLiveUpdate(props);
  }

  isActive(): boolean {
    return this.#active;
  }

  update(props: AgentLiveActivityProps): Promise<void> {
    if (!this.#active) return Promise.reject(new Error("The live update ended"));
    showLiveUpdate(props);
    return Promise.resolve();
  }

  end(): Promise<void> {
    this.#active = false;
    endLiveUpdate();
    return Promise.resolve();
  }

  watchPushToken(): () => void {
    return () => undefined;
  }
}

let current: AndroidLiveUpdate | null = null;

const androidLiveUpdates: AgentLiveActivityNative = {
  starter: {
    start(props) {
      current = new AndroidLiveUpdate(props);
      return current;
    },
    getInstances() {
      // A notification from an earlier process shows old state. It goes; the next state shows again.
      if (!current) endLiveUpdate();
      return current?.isActive() ? [current] : [];
    },
  },
  setSealKeys: () => undefined,
  saveAvatar: () => null,
  hasAvatar: () => false,
  renderBloub: async () => "",
  removeAvatars: () => undefined,
};

export const agentLiveActivity: AgentLiveActivityLoader = () => (isEngineSupported ? androidLiveUpdates : null);
