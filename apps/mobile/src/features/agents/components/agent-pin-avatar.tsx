import { type PropsWithChildren, useEffect, useRef } from "react";
import { View, type ViewInstance } from "react-native";

import { type AgentAvatarLocation, useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { registerZoomAvatar } from "@/shared/motion/liveZoom";

interface AgentPinAvatarProps extends PropsWithChildren {
  agentId: string;
  location: AgentAvatarLocation;
  size: number;
}

export function AgentPinAvatar({ agentId, children, location, size }: AgentPinAvatarProps) {
  const ref = useRef<ViewInstance>(null);
  const { notifyAvatarLayout, registerAvatar, transition } = useAgentPinTransition();

  useEffect(() => {
    registerAvatar(agentId, location, ref.current);
    return () => registerAvatar(agentId, location, null);
  }, [agentId, location, registerAvatar]);

  useEffect(() => {
    if (location !== "pinned" && location !== "row") return;
    return registerZoomAvatar(agentId, (done) => {
      ref.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
    });
  }, [agentId, location]);

  const hidden = transition?.chatId === agentId && (transition.source === location || transition.target === location);

  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={() => notifyAvatarLayout(agentId, location)}
      style={{ height: size, opacity: hidden ? 0 : 1, width: size }}
    >
      {children}
    </View>
  );
}
