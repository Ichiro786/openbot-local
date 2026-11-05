import { type ConversationReaction, MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import SmilePlus from "lucide-react-native/icons/face-slightly-smiling-plus";
import Plus from "lucide-react-native/icons/plus";
import Reply from "lucide-react-native/icons/reply";
import Square from "lucide-react-native/icons/square";
import TextSelect from "lucide-react-native/icons/square-dashed-text";
import Volume2 from "lucide-react-native/icons/volume-2";
import { type PropsWithChildren, type RefObject, useMemo, useState } from "react";
import { type AccessibilityState, Alert, Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  ReduceMotion,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { toggleReadAloud, useReadingAloud } from "@/features/voice/model/message-reading";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { Button } from "@/shared/components/button";
import { haptics } from "@/shared/lib/haptics";
import { springs, timings } from "@/shared/lib/motion-tokens";
import { currentText, useText } from "@/shared/lib/text";
import { press as colorOSPress } from "@/shared/motion/tokens";
import { type MessageChannelTargets, openMessageActions } from "../model/message-actions-sheet";
import { useCopyMessage } from "./use-copy-message";
import { useHistoryShown } from "./use-history-shown";

// Copy → check: the check pops in on M3 Expressive fast spatial (a small overshoot), the copy glyph
// shrinks away under it on fast effects. The check leaves the same way, a little faster.
const CHECK_IN = ZoomIn.springify()
  .mass(springs.fastSpatial.mass)
  .stiffness(springs.fastSpatial.stiffness)
  .damping(springs.fastSpatial.damping)
  .reduceMotion(ReduceMotion.System);
const CHECK_OUT = ZoomOut.duration(120).reduceMotion(ReduceMotion.System);
const COPY_IN = FadeIn.duration(timings.fastEffects.duration).reduceMotion(ReduceMotion.System);
const COPY_OUT = ZoomOut.duration(timings.fastEffects.duration).reduceMotion(ReduceMotion.System);
const GLYPH_FILL = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  alignItems: "center",
  justifyContent: "center",
} as const;
const PICKER_IN = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const PICKER_OUT = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const ICON_SIZE = 18;
const PRESSED = { transform: [{ scale: 0.94 }] };
/** ColorOS motion: the 0.96 press of the spec, still static (no animated values per button). */
const COLOROS_PRESSED = { transform: [{ scale: colorOSPress.scale }] };

/**
 * A button of the row under a message, with the size and look of a small ghost HeroUI `Button`. It
 * is a plain pressable: each message in the chat has up to five of these, and each HeroUI button mounts an
 * animated pressable with about nine shared values and four animated styles, which made the chat
 * lag while it scrolled. The press shows at once, without an animation.
 */
function pressInTick() {
  void haptics.impact("light");
}

function ActionButton({
  accessibilityLabel,
  accessibilityState,
  onPress,
  selected = false,
  label = false,
  children,
}: PropsWithChildren<{
  accessibilityLabel: string;
  accessibilityState?: AccessibilityState;
  onPress: () => void;
  /** Drawn as a pressed HeroUI `secondary` button. */
  selected?: boolean;
  /** An emoji, not an icon: the button takes the width of its content. */
  label?: boolean;
}>) {
  // An icon draws only once the chat shows its history. The button keeps its size without it, so
  // the row does not move, and a chat that opens does not wait for the icons of every row.
  const historyShown = useHistoryShown();
  // One store read per button; the press stays a plain style swap plus a light tick on press-in.
  const colorOS = useMotionPreferences((s) => s.colorOSMotion);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      className={`h-10 items-center justify-center rounded-full active:bg-default-hover/30 ${label ? "px-2" : "w-10"} ${selected ? "bg-default" : ""}`}
      onPressIn={colorOS ? pressInTick : undefined}
      style={({ pressed }) => (pressed ? (colorOS ? COLOROS_PRESSED : PRESSED) : undefined)}
    >
      {historyShown || label ? children : null}
    </Pressable>
  );
}

/** Build 10: what the long-press menu of a message does through its action row. */
export type MessageActionsControl = {
  react: (emoji: string | null) => void;
  copy: () => void;
  /** The reader's reaction as the row shows it (the pending one included). */
  own: string | null;
};

/** Reads the message aloud with the reply voice from the settings. A second tap stops it. */
function ReadAloudButton({
  messageId,
  text,
  color,
  selectedColor,
}: {
  messageId: string;
  text: string;
  color: string;
  selectedColor: string;
}) {
  const { t } = useText();
  const reading = useReadingAloud(messageId);
  return (
    <ActionButton
      selected={reading}
      accessibilityLabel={reading ? t("mobile.chat.message.stopReading") : t("mobile.chat.message.readAloud")}
      accessibilityState={{ selected: reading }}
      onPress={() => {
        void haptics.selection();
        toggleReadAloud(messageId, text);
      }}
    >
      {reading ? <Square size={ICON_SIZE} color={selectedColor} /> : <Volume2 size={ICON_SIZE} color={color} />}
    </ActionButton>
  );
}

/**
 * The row under a message: its reactions, Copy, Read aloud, React, Reply, Select text and the time. A
 * phone has no hover, so the row always shows, and each action takes one tap.
 */
export function ChatMessageActions({
  align,
  copyText,
  createdAt,
  reactions,
  agentsById,
  onReact,
  onReply,
  onSelectText,
  selecting = false,
  readAloudId,
  longPressMenu = false,
  controlRef,
}: {
  align: "start" | "end";
  /** The text that Copy puts on the clipboard. Empty for a message of files only. */
  copyText: string;
  createdAt?: string;
  reactions?: readonly ConversationReaction[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => Promise<void>;
  onReply?: () => void;
  /** Starts the selection of the text in the bubble, or ends it while `selecting`. */
  onSelectText?: () => void;
  selecting?: boolean;
  /** The message that Read aloud reads. Unset where the app cannot read aloud. */
  readAloudId?: string;
  /**
   * Build 10 (ColorOS motion): the message's long-press menu carries React, Reply and Select text.
   * The row under the reader's own message shows only its reactions; under an agent message it
   * keeps Copy, Read aloud and the time.
   */
  longPressMenu?: boolean;
  /** Build 10: lets the long-press menu react and copy through this row (its pending reaction and check). */
  controlRef?: RefObject<MessageActionsControl | null>;
}) {
  const { t, format } = useText();
  const [mutedColor, foregroundColor] = useThemeColor(["muted", "foreground"]);
  const muted = String(mutedColor);
  const { copy, copied } = useCopyMessage(copyText);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreEmoji, setMoreEmoji] = useState(false);
  // The reader's reaction shows at once. The host sends the saved list after it, and that list wins.
  const [pending, setPending] = useState<{
    emoji: string | null;
    over: readonly ConversationReaction[] | undefined;
  } | null>(null);
  const shown =
    pending && pending.over === reactions
      ? [
          ...(pending.emoji ? [{ emoji: pending.emoji, actor: { kind: "user" as const } }] : []),
          ...(reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
        ]
      : (reactions ?? []);
  const own = shown.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;

  const react = (emoji: string | null) => {
    if (!onReact) return;
    setPickerOpen(false);
    setMoreEmoji(false);
    setPending({ emoji, over: reactions });
    void haptics.selection();
    onReact(emoji).catch((error: unknown) => {
      setPending(null);
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.message.reactionFailed"), t("mobile.chat.copyFailedMessage"));
    });
  };
  if (controlRef) controlRef.current = { react, copy: () => void copy(), own };
  const time = useMemo(
    () => (createdAt ? format.date(new Date(createdAt), { timeStyle: "short" }) : null),
    [createdAt, format],
  );

  // Build 10: under the reader's own message the long-press menu has every action, so the row
  // keeps only its space (and reactions, when there are any).
  if (longPressMenu && align === "end" && shown.length === 0) return <View className="pb-2" />;
  return (
    // The space under the row sets each message apart from the next one. Markers and activity rows
    // have no action row, so they keep the list's own smaller gap.
    <View className={`gap-1 pb-2 ${align === "end" ? "items-end self-end" : "items-start self-start"}`}>
      <View
        accessibilityRole="toolbar"
        accessibilityLabel={t("mobile.chat.message.actions")}
        className="flex-row items-center"
      >
        {shown.map((reaction) =>
          reaction.actor.kind === "user" && onReact ? (
            <ActionButton
              key="user"
              label
              accessibilityLabel={t("mobile.chat.message.removeReaction", { emoji: reaction.emoji })}
              onPress={() => react(null)}
            >
              <Typography>{reaction.emoji}</Typography>
            </ActionButton>
          ) : (
            <View
              key={reaction.actor.kind === "agent" ? `agent:${reaction.actor.agentId}` : "user"}
              accessible
              accessibilityRole="image"
              accessibilityLabel={
                reaction.actor.kind === "agent"
                  ? t("mobile.chat.message.agentReaction", {
                      name: agentsById.get(reaction.actor.agentId)?.name ?? "",
                      emoji: reaction.emoji,
                    })
                  : reaction.emoji
              }
              className="px-2"
            >
              <Typography>{reaction.emoji}</Typography>
            </View>
          ),
        )}
        {copyText && !(longPressMenu && align === "end") ? (
          <ActionButton
            accessibilityLabel={copied ? t("mobile.chat.message.copied") : t("mobile.chat.message.copy")}
            onPress={() => void copy()}
          >
            {/* Keyed by state, so Copy and the check trade places with layout animations. They run
                only on a copy, and the row keeps no shared values at rest. */}
            <LayoutAnimationConfig skipEntering skipExiting>
              <Animated.View
                key={copied ? "copied" : "copy"}
                entering={copied ? CHECK_IN : COPY_IN}
                exiting={copied ? CHECK_OUT : COPY_OUT}
                style={GLYPH_FILL}
              >
                {copied ? <Check size={ICON_SIZE} color={muted} /> : <Copy size={ICON_SIZE} color={muted} />}
              </Animated.View>
            </LayoutAnimationConfig>
          </ActionButton>
        ) : null}
        {readAloudId && copyText ? (
          <ReadAloudButton
            messageId={readAloudId}
            text={copyText}
            color={muted}
            selectedColor={String(foregroundColor)}
          />
        ) : null}
        {onReact && !longPressMenu ? (
          <ActionButton
            accessibilityLabel={t("mobile.chat.message.addReaction")}
            accessibilityState={{ expanded: pickerOpen }}
            onPress={() => {
              void haptics.selection();
              setPickerOpen((open) => !open);
              setMoreEmoji(false);
            }}
          >
            <SmilePlus size={ICON_SIZE} color={muted} />
          </ActionButton>
        ) : null}
        {onReply && !longPressMenu ? (
          <ActionButton
            accessibilityLabel={t("mobile.chat.message.reply")}
            onPress={() => {
              void haptics.selection();
              onReply();
            }}
          >
            <Reply size={ICON_SIZE} color={muted} />
          </ActionButton>
        ) : null}
        {onSelectText && !longPressMenu ? (
          <ActionButton
            // Drawn as pressed while the text is selected: a second tap ends the selection.
            selected={selecting}
            accessibilityLabel={t("mobile.chat.message.selectText")}
            accessibilityState={{ selected: selecting }}
            onPress={() => {
              void haptics.selection();
              onSelectText();
            }}
          >
            <TextSelect size={ICON_SIZE} color={selecting ? String(foregroundColor) : muted} />
          </ActionButton>
        ) : null}
        {time && !(longPressMenu && align === "end") ? (
          <Typography.Paragraph type="body-xs" className="px-1 text-muted">
            {time}
          </Typography.Paragraph>
        ) : null}
      </View>
      {pickerOpen && !longPressMenu ? (
        <Animated.View
          entering={PICKER_IN}
          exiting={PICKER_OUT}
          accessibilityLabel={t("mobile.chat.message.addReaction")}
          className="flex-row flex-wrap items-center rounded-3xl bg-control/60 px-1"
          style={{ borderCurve: "continuous" }}
        >
          {[...MESSAGE_REACTIONS, ...(moreEmoji ? MORE_MESSAGE_REACTIONS : [])].map((emoji) => (
            <Button
              key={emoji}
              isIconOnly
              variant={emoji === own ? "secondary" : "ghost"}
              accessibilityLabel={t("mobile.chat.message.react", { emoji })}
              accessibilityState={{ selected: emoji === own }}
              onPress={() => react(emoji === own ? null : emoji)}
            >
              <Typography className="text-xl">{emoji}</Typography>
            </Button>
          ))}
          {moreEmoji ? null : (
            <Button
              isIconOnly
              variant="ghost"
              accessibilityLabel={t("mobile.chat.message.moreEmoji")}
              onPress={() => {
                void haptics.selection();
                setMoreEmoji(true);
              }}
            >
              <Plus size={ICON_SIZE} color={muted} />
            </Button>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

// Upstream 0.60 (#4718): the message actions sheet, used when the ColorOS long-press menu is off.
/** A message that has actions: it is on the host and does not stream. */
export interface MessageActionsInput {
  messageId: string;
  /** The text that Copy puts on the clipboard. Empty for a message of files only. */
  copyText: string;
  createdAt?: string;
  reactions?: readonly ConversationReaction[];
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => Promise<void>;
  onReply?: () => void;
  /** Unset where the message has no branch: it is not the last answer of a finished turn. */
  onBranch?: () => void;
  onSelectText?: () => void;
  /** The message that Read aloud reads. Unset where the app cannot read aloud. */
  readAloudId?: string;
  /** The open channels that the message text can go to. Unset where the message cannot go to one. */
  sendToChannel?: MessageChannelTargets;
  /** Deletes the message for everyone. Unset where the reader cannot delete it. */
  onDelete?: () => Promise<void>;
}

/**
 * The reactions of a message, and the sheet with its actions. The reader's reaction shows at once;
 * the host sends the saved list after it, and that list wins. `open` is unset for a message
 * without actions.
 */
export function useMessageActions(input: MessageActionsInput | null) {
  const { t } = useText();
  const reactions = input?.reactions;
  const [pending, setPending] = useState<{
    emoji: string | null;
    over: readonly ConversationReaction[] | undefined;
  } | null>(null);
  const shown =
    pending && pending.over === reactions
      ? [
          ...(pending.emoji ? [{ emoji: pending.emoji, actor: { kind: "user" as const } }] : []),
          ...(reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
        ]
      : (reactions ?? []);
  const own = shown.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;
  const onReact = input?.onReact;
  const react = onReact
    ? (emoji: string | null) => {
        setPending({ emoji, over: reactions });
        onReact(emoji).catch((error: unknown) => {
          setPending(null);
          void haptics.notification("error");
          showFailureAlert(error, "turn", t("mobile.chat.message.reactionFailed"), t("mobile.chat.copyFailedMessage"));
        });
      }
    : undefined;
  const onDelete = input?.onDelete;
  // The sheet has closed when this runs, so the alert shows over the chat.
  const confirmDelete = onDelete
    ? () => {
        const text = currentText();
        Alert.alert(text.t("mobile.chat.message.deleteTitle"), text.t("mobile.chat.message.deleteBody"), [
          { text: text.t("common.cancel"), style: "cancel" },
          {
            text: text.t("common.delete"),
            style: "destructive",
            onPress: () =>
              onDelete().then(
                () => void haptics.notification("success"),
                (error: unknown) => {
                  void haptics.notification("error");
                  const title = currentText().t("mobile.chat.message.deleteFailed");
                  showFailureAlert(error, "team", title, currentText().errorMessage(error, title));
                },
              ),
          },
        ]);
      }
    : undefined;
  const open = input
    ? () =>
        openMessageActions({
          messageId: input.messageId,
          copyText: input.copyText,
          createdAt: input.createdAt,
          ownReaction: own,
          readAloudId: input.readAloudId,
          onReact: react,
          onReply: input.onReply,
          onBranch: input.onBranch,
          onSelectText: input.onSelectText,
          sendToChannel: input.sendToChannel,
          onDelete: confirmDelete,
        })
    : undefined;
  return { shown, react, open };
}

/**
 * The reactions of a message, in a pill on the bottom corner of its bubble toward the middle of the
 * chat, as on desktop: bottom left for the reader's own message, bottom right for an agent's. The
 * parent keeps room under the bubble for the part of the pill that hangs below it.
 */
export function ChatMessageReactions({
  align,
  reactions,
  agentsById,
  onReact,
}: {
  /** The side of the chat the bubble sits on. */
  align: "start" | "end";
  reactions: readonly ConversationReaction[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => void;
}) {
  const { t } = useText();
  return (
    <View
      className={`absolute -bottom-5 flex-row items-center rounded-full border-[3px] border-background bg-surface px-1 ${align === "end" ? "left-3" : "right-3"}`}
    >
      {reactions.map((reaction) =>
        reaction.actor.kind === "user" && onReact ? (
          <Pressable
            key="user"
            accessibilityRole="button"
            accessibilityLabel={t("mobile.chat.message.removeReaction", { emoji: reaction.emoji })}
            hitSlop={8}
            onPress={() => {
              void haptics.selection();
              onReact(null);
            }}
            className="h-7 items-center justify-center px-1"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
          >
            <Typography>{reaction.emoji}</Typography>
          </Pressable>
        ) : (
          <View
            key={reaction.actor.kind === "agent" ? `agent:${reaction.actor.agentId}` : "user"}
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              reaction.actor.kind === "agent"
                ? t("mobile.chat.message.agentReaction", {
                    name: agentsById.get(reaction.actor.agentId)?.name ?? "",
                    emoji: reaction.emoji,
                  })
                : reaction.emoji
            }
            className="h-7 justify-center px-1"
          >
            <Typography>{reaction.emoji}</Typography>
          </View>
        ),
      )}
    </View>
  );
}

/**
 * A touch and hold on the bubble opens the message actions. A screen reader cannot find that
 * gesture, so while one runs, each message gets this button under it.
 */
export function ChatMessageActionsButton({ align, onOpen }: { align: "start" | "end"; onOpen: () => void }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.message.actions")}
      onPress={onOpen}
      className={`size-10 items-center justify-center rounded-full ${align === "end" ? "self-end" : "self-start"}`}
    >
      <Ellipsis size={18} color={String(muted)} />
    </Pressable>
  );
}
