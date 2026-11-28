import { rankAgentMentions } from "@openbot/contracts/agent-mention-rank";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { GlassView } from "expo-glass-effect";
import { router, useIsFocused } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Blocks from "lucide-react-native/icons/blocks";
import Camera from "lucide-react-native/icons/camera";
import Globe from "lucide-react-native/icons/globe";
import Images from "lucide-react-native/icons/images";
import Link from "lucide-react-native/icons/link";
import Paperclip from "lucide-react-native/icons/paperclip";
import Plus from "lucide-react-native/icons/plus";
import Reply from "lucide-react-native/icons/reply";
import Sparkles from "lucide-react-native/icons/sparkles";
import X from "lucide-react-native/icons/x";
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Keyboard,
  Text as NativeText,
  Pressable,
  ScrollView,
  TextInput,
  type TextInputInstance,
  useColorScheme,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  LayoutAnimationConfig,
  ReduceMotion,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import type { ChatBubbleMessage } from "@/features/chat/model/chat-messages";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { Button } from "@/shared/components/button";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import {
  COMPOSER_BAR_INSET,
  COMPOSER_FIELD_VERTICAL_PADDING,
  COMPOSER_TOOLBAR_HEIGHT,
  composerBottomGap,
  restingComposerHeight,
} from "@/shared/lib/composer-metrics";
import { useFontScale } from "@/shared/lib/font-scale";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference, useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";
import { END_X, fieldDirectionStyle, layoutDirection, MIRROR_IN_RTL, textDirection } from "@/shared/lib/text-direction";
import { ComposerFrost } from "@/shared/motion/ComposerFrost";
import { glassMenuHostBox, openGlassMenu, useGlassMenuPauses } from "@/shared/motion/GlassMenu";
import { menu as menuTokens } from "@/shared/motion/tokens";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { editMentionDraft, insertMention, mentionDraft, mentionQuery } from "../model/chat-mentions";
import {
  composerField,
  composerFieldParts,
  shownComposerField,
  syncComposerField,
  typedComposerField,
} from "../model/composer-field";
import { applyMarkdownListEdit, markdownListReturn } from "../model/composer-lists";
import { largePastedText } from "../model/composer-paste";
import { createComposerSendGate } from "../model/composer-send";
import { composerAction } from "../model/voice-dictation";
import type { VoicePalette } from "../model/voice-palette";
import { attachmentTypeLabel, shareLocalAttachment, showFileFailure } from "./attachment-preview";
import { AttachmentPreviewSheet } from "./attachment-preview-sheet";
import { ComposerAttachmentTile, localPreviewUri } from "./composer-attachment-tile";
import type { ComposerContextMeter } from "./composer-context-ring";
import { DictationMic, DictationStrip } from "./composer-dictation";
import {
  addPastedFiles,
  type ComposerPasteHandle,
  ComposerPasteTarget,
  type PastedFiles,
} from "./composer-paste-target";
import { ComposerSendControl } from "./composer-send-control";
import type { ComposerVoice } from "./composer-voice";
import type { ChatAttachments } from "./use-chat-attachments";
import type { ComposerDictation } from "./use-composer-dictation";
import { VoiceCallBar } from "./voice-call-bar";

const PLUS_CLOSE_SPRING = { duration: 220, dampingRatio: 1 };
const REPLY_SPRING = { stiffness: 260, damping: 32, mass: 1, reduceMotion: ReduceMotion.System };
const REPLY_OUT_EASING = Easing.in(Easing.cubic);
const MAX_INPUT_LINES = 5;
const ROW_CONTROL_INSET = 48;
const FIELD_INSET = 16;
const BAR_INSET = COMPOSER_BAR_INSET;
const TOOLBAR_HEIGHT = COMPOSER_TOOLBAR_HEIGHT;
const FIELD_VERTICAL_PADDING = COMPOSER_FIELD_VERTICAL_PADDING;
const ATTACHMENT_BLOCK_HEIGHT = 120;
const SHAPE_DURATION = 120;
const EXPAND_DURATION = 180;
const CONTROL_SIZE = 40;
const TOOLBAR_PADDING = 8;
const CONTROL_GAP = 4;
const REST_TEXT_GAP = 10;
const REST_CONTROL_SCALE = 0.8;

const VOICE_BUTTON_SIZE = 64;
const CARD_RADIUS = 24;

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);
const SHAPE_EASING_FN = Easing.bezier(0.23, 1, 0.32, 1);
const PLACEHOLDER_DURATION = 200;
const PLACEHOLDER_EASING_FN = Easing.bezier(0.77, 0, 0.175, 1);
const PLACEHOLDER_IN = FadeIn.duration(PLACEHOLDER_DURATION).easing(SHAPE_EASING_FN).reduceMotion(ReduceMotion.System);
const PLACEHOLDER_OUT = FadeOut.duration(PLACEHOLDER_DURATION)
  .easing(SHAPE_EASING_FN)
  .reduceMotion(ReduceMotion.System);

interface ChatComposerProps {
  sendLabel?: string;
  action: ViewStyle["backgroundColor"];
  actionForeground: ViewStyle["backgroundColor"];
  agentName: string;
  placeholder?: string;
  mentionAgents: MobileAgent[];
  mentionSkills?: readonly MentionSkill[];
  mentionReferences?: readonly MentionReference[];
  skillPickerVersion?: number;
  onSuggestionsVisibleChange?: (visible: boolean) => void;
  bottomInset: number;
  disabled: boolean;
  draft: string;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  muted: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  onChangeDraft: (value: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  keyboardProgress: SharedValue<number>;
  keyboardHeight?: SharedValue<number>;
  frostTarget?: RefObject<ViewInstance | null>;
  onInputFocus?: () => void;
  menuOpen?: boolean;
  menuProgress?: SharedValue<number>;
  /** Build 11: "Use skill or app" in the ColorOS + menu (present when the agent has skills). */
  onUseSkill?: () => void;
  stopping?: boolean;
  attachments?: ChatAttachments;
  sendRetryVersion: number;
  replyTarget: ChatBubbleMessage | null;
  replyFocusVersion: number;
  focusVersion?: number;
  handoffFocusVersion?: number;
  onCancelReply: () => void;
  voice?: ComposerVoice;
  dictation?: ComposerDictation;
  voiceAccent?: { fill: string; glyph: string; tint: string; lightGlyph?: boolean };
  voiceAvatar?: ReactNode;
  voicePalette?: VoicePalette;
  contextMeter?: ComposerContextMeter;
  keepsKeyboardOnSend?: boolean;
  heightLive?: SharedValue<number>;
  heightTarget?: SharedValue<number>;
}

const NO_FILES: ChatAttachments["items"] = [];
const NO_SKILLS: readonly MentionSkill[] = [];
const NO_REFERENCES: readonly MentionReference[] = [];

export interface MentionSkill {
  kind: "skill" | "mcp";
  id: string;
  name: string;
  description: string;
}

export interface MentionReference {
  kind: "tab" | "thread";
  id: string;
  name: string;
  detail: string;
  search: string;
}

const TAG_GROUPS = [
  { kind: "tab", title: "mobile.chat.composer.browserTabs", label: "mobile.chat.composer.browserTab", Icon: Globe },
  { kind: "thread", title: "mobile.chat.composer.threads", label: "mobile.chat.composer.thread", Icon: Link },
  { kind: "skill", title: "mobile.chat.composer.skills", label: "mobile.chat.composer.useSkill", Icon: Sparkles },
  { kind: "mcp", title: "mobile.chat.composer.apps", label: "mobile.chat.composer.useApp", Icon: Blocks },
] as const;

const FOCUS_RETRY_MS = 1500;
const FOCUS_RETRY_INTERVAL_MS = 100;

export const ChatComposer = memo(function ChatComposer({
  sendLabel,
  action,
  actionForeground,
  agentName,
  placeholder,
  mentionAgents,
  mentionSkills = NO_SKILLS,
  mentionReferences = NO_REFERENCES,
  skillPickerVersion = 0,
  onSuggestionsVisibleChange,
  bottomInset,
  disabled,
  draft,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  muted,
  raised,
  onChangeDraft,
  onSend,
  onStop,
  keyboardProgress,
  keyboardHeight,
  frostTarget,
  onInputFocus,
  menuOpen = false,
  menuProgress,
  onUseSkill,
  stopping = false,
  attachments,
  sendRetryVersion,
  replyTarget,
  replyFocusVersion,
  focusVersion = 0,
  handoffFocusVersion = 0,
  onCancelReply,
  voice,
  dictation,
  voiceAccent,
  voiceAvatar,
  voicePalette,
  contextMeter,
  keepsKeyboardOnSend = false,
  heightLive,
  heightTarget,
}: ChatComposerProps) {
  const { t, format, sourceText } = useText();
  const still = useSharedValue(0);
  const menuMotion = menuProgress ?? still;
  const morph = voice?.presence ?? still;
  const files = attachments?.items ?? NO_FILES;
  const preparing = attachments?.preparing ?? false;
  const display = mentionDraft(draft);
  const displayText = display.text;
  const [cursor, setCursor] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewItem = files.find((item) => item.id === previewId) ?? null;
  const query = mentionQuery(draft, cursor);
  const [skillsOnly, setSkillsOnly] = useState(false);
  const hasQuery = query !== null;
  useEffect(() => {
    if (!hasQuery) setSkillsOnly(false);
  }, [hasQuery]);
  const skillSuggestions = query
    ? mentionSkills
        .filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.query.trim()))
        .slice(0, 8)
    : [];
  const suggestions = query && !skillsOnly ? rankAgentMentions(mentionAgents, query.query).slice(0, 8) : [];
  const referenceSuggestions =
    query && !skillsOnly
      ? mentionReferences
          .filter((reference) =>
            `${reference.name} ${reference.search}`.toLocaleLowerCase().includes(query.query.trim()),
          )
          .slice(0, 8)
      : [];
  const tagSuggestions = [...referenceSuggestions, ...skillSuggestions];
  const hasDraft = Boolean(draft.trim()) || files.length > 0;
  const inputRef = useRef<TextInputInstance>(null);
  const isFocused = useIsFocused();
  const latestTextRef = useRef(draft);
  const [sendGate] = useState(createComposerSendGate);
  const pasteRef = useRef<ComposerPasteHandle>(null);
  const composingSent = useRef(false);
  const voiceOpen = voice?.open ?? false;
  const colorOSFrost = useColorOSMotion().enabled;
  const frosted = isAndroid && ANDROID_BLUR && !liquidGlassAvailable && colorOSFrost && frostTarget !== undefined;
  const frostMenu = useGlassMenuPauses("composer");
  const dictating = dictation?.active ?? false;
  const dictationBusy = dictation?.busy ?? false;
  const dictationPresence = dictation?.presence ?? still;
  const dictationMic = Boolean(dictation?.available);
  const micSlack = dictationMic ? (CONTROL_SIZE + CONTROL_GAP) / 2 : 0;
  const focusedReplyVersion = useRef(0);
  useEffect(() => {
    if (isFocused && !disabled && replyTarget && focusedReplyVersion.current !== replyFocusVersion) {
      focusedReplyVersion.current = replyFocusVersion;
      inputRef.current?.focus();
    }
  }, [isFocused, disabled, replyTarget, replyFocusVersion]);
  const focusedVersion = useRef(focusVersion);
  useEffect(() => {
    if (isFocused && !disabled && focusedVersion.current !== focusVersion) {
      focusedVersion.current = focusVersion;
      inputRef.current?.focus();
    }
  }, [isFocused, disabled, focusVersion]);
  const focusedHandoffVersion = useRef(handoffFocusVersion);
  useEffect(() => {
    if (!isFocused || disabled || focusedHandoffVersion.current === handoffFocusVersion) return;
    focusedHandoffVersion.current = handoffFocusVersion;
    inputRef.current?.focus();
    const started = Date.now();
    const retry = setInterval(() => {
      const input = inputRef.current;
      if (!input || Date.now() - started > FOCUS_RETRY_MS) clearInterval(retry);
      else if (!input.isFocused()) input.focus();
    }, FOCUS_RETRY_INTERVAL_MS);
    return () => clearInterval(retry);
  }, [isFocused, disabled, handoffFocusVersion]);
  const keyboardFieldUsable = useRef(false);
  keyboardFieldUsable.current = !disabled && !voiceOpen && !dictationBusy;
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  useEffect(() => {
    if (!isIOS) return;
    let keyboardShown = Keyboard.isVisible();
    const willShow = Keyboard.addListener("keyboardWillShow", () => {
      keyboardShown = true;
    });
    const didHide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardShown = false;
    });
    let opened = false;
    const stopListening = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing || opened) return;
      opened = true;
      const input = inputRef.current;
      if (keyboardShown || !keyboardFieldUsable.current || !input?.isFocused()) return;
      input.blur();
      input.focus();
    });
    return () => {
      willShow.remove();
      didHide.remove();
      stopListening();
    };
  }, [navigation]);
  const pasteFiles = (pasted: PastedFiles) =>
    addPastedFiles(sendingDictationRef.current ? undefined : attachments, pasted);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCursor.current === null) return;
    const position = Math.min(pendingCursor.current, displayText.length);
    pendingCursor.current = null;
    inputRef.current?.setNativeProps({ selection: { start: position, end: position } });
  }, [displayText]);
  const pickedSkillVersion = useRef(skillPickerVersion);
  useEffect(() => {
    if (pickedSkillVersion.current === skillPickerVersion) return;
    pickedSkillVersion.current = skillPickerVersion;
    const source = latestTextRef.current;
    const next = source && !/\s$/u.test(source) ? `${source} @` : `${source}@`;
    latestTextRef.current = next;
    onChangeDraft(next);
    const position = mentionDraft(next).text.length;
    setCursor(position);
    pendingCursor.current = position;
    setSkillsOnly(true);
    inputRef.current?.focus();
  }, [skillPickerVersion, onChangeDraft]);
  const fontScale = useFontScale();
  const fieldDirection = fieldDirectionStyle(displayText);
  const fieldLook = `${fieldDirection?.writingDirection ?? ""}|${String(foreground)}|${fontScale}`;
  const tagged = display.mentions.length > 0;
  const [field, setField] = useState(() => composerField(displayText, fieldLook, tagged));
  const syncedField = syncComposerField(field, displayText, fieldLook, tagged);
  if (syncedField !== field) setField(syncedField);
  const [fieldHead, fieldTail] = tagged
    ? [displayText.slice(display.mentions.at(-1)?.end ?? 0), ""]
    : composerFieldParts(syncedField);
  const fieldClears = syncedField.clears;
  useLayoutEffect(() => {
    if (fieldClears) inputRef.current?.clear();
  }, [fieldClears]);
  const fieldBlank = syncedField.blank;
  useLayoutEffect(() => {
    if (fieldBlank) setField(shownComposerField);
  }, [fieldBlank]);
  const insets = useSafeAreaInsets();
  const barWidth = useColumnWidth() - insets.left - insets.right;
  const lineHeight = 22 * fontScale;
  const leadingInset = attachments ? ROW_CONTROL_INSET : FIELD_INSET;
  const trailingInset = ROW_CONTROL_INSET + (dictationMic ? CONTROL_SIZE + CONTROL_GAP : 0);
  const rowTextWidth = barWidth - BAR_INSET * 2 - trailingInset - leadingInset;
  const [wrap, setWrap] = useState({ lines: 1, width: 0 });
  if (!displayText && (wrap.lines > 1 || wrap.width > rowTextWidth)) setWrap({ lines: 1, width: 0 });
  const stacked = dictating || wrap.lines > 1 || wrap.width > rowTextWidth;
  const fieldHeight = Math.max(
    TOOLBAR_HEIGHT,
    Math.min(MAX_INPUT_LINES, wrap.lines) * lineHeight + FIELD_VERTICAL_PADDING,
  );
  const attachmentsOpen = files.length > 0;
  const reducedMotion = useReducedMotion();
  const shapeDuration = reducedMotion ? 0 : SHAPE_DURATION;
  const resizes = useMotionPreference("composerResize");

  const [placeholderWidth, setPlaceholderWidth] = useState(0);
  const placeholderText = dictating
    ? t("mobile.chat.voice.listening")
    : (placeholder ?? t("mobile.chat.composer.ask", { name: agentName }));
  const cardWidth = barWidth - BAR_INSET * 2;
  const restHeight = restingComposerHeight(fontScale);
  const restControlOffset = (TOOLBAR_HEIGHT - restHeight) / 2;
  const restControlShift = TOOLBAR_PADDING + (CONTROL_SIZE - restHeight) / 2;
  const restControlDrawn = CONTROL_SIZE * REST_CONTROL_SCALE;
  const restTextInset = (restHeight - restControlDrawn) / 2 + restControlDrawn + REST_TEXT_GAP;
  const restLeadingInset = attachments ? restTextInset : FIELD_INSET;
  const restTrailingInset = restTextInset + (dictationMic ? (CONTROL_SIZE + CONTROL_GAP) * REST_CONTROL_SCALE : 0);
  const restWidth =
    placeholderWidth > 0 ? Math.min(cardWidth, placeholderWidth + restLeadingInset + restTrailingInset) : cardWidth;
  const restWidthValue = useSharedValue(restWidth);
  const restWidthMeasured = useRef(false);
  useLayoutEffect(() => {
    if (!restWidthMeasured.current) {
      restWidthValue.set(restWidth);
      restWidthMeasured.current = placeholderWidth > 0;
      return;
    }
    restWidthValue.set(
      withTiming(restWidth, {
        duration: reducedMotion ? 0 : PLACEHOLDER_DURATION,
        easing: PLACEHOLDER_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [restWidth, placeholderWidth, restWidthValue, reducedMotion]);
  const [openedWith, setOpenedWith] = useState<{ expanded: boolean; focused: boolean } | null>(null);
  useEffect(() => {
    if (!menuOpen) setOpenedWith(null);
  }, [menuOpen]);
  useEffect(() => {
    if (menuOpen && openedWith?.focused) inputRef.current?.focus();
  }, [menuOpen, openedWith]);
  const anchored = hasDraft || Boolean(openedWith?.expanded) || dictating;
  const held = useSharedValue(anchored ? 1 : 0);
  useEffect(() => {
    held.set(
      withTiming(anchored ? 1 : 0, {
        duration: reducedMotion ? 0 : SHAPE_DURATION,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [anchored, held, reducedMotion]);
  const [shownReply, setShownReply] = useState(replyTarget);
  if (replyTarget && replyTarget !== shownReply) setShownReply(replyTarget);
  const replyActive = replyTarget !== null;
  const replyPresence = useSharedValue(replyActive ? 1 : 0);
  const replyRowHeight = useSharedValue(0);
  const replyHold = useSharedValue(replyActive ? 1 : 0);
  const replyHoldTarget = useSharedValue(replyActive ? 1 : 0);
  useLayoutEffect(() => {
    const timing = { duration: shapeDuration, easing: SHAPE_EASING_FN, reduceMotion: ReduceMotion.System };
    replyPresence.set(
      replyActive
        ? reducedMotion
          ? 1
          : withSpring(1, REPLY_SPRING)
        : withTiming(
            0,
            { duration: shapeDuration, easing: REPLY_OUT_EASING, reduceMotion: ReduceMotion.System },
            (finished) => {
              if (finished && !replyActive) scheduleOnRN(setShownReply, null);
            },
          ),
    );
    replyHoldTarget.set(replyActive ? 1 : 0);
    replyHold.set(replyActive ? (reducedMotion ? 1 : withSpring(1, REPLY_SPRING)) : withTiming(0, timing));
  }, [replyActive, replyPresence, replyHold, replyHoldTarget, shapeDuration, reducedMotion]);
  const keyboardExpansion = useSharedValue(0);
  const keyboardExpansionTarget = useSharedValue(0);
  useAnimatedReaction(
    () => keyboardProgress.get(),
    (progress, previous) => {
      if (!isAndroid || !resizes) {
        keyboardExpansion.set(Math.min(1, Math.max(0, progress)));
        return;
      }
      const target =
        progress <= 0.01
          ? 0
          : progress >= 0.99
            ? 1
            : previous === null
              ? progress > 0.5
                ? 1
                : 0
              : progress > previous
                ? 1
                : progress < previous
                  ? 0
                  : -1;
      if (target < 0 || target === keyboardExpansionTarget.get()) return;
      keyboardExpansionTarget.set(target);
      if (reducedMotion) {
        keyboardExpansion.set(target);
        return;
      }
      keyboardExpansion.set(
        withTiming(target, {
          duration: EXPAND_DURATION,
          easing: SHAPE_EASING_FN,
          reduceMotion: ReduceMotion.System,
        }),
      );
    },
    [resizes, reducedMotion],
  );
  const expansion = useDerivedValue(() =>
    resizes ? Math.max(keyboardExpansion.get(), held.get(), replyHold.get()) : 1,
  );
  const replyStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, Math.min(replyPresence.get(), expansion.get())));
    return {
      height: replyRowHeight.get() * progress,
      opacity: progress,
      transform: [{ translateY: (1 - progress) * 8 }],
    };
  });
  const cardStyle = useAnimatedStyle(() => {
    const voiced = morph.get();
    const width = interpolate(expansion.get(), [0, 1], [restWidthValue.get(), cardWidth]);
    return {
      width: width + (cardWidth - width) * voiced,
      borderRadius: CARD_RADIUS + (VOICE_BUTTON_SIZE / 2 - CARD_RADIUS) * voiced,
    };
  });
  const controlStyle = useAnimatedStyle(() => {
    const progress = expansion.get();
    const x = interpolate(progress, [0, 1], [restControlShift, 0]);
    const y = interpolate(progress, [0, 1], [restControlOffset, 0]);
    const scale = interpolate(progress, [0, 1], [REST_CONTROL_SCALE, 1]);
    return {
      transform: [{ translateX: END_X * (x + micSlack * (1 - scale)) }, { translateY: y }, { scale }],
      opacity: interpolate(morph.get(), [0, 0.4], [1, 0], Extrapolation.CLAMP),
    };
  });
  const dictationMicStyle = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0, 0.3], [1, 0], Extrapolation.CLAMP),
  }));
  const plusStyle = useAnimatedStyle(() => {
    const progress = expansion.get();
    const voiced = morph.get();
    const openWidth = interpolate(progress, [0, 1], [restWidthValue.get(), cardWidth]);
    const width = openWidth + (cardWidth - openWidth) * voiced;
    return {
      opacity: interpolate(voiced, [0, 0.3], [1, 0], Extrapolation.CLAMP) * (1 - dictationPresence.get()),
      transform: [
        { translateX: END_X * ((cardWidth - width) / 2 - interpolate(progress, [0, 1], [restControlShift, 0])) },
        { translateY: interpolate(progress, [0, 1], [restControlOffset, 0]) },
        { scale: interpolate(progress, [0, 1], [REST_CONTROL_SCALE, 1]) },
      ],
    };
  });
  const stackedValue = useSharedValue(stacked ? 1 : 0);
  useEffect(() => {
    stackedValue.set(
      withTiming(stacked ? 1 : 0, {
        duration: reducedMotion ? 0 : SHAPE_DURATION,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [stacked, stackedValue, reducedMotion]);
  const fieldHeightValue = useSharedValue(fieldHeight);
  useEffect(() => {
    fieldHeightValue.set(
      withTiming(fieldHeight, {
        duration: shapeDuration,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [fieldHeight, fieldHeightValue, shapeDuration]);
  const fieldBoxStyle = useAnimatedStyle(() => {
    const voiced = morph.get();
    const height = interpolate(expansion.get(), [0, 1], [restHeight, fieldHeightValue.get()]);
    return {
      opacity: interpolate(voiced, [0, 0.4], [1, 0], Extrapolation.CLAMP),
      height: height + (VOICE_BUTTON_SIZE - height) * voiced,
      marginBottom: interpolate(stackedValue.get(), [0, 1], [0, TOOLBAR_HEIGHT]) * (1 - voiced),
    };
  });
  const attachmentHeight = useSharedValue(attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0);
  useEffect(() => {
    attachmentHeight.set(
      withTiming(attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0, {
        duration: shapeDuration,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [attachmentsOpen, attachmentHeight, shapeDuration]);
  const attachmentStyle = useAnimatedStyle(() => ({ height: attachmentHeight.get() }));
  const openTextOffset = leadingInset - FIELD_INSET;
  const restTextOffset = placeholderWidth > 0 ? restLeadingInset - FIELD_INSET : openTextOffset;
  const fieldOpenOffset =
    textDirection(displayText, layoutDirection()) === layoutDirection() ? openTextOffset : FIELD_INSET - trailingInset;
  const fieldSlideStyle = useAnimatedStyle(() => ({
    height: fieldHeightValue.get(),
    transform: [
      {
        translateX:
          END_X *
          interpolate(
            expansion.get(),
            [0, 1],
            [restTextOffset, interpolate(stackedValue.get(), [0, 1], [fieldOpenOffset, 0])],
          ),
      },
    ],
  }));
  const placeholderStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          END_X *
          interpolate(
            expansion.get(),
            [0, 1],
            [restTextOffset, interpolate(stackedValue.get(), [0, 1], [openTextOffset, 0])],
          ),
      },
    ],
  }));
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    if (files.length > 0) sendGate.edit();
  }, [files, sendGate]);

  useLayoutEffect(() => {
    if (keepsKeyboardOnSend && draft) sendGate.edit();
  }, [keepsKeyboardOnSend, draft, sendGate]);

  useLayoutEffect(() => {
    if (sendRetryVersion > 0) sendGate.allowRetry();
  }, [sendGate, sendRetryVersion]);

  useEffect(() => {
    latestTextRef.current = draft;
  }, [draft]);

  useLayoutEffect(() => {
    if (!composingSent.current) return;
    composingSent.current = false;
    const field = pasteRef.current;
    if (draft || !field?.resetComposing) return;
    sendGate.holdFieldText();
    field.resetComposing().then(
      (cleared) => {
        if (!cleared) sendGate.releaseFieldText();
      },
      () => sendGate.releaseFieldText(),
    );
  }, [draft, sendGate]);

  useEffect(() => {
    if (disabled) inputRef.current?.blur();
  }, [disabled]);

  const suggestionCount = suggestions.length + tagSuggestions.length;
  const suggestionsVisible = Boolean((focused || isAndroid) && query && suggestionCount > 0 && !disabled);
  useEffect(() => {
    onSuggestionsVisibleChange?.(suggestionsVisible);
  }, [onSuggestionsVisibleChange, suggestionsVisible]);
  const [suggestionsHeight, setSuggestionsHeight] = useState(0);
  const suggestionsShown = Boolean(suggestionsVisible && query);
  const chromeHeight = (suggestionsShown ? suggestionsHeight : 0) + 8 + composerBottomGap(bottomInset);
  const replyMounted = shownReply !== null && !voiceOpen;
  const heightTargets = useSharedValue({
    chrome: chromeHeight,
    field: fieldHeight,
    stacked: stacked ? 1 : 0,
    attachments: attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0,
    reply: replyActive ? 1 : 0,
    replyMounted: replyMounted ? 1 : 0,
    held: anchored ? 1 : 0,
    voice: voiceOpen ? 1 : 0,
  });
  useEffect(() => {
    heightTargets.set({
      chrome: chromeHeight,
      field: fieldHeight,
      stacked: stacked ? 1 : 0,
      attachments: attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0,
      reply: replyActive ? 1 : 0,
      replyMounted: replyMounted ? 1 : 0,
      held: anchored ? 1 : 0,
      voice: voiceOpen ? 1 : 0,
    });
  }, [
    heightTargets,
    chromeHeight,
    fieldHeight,
    stacked,
    attachmentsOpen,
    replyActive,
    replyMounted,
    anchored,
    voiceOpen,
  ]);
  useAnimatedReaction(
    () => {
      const goal = heightTargets.get();
      const fieldBox = (expanded: number, field: number, stack: number, voiced: number) => {
        const height = interpolate(expanded, [0, 1], [restHeight, field]);
        return (
          height +
          (VOICE_BUTTON_SIZE - height) * voiced +
          interpolate(stack, [0, 1], [0, TOOLBAR_HEIGHT]) * (1 - voiced)
        );
      };
      const liveExpansion = expansion.get();
      const liveReply = Math.min(1, Math.max(0, Math.min(replyPresence.get(), liveExpansion)));
      const live =
        goal.chrome +
        replyRowHeight.get() * liveReply * goal.replyMounted +
        attachmentHeight.get() +
        fieldBox(liveExpansion, fieldHeightValue.get(), stackedValue.get(), morph.get());
      const keyboardGoal =
        isAndroid && resizes ? keyboardExpansionTarget.get() : Math.min(1, Math.max(0, keyboardProgress.get()));
      const goalExpansion = resizes ? Math.max(keyboardGoal, goal.held, replyHoldTarget.get()) : 1;
      const target =
        goal.chrome +
        replyRowHeight.get() * Math.min(1, goalExpansion) * goal.reply * (1 - goal.voice) +
        goal.attachments +
        fieldBox(goalExpansion, goal.field, goal.stacked, goal.voice);
      return { live, target };
    },
    ({ live, target }) => {
      heightLive?.set(live);
      heightTarget?.set(target);
    },
  );
  const announcedSuggestions = useRef("");
  useEffect(() => {
    const announcement = suggestionsVisible ? `${suggestionCount}:${query?.query ?? ""}` : "";
    if (announcedSuggestions.current === announcement) return;
    announcedSuggestions.current = announcement;
    if (!suggestionsVisible) return;
    AccessibilityInfo.announceForAccessibility(
      suggestionCount === 1 ? "1 teammate suggestion" : `${suggestionCount} teammate suggestions`,
    );
  }, [suggestionsVisible, suggestionCount, query?.query]);

  const [sendingDictation, setSendingDictation] = useState(false);
  const sendingDictationRef = useRef(false);
  const busy = preparing || sendingDictation;
  const attachmentsBlocked = disabled || preparing || sendingDictation;
  const leadingBlocked = attachmentsBlocked;
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusTurn = useSharedValue(0);
  useEffect(() => {
    plusTurn.set(
      reducedMotion
        ? plusMenuOpen
          ? 1
          : 0
        : withSpring(plusMenuOpen ? 1 : 0, plusMenuOpen ? menuTokens.openSpring : PLUS_CLOSE_SPRING),
    );
  }, [plusMenuOpen, plusTurn, reducedMotion]);
  const [warningColor, dangerColor] = useCSSVariable(["--openbot-warning", "--openbot-danger"]);
  const contextAlert =
    contextMeter && !contextMeter.compacting && (contextMeter.level === "warning" || contextMeter.level === "danger")
      ? contextMeter
      : undefined;
  const plusGlyphStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuMotion.get(), [0, 0.2], [1, 0], Extrapolation.CLAMP) * (leadingBlocked ? 0.45 : 1),
    transform: [{ rotate: `${45 * plusTurn.get()}deg` }],
  }));
  const restingPlus = resizes && !hasDraft && !focused && !replyActive;
  const expandedFrostTarget = !resizes || focused || anchored || replyActive;
  const expandedFrostHeight =
    fieldHeight + (stacked ? TOOLBAR_HEIGHT : 0) + (attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0);
  const frostSize = useMemo(
    () => ({
      width: Math.round((expandedFrostTarget ? cardWidth : restWidth) * 2) / 2,
      height: Math.round((expandedFrostTarget ? expandedFrostHeight : restHeight) * 2) / 2,
    }),
    [expandedFrostTarget, cardWidth, restWidth, expandedFrostHeight, restHeight],
  );
  const plusDrawn = CONTROL_SIZE * (restingPlus ? REST_CONTROL_SCALE : 1);
  const plusInset = (CONTROL_SIZE - plusDrawn) / 2;
  const attachmentAnchor = {
    left:
      (END_X === 1 ? insets.left : insets.right) +
      BAR_INSET +
      TOOLBAR_PADDING +
      plusInset +
      (restingPlus ? (cardWidth - restWidth) / 2 - restControlShift : 0),
    bottom: Math.max(bottomInset, 10) + 4 + plusInset - (restingPlus ? restControlOffset : 0),
    size: plusDrawn,
    barStart: (END_X === 1 ? insets.left : insets.right) + BAR_INSET + (restingPlus ? (cardWidth - restWidth) / 2 : 0),
    barTop:
      composerBottomGap(bottomInset) +
      (restingPlus
        ? restHeight
        : fieldHeight + (stacked ? TOOLBAR_HEIGHT : 0) + (attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0)),
  };
  /** Opens the ColorOS + menu; false when no glass host is mounted (the classic card opens instead). */
  const openPlusGlassMenu = (files: NonNullable<typeof attachments>): boolean => {
    const box = glassMenuHostBox();
    if (!box) return false;
    // The + rides the keyboard's lift, read from the value the chat lifts the composer by (as the
    // classic card does), so the anchor is where the + is drawn now.
    const keyboard = keyboardHeight ? keyboardHeight.get() : (Keyboard.metrics()?.height ?? 0);
    const lift = Math.max(0, keyboard - (Math.max(bottomInset, 10) - 10));
    const size = attachmentAnchor.size;
    const anchor = {
      x: box.x + attachmentAnchor.left,
      y: box.y + box.height - attachmentAnchor.bottom - size - lift,
      width: size,
      height: size,
    };
    const icon = (Icon: typeof Plus) => <Icon color={String(foreground)} size={20} strokeWidth={1.9} />;
    const key = openGlassMenu({
      anchor,
      stagger: true,
      // Below the + are the composer and the keyboard (inside the host's frame): never flip there.
      above: true,
      // Build 15.1 (Syed): the composer keeps its glass under its own + menu; the header band pauses.
      pauses: "header",
      items: [
        ...(onUseSkill ? [{ id: "skill", title: t("mobile.chat.attachment.useSkill"), icon: icon(Sparkles) }] : []),
        { id: "files", title: t("mobile.chat.attachment.files"), icon: icon(Paperclip), disabled: files.preparing },
        { id: "photos", title: t("mobile.chat.attachment.photos"), icon: icon(Images), disabled: files.preparing },
        { id: "camera", title: t("mobile.chat.attachment.camera"), icon: icon(Camera), disabled: files.preparing },
      ],
      onSelect: (id) => {
        if (id === "skill") onUseSkill?.();
        else if (id === "files") void files.chooseFiles();
        else if (id === "photos") void files.choosePhotos();
        else if (id === "camera") {
          setOpenedWith({ expanded: !restingPlus, focused });
          files.openMenu({ ...attachmentAnchor, camera: true });
        }
      },
      onClose: () => setPlusMenuOpen(false),
    });
    if (key === null) return false;
    setPlusMenuOpen(true);
    return true;
  };
  const control = composerAction({
    disabled,
    hasDraft: hasDraft || dictationBusy,
    busy,
    canStop: Boolean(onStop),
    stopping,
    voiceAvailable: voice?.available ?? false,
  });
  const controlReady = control.pressable;
  const sendBlocked = useRef(false);
  sendBlocked.current = disabled || preparing;
  const hasFiles = useRef(false);
  hasFiles.current = files.length > 0;

  const editAfterDictation = useRef(false);
  useEffect(() => {
    if (dictationBusy) return;
    sendGate.edit();
    if (!editAfterDictation.current) return;
    editAfterDictation.current = false;
    inputRef.current?.focus();
  }, [dictationBusy, sendGate]);
  const finishDictation = useCallback(() => {
    if (!dictation || sendingDictationRef.current) return;
    editAfterDictation.current = true;
    dictation.finish();
  }, [dictation]);
  const toggleDictation = useCallback(() => {
    if (!dictation) return;
    if (dictation.active) finishDictation();
    else dictation.start();
  }, [dictation, finishDictation]);
  const accentFill = voiceAccent?.fill ?? String(action);
  const dark = useColorScheme() === "dark";
  const accentGlyph =
    dark && (voiceAccent?.lightGlyph ?? true) ? String(foreground) : (voiceAccent?.glyph ?? String(actionForeground));

  function sendAndCloseField(text: string): void {
    const input = inputRef.current;
    const fieldFocused = input?.isFocused() ?? false;
    if (!sendGate.submit(fieldFocused)) return;
    onSend(text);
    if (fieldFocused) input?.blur();
  }

  async function sendAfterDictation(current: ComposerDictation): Promise<void> {
    if (sendingDictationRef.current) return;
    sendingDictationRef.current = true;
    editAfterDictation.current = false;
    setSendingDictation(true);
    try {
      const text = await current.finishDraft();
      if (text !== null) latestTextRef.current = text;
      if (text === null || sendBlocked.current || (!text.trim() && !hasFiles.current)) {
        inputRef.current?.focus();
        return;
      }
      sendGate.edit();
      if (keepsKeyboardOnSend) {
        if (sendGate.submit(false)) onSend(text);
      } else sendAndCloseField(text);
    } finally {
      sendingDictationRef.current = false;
      setSendingDictation(false);
    }
  }

  function requestSend(): void {
    if (disabled || preparing) return;
    if (dictationBusy && dictation) {
      void sendAfterDictation(dictation);
      return;
    }
    if (keepsKeyboardOnSend) {
      if (!sendGate.submit(false)) return;
      composingSent.current = true;
      onSend(latestTextRef.current);
      return;
    }
    sendAndCloseField(latestTextRef.current);
  }

  function submitKey(text: string): void {
    if (control.mode !== "send" || !controlReady || voiceOpen) return;
    if (dictationBusy) {
      requestSend();
      return;
    }
    sendAndCloseField(editMentionDraft(latestTextRef.current, text));
  }

  function pressControl(): void {
    switch (control.mode) {
      case "stop":
        onStop?.();
        return;
      case "dictate":
        inputRef.current?.blur();
        voice?.start();
        return;
      case "send":
        requestSend();
    }
  }

  const openVoiceSettings = useCallback(() => {
    editAfterDictation.current = false;
    void haptics.selection();
    inputRef.current?.blur();
    router.push("/settings/voice");
  }, []);
  const voiceSettingsLabel = t("mobile.chat.composer.voiceSettings");

  const controlLabel = {
    send: sendLabel ?? t("mobile.chat.composer.send"),
    stop: t("mobile.chat.composer.stop", { name: agentName }),
    dictate: voice?.startLabel ?? t("mobile.chat.composer.dictate"),
  }[control.mode];

  const focusInput = useCallback(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && !focused && !voiceOpen)
        .activeOffsetY(-16)
        .failOffsetY(16)
        .failOffsetX([-24, 24])
        .onEnd((event) => {
          if (event.translationY < -24 || event.velocityY < -250) scheduleOnRN(focusInput);
        }),
    [disabled, focused, focusInput, voiceOpen],
  );

  return (
    <View>
      {suggestionsVisible && query ? (
        <GlassView
          onLayout={({ nativeEvent }) => setSuggestionsHeight(nativeEvent.layout.height)}
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            marginLeft: insets.left + 16,
            marginRight: insets.right + 16,
            flexGrow: 0,
            maxHeight: 240,
            borderRadius: 24,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
          }}
        >
          <ScrollView keyboardShouldPersistTaps="always" style={{ flexGrow: 0 }}>
            {suggestions.map((agent) => (
              <Button
                key={agent.id}
                variant="ghost"
                className="min-h-12 flex-row justify-start gap-3 rounded-none px-4"
                accessibilityLabel={t("mobile.chat.composer.mention", { name: agent.name })}
                onPress={() => {
                  void haptics.selection();
                  const next = insertMention(latestTextRef.current, query, agent);
                  latestTextRef.current = next;
                  onChangeDraft(next);
                  const position = query.start + agent.name.length + 2;
                  setCursor(position);
                  pendingCursor.current = position;
                  inputRef.current?.focus();
                }}
              >
                <BloubAvatar
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  color={agent.avatarColor}
                  seed={agent.avatarSeed}
                  size={28}
                />
                <Typography.Paragraph numberOfLines={1} className="flex-1">
                  {agent.name}
                </Typography.Paragraph>
              </Button>
            ))}
            {TAG_GROUPS.map(({ kind, title, label, Icon }, groupIndex) => {
              const group = tagSuggestions.filter((tag) => tag.kind === kind);
              if (group.length === 0) return null;
              const titled =
                suggestions.length > 0 ||
                tagSuggestions.some((tag) => TAG_GROUPS.findIndex((other) => other.kind === tag.kind) < groupIndex);
              return (
                <View key={kind}>
                  {titled ? (
                    <Typography type="body-xs" className="px-4 pt-2 pb-1 text-muted">
                      {t(title)}
                    </Typography>
                  ) : null}
                  {group.map((tag) => (
                    <Button
                      key={tag.id}
                      variant="ghost"
                      className="min-h-12 flex-row justify-start gap-3 rounded-none px-4"
                      accessibilityLabel={t(label, { name: tag.name })}
                      onPress={() => {
                        void haptics.selection();
                        const next = insertMention(latestTextRef.current, query, tag, kind);
                        latestTextRef.current = next;
                        onChangeDraft(next);
                        const position = query.start + tag.name.length + (kind === "tab" || kind === "thread" ? 1 : 2);
                        setCursor(position);
                        pendingCursor.current = position;
                        setSkillsOnly(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <View className="size-7 items-center justify-center rounded-lg bg-control">
                        <Icon color={String(foreground)} size={16} strokeWidth={1.9} />
                      </View>
                      <Typography.Paragraph numberOfLines={1} className="flex-1">
                        {tag.name}
                      </Typography.Paragraph>
                      {"detail" in tag && tag.detail ? (
                        <Typography type="body-xs" numberOfLines={1} className="max-w-[40%] text-muted">
                          {tag.detail}
                        </Typography>
                      ) : null}
                    </Button>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </GlassView>
      ) : null}
      <View
        pointerEvents="box-none"
        style={{
          alignItems: "center",
          paddingLeft: insets.left + BAR_INSET,
          paddingRight: insets.right + BAR_INSET,
          paddingTop: 8,
          paddingBottom: composerBottomGap(bottomInset),
        }}
      >
        <NativeText
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          numberOfLines={1}
          className="font-sans"
          style={{ position: "absolute", left: 0, top: 0, opacity: 0, fontSize: 16, lineHeight: 22 }}
          onLayout={({ nativeEvent }) =>
            setPlaceholderWidth((current) =>
              Math.abs(current - nativeEvent.layout.width) < 1 ? current : nativeEvent.layout.width,
            )
          }
        >
          {placeholderText}
        </NativeText>
        <GestureDetector gesture={pan}>
          <AnimatedGlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            style={[
              {
                // Frosted, the card's fill is the solid layer under ComposerFrost's blur.
                backgroundColor: liquidGlassAvailable || frosted ? "transparent" : fallbackBackground,
                borderCurve: "continuous",
                borderRadius: CARD_RADIUS,
                overflow: "hidden",
                opacity: disabled ? 0.45 : 1,
              },
              cardStyle,
            ]}
          >
            {frosted && frostTarget ? (
              <ComposerFrost
                target={frostTarget}
                shown={!voiceOpen && !frostMenu}
                solid={String(fallbackBackground)}
                radius={CARD_RADIUS}
                size={frostSize}
              />
            ) : null}
            <NativeText
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              className="font-sans"
              style={{
                position: "absolute",
                left: FIELD_INSET,
                width: Math.max(0, cardWidth - FIELD_INSET * 2),
                top: 0,
                opacity: 0,
                fontSize: 16,
                lineHeight: 22,
              }}
              onTextLayout={({ nativeEvent }) => {
                const lines = Math.max(1, nativeEvent.lines.length);
                const width = nativeEvent.lines.reduce((widest, line) => Math.max(widest, line.width), 0);
                setWrap((current) => (current.lines === lines && current.width === width ? current : { lines, width }));
              }}
            >
              {`${displayText}​`}
            </NativeText>
            {shownReply && !voiceOpen ? (
              <Animated.View style={[{ overflow: "hidden" }, replyStyle]}>
                <View
                  className="flex-row items-center gap-2 pt-2 pl-4 pr-2"
                  style={{ position: "absolute", top: 0, left: 0, right: 0 }}
                  onLayout={({ nativeEvent }) => replyRowHeight.set(nativeEvent.layout.height)}
                >
                  <Reply color={String(muted)} size={16} style={MIRROR_IN_RTL} />
                  <Typography.Paragraph numberOfLines={1} type="body-sm" className="flex-1 text-text-secondary">
                    {markdownPreviewText(mentionDraft(shownReply.body).text) || t("mobile.chat.reply.attachment")}
                  </Typography.Paragraph>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={t("mobile.chat.composer.cancelReply")}
                    onPress={() => {
                      void haptics.selection();
                      onCancelReply();
                    }}
                  >
                    <X color={String(muted)} size={16} />
                  </Button>
                </View>
              </Animated.View>
            ) : null}
            <Animated.View style={[{ overflow: "hidden" }, attachmentStyle]}>
              {attachmentsOpen ? (
                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 8, paddingTop: 8 }}
                >
                  {files.map((item, index) => (
                    <ComposerAttachmentTile
                      key={item.id}
                      item={item}
                      index={index}
                      count={files.length}
                      disabled={preparing}
                      foreground={foreground}
                      raised={raised}
                      onPreview={() => {
                        void haptics.impact("soft");
                        setPreviewId(item.id);
                      }}
                      onRemove={() => {
                        void haptics.selection();
                        attachments?.remove(item.id);
                      }}
                    />
                  ))}
                </ScrollView>
              ) : null}
            </Animated.View>
            <View>
              <Animated.View style={[{ overflow: "hidden" }, fieldBoxStyle]}>
                <Animated.View
                  style={[{ position: "absolute", left: FIELD_INSET, right: FIELD_INSET, bottom: 0 }, fieldSlideStyle]}
                >
                  <ComposerPasteTarget ref={pasteRef} onPasteFiles={pasteFiles} onSubmitKey={submitKey}>
                    <TextInput
                      ref={inputRef}
                      nativeID="chat-composer-input"
                      accessibilityLabel={t("mobile.chat.composer.messageAgent", { name: agentName })}
                      accessibilityState={{ disabled: disabled || voiceOpen || dictationBusy }}
                      accessibilityElementsHidden={voiceOpen}
                      importantForAccessibility={voiceOpen ? "no-hide-descendants" : "auto"}
                      editable={!disabled && !voiceOpen}
                      showSoftInputOnFocus={!disabled && !voiceOpen}
                      className="min-w-0 font-sans text-foreground"
                      autoCorrect
                      autoCapitalize="sentences"
                      multiline
                      scrollEnabled={wrap.lines > MAX_INPUT_LINES}
                      returnKeyType="default"
                      submitBehavior="newline"
                      {...selectionColorProps(foreground)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 16,
                        lineHeight: 22,
                        paddingVertical: FIELD_VERTICAL_PADDING / 2,
                        textAlignVertical: "top",
                        ...fieldDirection,
                      }}
                      onSelectionChange={({ nativeEvent }) =>
                        setCursor(
                          nativeEvent.selection.start === nativeEvent.selection.end ? nativeEvent.selection.end : -1,
                        )
                      }
                      onFocus={() => {
                        onInputFocus?.();
                        sendGate.focus();
                        setFocused(true);
                      }}
                      onBlur={() => setFocused(false)}
                      onChangeText={(text) => {
                        if (sendGate.ignoresFieldText()) {
                          if (text === "") sendGate.releaseFieldText();
                          return;
                        }
                        composingSent.current = false;
                        if (dictationBusy) {
                          if (dictating) finishDictation();
                          return;
                        }
                        sendGate.edit();
                        const pasted = attachments ? largePastedText(latestTextRef.current, text) : null;
                        if (pasted && attachments) {
                          latestTextRef.current = text;
                          onChangeDraft(text);
                          setField((current) => typedComposerField(current, text));
                          void Promise.resolve()
                            .then(() => attachments?.pasteText(pasted.text, () => {}))
                            .then(() => {
                              if (latestTextRef.current !== text) return;
                              latestTextRef.current = pasted.draft;
                              onChangeDraft(pasted.draft);
                            })
                            .catch((error) =>
                              showFileFailure(error, t("mobile.chat.composer.pasteFailed"), { t, sourceText }),
                            );
                          return;
                        }
                        const source = latestTextRef.current;
                        const previous = mentionDraft(source).text;
                        const listEdit = markdownListReturn(previous, text, cursor);
                        if (listEdit) pendingCursor.current = listEdit.caret;
                        const next = listEdit
                          ? applyMarkdownListEdit(source, previous, cursor, listEdit)
                          : editMentionDraft(source, text);
                        latestTextRef.current = next;
                        onChangeDraft(next);
                        setField((current) => typedComposerField(current, text));
                      }}
                      onSubmitEditing={({ nativeEvent }) => {
                        if (!disabled) sendAndCloseField(editMentionDraft(latestTextRef.current, nativeEvent.text));
                      }}
                      onEndEditing={({ nativeEvent: { text } }) => {
                        if (sendGate.endEditing()) return;
                        latestTextRef.current = editMentionDraft(latestTextRef.current, text);
                      }}
                    >
                      <NativeText>
                        {display.mentions.map((mention, index) => (
                          <NativeText key={mention.start}>
                            {displayText.slice(index ? (display.mentions[index - 1]?.end ?? 0) : 0, mention.start)}
                            <NativeText style={{ color: action }}>
                              {displayText.slice(mention.start, mention.end)}
                            </NativeText>
                          </NativeText>
                        ))}
                        {fieldHead}
                        {fieldTail}
                      </NativeText>
                    </TextInput>
                  </ComposerPasteTarget>
                </Animated.View>
                {displayText ? null : (
                  <Animated.View
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute",
                        left: FIELD_INSET,
                        right: trailingInset,
                        top: 0,
                        bottom: 0,
                        justifyContent: "center",
                        alignItems: "flex-start",
                      },
                      placeholderStyle,
                    ]}
                  >
                    <LayoutAnimationConfig skipEntering skipExiting>
                      <Animated.View key={placeholderText} entering={PLACEHOLDER_IN} exiting={PLACEHOLDER_OUT}>
                        <NativeText
                          numberOfLines={1}
                          className="font-sans"
                          style={{ color: String(muted), fontSize: 16, lineHeight: 22 }}
                        >
                          {placeholderText}
                        </NativeText>
                      </Animated.View>
                    </LayoutAnimationConfig>
                  </Animated.View>
                )}
                {dictating ? (
                  <Pressable accessible={false} style={{ position: "absolute", inset: 0 }} onPress={finishDictation} />
                ) : null}
              </Animated.View>
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: TOOLBAR_HEIGHT,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingHorizontal: TOOLBAR_PADDING,
                }}
              >
                {dictating && dictation ? (
                  <DictationStrip
                    level={dictation.level}
                    presence={dictationPresence}
                    right={TOOLBAR_PADDING + 2 * (CONTROL_SIZE + CONTROL_GAP)}
                    foreground={String(foreground)}
                    accent={accentFill}
                  />
                ) : null}
                <Animated.View
                  style={[{ flexDirection: "row", alignItems: "center", gap: CONTROL_GAP }, controlStyle]}
                  pointerEvents={voiceOpen ? "none" : "auto"}
                >
                  {dictationMic && dictation ? (
                    <Animated.View
                      key="dictation-mic"
                      style={dictationMicStyle}
                      pointerEvents={voiceOpen ? "none" : "auto"}
                      accessibilityElementsHidden={voiceOpen}
                      importantForAccessibility={voiceOpen ? "no-hide-descendants" : "auto"}
                    >
                      <DictationMic
                        active={dictating}
                        presence={dictationPresence}
                        enabled={!disabled && !voiceOpen && !sendingDictation}
                        label={t(dictating ? "mobile.chat.composer.stopDictation" : "mobile.chat.composer.dictate")}
                        foreground={String(foreground)}
                        onPress={toggleDictation}
                        onLongPress={openVoiceSettings}
                        longPressLabel={voiceSettingsLabel}
                      />
                    </Animated.View>
                  ) : null}
                  <ComposerSendControl
                    mode={control.mode}
                    primed={control.primed}
                    spinner={control.spinner}
                    ready={controlReady}
                    disabled={disabled}
                    label={controlLabel}
                    accentFill={accentFill}
                    accentGlyph={accentGlyph}
                    muted={muted}
                    onPress={pressControl}
                  />
                </Animated.View>
              </View>
            </View>
            {voiceOpen && voice ? (
              <VoiceCallBar
                voice={voice}
                bar={voice.bar}
                avatar={voiceAvatar}
                palette={voicePalette}
                accent={voiceAccent}
              />
            ) : null}
          </AnimatedGlassView>
        </GestureDetector>
        {attachments ? (
          <Animated.View
            pointerEvents={voiceOpen || dictating ? "none" : "box-none"}
            accessibilityElementsHidden={voiceOpen || dictating}
            importantForAccessibility={voiceOpen || dictating ? "no-hide-descendants" : "auto"}
            style={[
              { position: "absolute", left: insets.left + BAR_INSET + 8, bottom: Math.max(bottomInset, 10) + 4 },
              plusStyle,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.composer.addAttachment")}
              accessibilityValue={contextAlert ? { text: contextAlert.label } : undefined}
              disabled={leadingBlocked}
              hitSlop={4}
              className="size-10 items-center justify-center rounded-full"
              accessibilityState={{ disabled: leadingBlocked, expanded: plusMenuOpen }}
              onPress={() => {
                void haptics.selection();
                if (frosted && attachments && openPlusGlassMenu(attachments)) return;
                setOpenedWith({ expanded: !restingPlus, focused });
                attachments?.openMenu({
                  ...attachmentAnchor,
                  barTop: attachmentAnchor.barTop + (replyActive ? replyRowHeight.get() : 0),
                });
              }}
            >
              <Animated.View style={plusGlyphStyle}>
                <Plus color={String(foreground)} size={24} strokeWidth={1.8} />
              </Animated.View>
              {contextAlert ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 6,
                    end: 6,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: String(contextAlert.level === "danger" ? dangerColor : warningColor),
                  }}
                />
              ) : null}
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
      <AttachmentPreviewSheet
        preview={
          previewItem
            ? {
                name: previewItem.name,
                uri: localPreviewUri(previewItem),
                type: attachmentTypeLabel(previewItem.name, previewItem.mimeType, t),
                size: format.fileSize(previewItem.size),
              }
            : null
        }
        actions={
          previewItem
            ? [
                ...(localPreviewUri(previewItem)
                  ? []
                  : [{ label: t("common.open"), onPress: () => void shareLocalAttachment(previewItem) }]),
                {
                  label: t("mobile.chat.attachment.replace"),
                  disabled: preparing,
                  onPress: () => void attachments?.replace(previewItem.id),
                },
                {
                  label: t("common.remove"),
                  variant: "danger-soft" as const,
                  disabled: preparing,
                  onPress: () => attachments?.remove(previewItem.id),
                },
              ]
            : []
        }
        onClose={() => setPreviewId(null)}
      />
    </View>
  );
});
