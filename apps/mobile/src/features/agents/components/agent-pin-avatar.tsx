import { type PropsWithChildren, useEffect, useRef } from "react";
import { View, type ViewInstance } from "react-native";

import { registerZoomAvatar } from "@/shared/motion/liveZoom";

/**
 * OpenBot Local: the avatar that a closing chat morphs into (land-on-blob, PR #39/#41).
 * Upstream 1.4.14 removed the pin transition (agent-pin-transition, toggleAgentPinAnimated) and this
 * component's use of it, so this is now a sized view that registers the avatar's on-screen rect for
 * the close morph. A "chat" avatar (header) only sizes the view; "pinned" and "row" avatars register.
 */
type AgentAvatarLocation = "chat" | "pinned" | "row";

interface AgentPinAvatarProps extends PropsWithChildren {
  agentId: string;
  location: AgentAvatarLocation;
  size: number;
}

export function AgentPinAvatar({ agentId, children, location, size }: AgentPinAvatarProps) {
  const ref = useRef<ViewInstance>(null);

  useEffect(() => {
    if (location !== "pinned" && location !== "row") return;
    return registerZoomAvatar(agentId, (done) => {
      ref.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
    });
  }, [agentId, location]);

  return (
    <View ref={ref} collapsable={false} style={{ height: size, width: size }}>
      {children}
    </View>
  );
}
