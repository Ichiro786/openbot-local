import { router } from "expo-router";
import { Typography } from "heroui-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Brain from "lucide-react-native/icons/brain";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import File from "lucide-react-native/icons/file";
import Globe from "lucide-react-native/icons/globe";
import Pencil from "lucide-react-native/icons/pencil";
import Sparkles from "lucide-react-native/icons/sparkles";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** Literal paths, so typed routes check them. */
const SUB_PAGES = {
  appearance: "/agent-info/[agentId]/appearance",
  profile: "/agent-info/[agentId]/profile",
  memories: "/agent-info/[agentId]/memories",
  skills: "/agent-info/[agentId]/skills",
  files: "/agent-info/[agentId]/files",
} as const;

function openSubPage(agent: MobileAgent, page: keyof typeof SUB_PAGES) {
  void haptics.impact("soft");
  router.push({ pathname: SUB_PAGES[page], params: { agentId: agent.id, serverId: agent.serverId } });
}

/**
 * Build 10 (ColorOS motion, Android): the top of the agent page, in the Manus Cue layout. A glass
 * Back, the agent's big avatar (Appearance), its name and title, Edit (the profile form, moved off
 * the page so the page is not a form), the agent's live browser (it left the chat header for the
 * header's •••), and three tiles for what the agent knows. The groups below stay the agent info's.
 */
export function AgentPageHero({
  agent,
  avatarSeed,
  avatarHue,
  available,
}: {
  agent: MobileAgent;
  avatarSeed: string;
  avatarHue: MobileAgent["avatarHue"];
  available: boolean;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const [foreground, muted, field] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-muted",
    "--openbot-bg-control",
  ]);
  const iconColor = String(foreground);
  const browserView = useMobileWorkspaceSelector((current) => current.browserViewSupport(agent.serverId).view);
  const browserShown = useBrowserFeature() && browserView && available;
  return (
    <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <ChatGlassIconButton
          accessibilityLabel={t("common.back")}
          fallbackBackground={String(field)}
          liquidGlassAvailable={false}
          onPress={() => {
            void haptics.impact("soft");
            router.back();
          }}
        >
          <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
        </ChatGlassIconButton>
      </View>
      <Pressable
        className="self-center"
        accessibilityRole="button"
        accessibilityLabel={t("mobile.agent.edit.appearance")}
        onPress={() => openSubPage(agent, "appearance")}
      >
        <BloubAvatarPreview agentId={agent.id} serverId={agent.serverId} seed={avatarSeed} hue={avatarHue} size={104} />
      </Pressable>
      <View style={styles.identity}>
        <Typography.Paragraph className="font-semibold" numberOfLines={2} style={styles.name}>
          {agent.name}
        </Typography.Paragraph>
        {agent.title.trim() ? (
          <Typography.Paragraph numberOfLines={2} style={[styles.title, { color: String(muted) }]}>
            {agent.title.trim()}
          </Typography.Paragraph>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.edit")}
          onPress={() => openSubPage(agent, "profile")}
          style={({ pressed }) => [styles.edit, { backgroundColor: String(field), opacity: pressed ? 0.6 : 1 }]}
        >
          <Pencil color={iconColor} size={14} strokeWidth={2} />
          <Typography.Paragraph className="font-semibold" style={styles.editLabel}>
            {t("common.edit")}
          </Typography.Paragraph>
        </Pressable>
      </View>
      {browserShown ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.browser.open")}
          onPress={() => {
            void haptics.impact("soft");
            router.push({ pathname: "/browser/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
          }}
          className="bg-grouped"
          style={({ pressed }) => [styles.browser, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={[styles.browserIcon, { backgroundColor: String(field) }]}>
            <Globe color={iconColor} size={26} strokeWidth={1.8} />
          </View>
          <Typography.Paragraph className="font-semibold flex-1" style={styles.browserLabel}>
            {t("mobile.browser.open")}
          </Typography.Paragraph>
          <ChevronRight color={String(muted)} size={18} strokeWidth={2} />
        </Pressable>
      ) : null}
      <View style={styles.tiles}>
        <Tile
          label={t("mobile.agent.info.memories.title")}
          icon={<Brain color={iconColor} size={22} strokeWidth={1.8} />}
          onPress={() => openSubPage(agent, "memories")}
        />
        <Tile
          label={t("mobile.agent.info.skills.title")}
          icon={<Sparkles color={iconColor} size={22} strokeWidth={1.8} />}
          onPress={() => openSubPage(agent, "skills")}
        />
        <Tile
          label={t("mobile.agent.info.files.title")}
          icon={<File color={iconColor} size={22} strokeWidth={1.8} />}
          onPress={() => openSubPage(agent, "files")}
        />
      </View>
    </View>
  );
}

function Tile({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="bg-grouped"
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
    >
      {icon}
      <Typography.Paragraph numberOfLines={1} style={styles.tileLabel}>
        {label}
      </Typography.Paragraph>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 20 },
  topBar: { flexDirection: "row", marginBottom: -8 },
  identity: { alignItems: "center", gap: 6 },
  name: { fontSize: 24, lineHeight: 30, textAlign: "center" },
  title: { fontSize: 14, lineHeight: 19, textAlign: "center" },
  edit: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderCurve: "continuous",
  },
  editLabel: { fontSize: 14 },
  browser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    borderCurve: "continuous",
  },
  browserIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  browserLabel: { fontSize: 16 },
  tiles: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 20,
    borderCurve: "continuous",
  },
  tileLabel: { fontSize: 13 },
});
