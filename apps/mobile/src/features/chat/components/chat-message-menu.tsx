import { MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "@openbot/contracts/ipc";
import Copy from "lucide-react-native/icons/copy";
import GitFork from "lucide-react-native/icons/git-fork";
import Reply from "lucide-react-native/icons/reply";
import TextSelect from "lucide-react-native/icons/square-dashed-text";
import { isAndroid } from "@/shared/lib/platform";
import { type GlassMenuItem, type GlassReactions, openGlassMenu, reactionFromMenuId } from "@/shared/motion/GlassMenu";

/** The bar's five quick reactions: the first five of the app's reaction set. */
export const QUICK_REACTIONS: readonly string[] = MESSAGE_REACTIONS.slice(0, 5);

/**
 * The emoji grid behind "+": the app's reaction set first, then common emoji. The host takes any
 * single RGI emoji as a reaction (`isMessageReaction` in @openbot/contracts), so every entry here is
 * one plain emoji (no skin tones, no sequences that a font might split).
 */
export const ALL_REACTIONS: readonly string[] = Array.from(
  new Set([
    ...MESSAGE_REACTIONS,
    ...MORE_MESSAGE_REACTIONS,
    "😀",
    "😁",
    "😅",
    "🤣",
    "😊",
    "😇",
    "🙂",
    "😉",
    "😍",
    "🥰",
    "😘",
    "😋",
    "😎",
    "🤩",
    "🥳",
    "😏",
    "😌",
    "😴",
    "🤯",
    "😱",
    "😢",
    "😭",
    "😤",
    "😡",
    "🤬",
    "🥺",
    "😬",
    "🙄",
    "🤗",
    "🤭",
    "🫡",
    "🤝",
    "👌",
    "✌️",
    "🤞",
    "💪",
    "🙌",
    "👋",
    "💀",
    "👻",
    "🤖",
    "👾",
    "🧠",
    "💡",
    "⭐",
    "✨",
    "⚡",
    "🌈",
    "☕",
    "🍕",
    "🎮",
    "🎯",
    "🏆",
    "📌",
    "📝",
    "💬",
    "❓",
    "❗",
    "⚠️",
    "❌",
    "💔",
    "💜",
    "💙",
    "💚",
    "🧡",
  ]),
);

export type MessageMenuLabels = {
  reply: string;
  copy: string;
  branch: string;
  selectText: string;
  react: (emoji: string) => string;
  moreEmoji: string;
};

/**
 * Build 10 (ColorOS motion, Android): the long-press menu of a chat message, in the in-window glass
 * menu host (no RN Modal, nothing in the row's tree). The reaction bar shows where the chat can save
 * a reaction. Every action runs after the menu has unmounted. Returns false when no host is mounted,
 * so the caller keeps its old long-press (Select text).
 */
export function openMessageMenu({
  x,
  y,
  title,
  icon,
  labels,
  own,
  onReply,
  onBranch,
  onCopy,
  onSelectText,
  onReact,
}: {
  /** The finger, in window coordinates. */
  x: number;
  y: number;
  /** The message's time, shown over the rows. */
  title?: string;
  /** The colour of the row icons. */
  icon: string;
  labels: MessageMenuLabels;
  own: string | null;
  onReply?: () => void;
  /** Upstream 0.60 "Branch from here": only on the last answer of a finished turn. */
  onBranch?: () => void;
  onCopy?: () => void;
  onSelectText?: () => void;
  onReact?: (emoji: string | null) => void;
}): boolean {
  if (!isAndroid) return false;
  const items: GlassMenuItem[] = [];
  if (onReply) items.push({ id: "reply", title: labels.reply, icon: <Reply size={18} color={icon} strokeWidth={2} /> });
  if (onBranch)
    items.push({ id: "branch", title: labels.branch, icon: <GitFork size={18} color={icon} strokeWidth={2} /> });
  if (onCopy) items.push({ id: "copy", title: labels.copy, icon: <Copy size={18} color={icon} strokeWidth={2} /> });
  if (onSelectText) {
    items.push({
      id: "select",
      title: labels.selectText,
      icon: <TextSelect size={18} color={icon} strokeWidth={2} />,
    });
  }
  if (items.length === 0 && !onReact) return false;
  const reactions: GlassReactions | undefined = onReact
    ? { quick: QUICK_REACTIONS, all: ALL_REACTIONS, own, reactLabel: labels.react, moreLabel: labels.moreEmoji }
    : undefined;
  const handlers: Record<string, (() => void) | undefined> = {
    reply: onReply,
    branch: onBranch,
    copy: onCopy,
    select: onSelectText,
  };
  const key = openGlassMenu({
    anchor: { x, y, width: 0, height: 0 },
    title: items.length > 0 ? title : undefined,
    items,
    reactions,
    dim: true,
    onSelect: (id) => {
      const emoji = reactionFromMenuId(id);
      if (emoji !== undefined) {
        onReact?.(emoji);
        return;
      }
      handlers[id]?.();
    },
    onClose: () => {},
  });
  return key !== null;
}
