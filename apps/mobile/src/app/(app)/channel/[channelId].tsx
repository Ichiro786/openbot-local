import { ChannelChatScreen } from "@/features/channels/screens/channel-chat-screen";
import { ChatShellSkeleton } from "@/features/chat/components/chat-open-skeleton";
import { withLiveZoom } from "@/shared/motion/LiveZoomScreen";

export default withLiveZoom(ChannelChatScreen, ChatShellSkeleton);
