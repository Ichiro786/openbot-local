// `openbot-ui` v1 blocks in a chat reply (docs/openbot-ui.md): native views in the app's design
// language, never a WebView, and nothing in the block runs. A block that is still streaming shows a
// skeleton at an estimated height (no partial layout that grows node by node); a finished block
// that does not validate is shown as its code. No blur here: the chat's two frosts stay the only ones.
import { Image } from "expo-image";
import { Skeleton, Typography } from "heroui-native";
import Banknote from "lucide-react-native/icons/banknote";
import Calendar from "lucide-react-native/icons/calendar";
import ChartColumn from "lucide-react-native/icons/chart-column";
import Check from "lucide-react-native/icons/check";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDashed from "lucide-react-native/icons/circle-dashed";
import CircleDot from "lucide-react-native/icons/circle-dot";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock from "lucide-react-native/icons/clock";
import File from "lucide-react-native/icons/file";
import Folder from "lucide-react-native/icons/folder";
import Heart from "lucide-react-native/icons/heart";
import Info from "lucide-react-native/icons/info";
import Link from "lucide-react-native/icons/link";
import Mail from "lucide-react-native/icons/mail";
import MapPin from "lucide-react-native/icons/map-pin";
import ShoppingCart from "lucide-react-native/icons/shopping-cart";
import Star from "lucide-react-native/icons/star";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import User from "lucide-react-native/icons/user";
import X from "lucide-react-native/icons/x";
import Bolt from "lucide-react-native/icons/zap";
import { createContext, memo, type ReactNode, use, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Line, Polyline, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { Button } from "@/shared/components/button";
import { DonutChart, donutArcs } from "@/shared/components/donut-chart";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import {
  estimateOpenbotUiHeight,
  formValues,
  openbotUiActionMessage,
  parseOpenbotUi,
  type UiActions,
  type UiCallout,
  type UiCard,
  type UiChart,
  type UiForm,
  type UiIcon,
  type UiList,
  type UiNode,
  type UiProgress,
  type UiScalar,
  type UiStats,
  type UiSteps,
  type UiTable,
} from "./openbot-ui-schema";

/** Sends a user message to the chat the block is in. Undefined where the chat cannot send (read only). */
export const OpenbotUiActionsContext = createContext<((text: string) => void) | undefined>(undefined);

/** Series colors: mid tones that read on the AMOLED black and the light chat. */
const SERIES = ["#5B8DEF", "#34A853", "#FA7B17", "#A56EF2", "#1FB5C9", "#EA4335", "#F4B400", "#8D96A0"];
const CHART_HEIGHT = 150;
const CARD_STYLE = { borderRadius: 18, borderCurve: "continuous" } as const;

const ICONS: Record<UiIcon, typeof Check> = {
  check: Check,
  x: X,
  info: Info,
  warning: TriangleAlert,
  star: Star,
  file: File,
  folder: Folder,
  link: Link,
  calendar: Calendar,
  clock: Clock,
  user: User,
  mail: Mail,
  chart: ChartColumn,
  money: Banknote,
  cart: ShoppingCart,
  location: MapPin,
  bolt: Bolt,
  heart: Heart,
};

/** What was sent from a block in this app run, by the block's source, so a remount keeps it. */
const sentFrom = new Map<string, string>();

interface BlockState {
  send: ((text: string) => void) | undefined;
  sentId: string | undefined;
  markSent: (id: string) => void;
  renderBody: (body: string) => ReactNode;
}

const BlockContext = createContext<BlockState | null>(null);

function useBlock(): BlockState {
  const state = use(BlockContext);
  if (!state) throw new Error("openbot-ui node outside its block");
  return state;
}

function useColors() {
  return {
    muted: String(useCSSVariable("--openbot-text-grouped-secondary") ?? "#8E8E93"),
    accent: String(useCSSVariable("--openbot-accent") ?? "#5B8DEF"),
    success: String(useCSSVariable("--openbot-success-text") ?? "#34A853"),
    danger: String(useCSSVariable("--openbot-danger-text") ?? "#EA4335"),
    warning: String(useCSSVariable("--openbot-warning") ?? "#F4B400"),
    border: String(useCSSVariable("--openbot-border-grouped") ?? "#88888833"),
    foreground: String(useCSSVariable("--openbot-text-primary") ?? "#FFFFFF"),
  };
}

export const OpenbotUiBlock = memo(function OpenbotUiBlock({
  text,
  complete,
  renderBody,
  fallback,
}: {
  text: string;
  /** The fence is closed or the reply finished: the block will not change. */
  complete: boolean;
  renderBody: (body: string) => ReactNode;
  /** The code block, for a block that does not validate. */
  fallback: ReactNode;
}) {
  const { t } = useText();
  const send = use(OpenbotUiActionsContext);
  const [sentId, setSentId] = useState(() => sentFrom.get(text));
  const parsed = useMemo(() => (complete ? parseOpenbotUi(text) : null), [complete, text]);
  const state = useMemo<BlockState>(
    () => ({
      send,
      sentId,
      renderBody,
      markSent: (id) => {
        sentFrom.set(text, id);
        setSentId(id);
      },
    }),
    [send, sentId, renderBody, text],
  );
  if (!parsed) {
    return (
      <Skeleton
        accessibilityLabel={t("mobile.chat.ui.loading")}
        className="w-full"
        style={{ ...CARD_STYLE, height: estimateOpenbotUiHeight(text) }}
      />
    );
  }
  if (!parsed.ok) {
    return (
      <View className="gap-1.5">
        <Typography.Paragraph type="body-xs" className="text-muted">
          {t("mobile.chat.ui.invalid")}
        </Typography.Paragraph>
        {fallback}
      </View>
    );
  }
  return (
    <BlockContext value={state}>
      <View className="gap-2.5" testID="openbot-ui-block">
        {parsed.nodes.map((node, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its nodes.
          <UiNodeView key={index} node={node} />
        ))}
      </View>
    </BlockContext>
  );
});

function UiNodeView({ node }: { node: UiNode }) {
  switch (node.type) {
    case "card":
      return <CardView node={node} />;
    case "stats":
      return <StatsView node={node} />;
    case "table":
      return <TableView node={node} />;
    case "chart":
      return <ChartView node={node} />;
    case "list":
      return <ListView node={node} />;
    case "actions":
      return <ActionsView node={node} />;
    case "form":
      return <FormView node={node} />;
    case "steps":
      return <StepsView node={node} />;
    case "progress":
      return <ProgressView node={node} />;
    case "callout":
      return <CalloutView node={node} />;
  }
}

function Panel({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  return (
    <View
      className={`overflow-hidden border border-separator bg-control/50 ${padded ? "gap-2 p-3" : ""}`}
      style={CARD_STYLE}
    >
      {children}
    </View>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Typography.Paragraph className="font-semibold text-foreground" numberOfLines={2}>
      {children}
    </Typography.Paragraph>
  );
}

function CardView({ node }: { node: UiCard }) {
  const { renderBody } = useBlock();
  return (
    <Panel padded={false}>
      {node.image ? (
        <Image source={{ uri: node.image }} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" />
      ) : null}
      <View className="gap-2 p-3">
        {node.title ? <Title>{node.title}</Title> : null}
        {node.subtitle ? (
          <Typography.Paragraph type="body-sm" className="-mt-1.5 text-muted">
            {node.subtitle}
          </Typography.Paragraph>
        ) : null}
        {node.body ? renderBody(node.body) : null}
        {node.children?.map((child, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its nodes.
          <UiNodeView key={index} node={child} />
        ))}
      </View>
    </Panel>
  );
}

function StatsView({ node }: { node: UiStats }) {
  const colors = useColors();
  return (
    <View className="flex-row flex-wrap gap-2">
      {node.items.map((item, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its nodes.
          key={index}
          className="min-w-[45%] grow gap-0.5 border border-separator bg-control/50 p-3"
          style={{ borderRadius: 14, borderCurve: "continuous" }}
        >
          <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
            {item.label}
          </Typography.Paragraph>
          <Typography type="h4" className="text-foreground" numberOfLines={1}>
            {String(item.value)}
          </Typography>
          {item.delta ? (
            <Typography.Paragraph
              type="body-xs"
              numberOfLines={1}
              style={{
                color:
                  item.tone === "positive" ? colors.success : item.tone === "negative" ? colors.danger : colors.muted,
              }}
            >
              {item.delta}
            </Typography.Paragraph>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function TableView({ node }: { node: UiTable }) {
  const cell = (value: UiScalar | null) => (value === null ? "" : String(value));
  return (
    <Panel padded={false}>
      {node.title ? (
        <View className="px-3 pt-3">
          <Title>{node.title}</Title>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="p-3">
        <View>
          <View className="flex-row border-b border-separator pb-1.5">
            {node.columns.map((column, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are fixed.
              <View key={index} style={{ minWidth: 88, maxWidth: 200 }} className="pe-3">
                <Typography.Paragraph type="body-sm" className="font-semibold text-foreground">
                  {column}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
          {node.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its rows.
            <View key={rowIndex} className="flex-row border-b border-separator/50 py-1.5">
              {node.columns.map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are fixed.
                <View key={index} style={{ minWidth: 88, maxWidth: 200 }} className="pe-3">
                  <Typography.Paragraph type="body-sm" className="text-foreground" selectable>
                    {cell(row[index] ?? null)}
                  </Typography.Paragraph>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </Panel>
  );
}

function Legend({ names }: { names: readonly string[] }) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      {names.map((name, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: series are fixed.
        <View key={index} className="flex-row items-center gap-1.5">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: SERIES[index % SERIES.length] }} />
          <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
            {name}
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}

function ChartView({ node }: { node: UiChart }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  if (node.kind === "donut") {
    const values = node.series[0]?.values ?? [];
    const arcs = donutArcs(
      node.labels.map((label, index) => ({
        key: `${index}-${label}`,
        color: SERIES[index % SERIES.length] ?? "#888",
        value: values[index] ?? 0,
      })),
    );
    return (
      <Panel>
        {node.title ? <Title>{node.title}</Title> : null}
        <DonutChart arcs={arcs} size={140} stroke={16} />
        <Legend names={node.labels.map((label, index) => `${label} · ${values[index] ?? 0}`)} />
      </Panel>
    );
  }
  const all = node.series.flatMap((series) => series.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (value: number) => CHART_HEIGHT - ((value - min) / span) * (CHART_HEIGHT - 8) - 4;
  const count = node.labels.length;
  const slot = width > 0 ? width / count : 0;
  return (
    <Panel>
      {node.title ? <Title>{node.title}</Title> : null}
      <View style={{ height: CHART_HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <FadeInView>
            <Svg width={width} height={CHART_HEIGHT}>
              <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={colors.border} strokeWidth={1} />
              {node.kind === "bar"
                ? node.series.map((series, s) =>
                    series.values.map((value, index) => {
                      const barWidth = Math.max(2, (slot * 0.7) / node.series.length);
                      const x = index * slot + slot * 0.15 + s * barWidth;
                      const top = Math.min(y(value), y(0));
                      return (
                        <Rect
                          // biome-ignore lint/suspicious/noArrayIndexKey: a finished chart never reorders.
                          key={`${s}-${index}`}
                          x={x}
                          y={top}
                          width={barWidth - 1}
                          height={Math.max(1, Math.abs(y(value) - y(0)))}
                          rx={Math.min(4, barWidth / 3)}
                          fill={SERIES[s % SERIES.length]}
                        />
                      );
                    }),
                  )
                : node.series.map((series, s) => (
                    <Polyline
                      // biome-ignore lint/suspicious/noArrayIndexKey: a finished chart never reorders.
                      key={s}
                      points={series.values.map((value, index) => `${index * slot + slot / 2},${y(value)}`).join(" ")}
                      fill="none"
                      stroke={SERIES[s % SERIES.length]}
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
            </Svg>
          </FadeInView>
        ) : null}
      </View>
      <View className="flex-row">
        {node.labels.map((label, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: labels are fixed.
          <View key={index} style={{ width: slot || undefined, flex: slot ? undefined : 1 }}>
            <Typography.Paragraph type="body-xs" className="text-center text-muted" numberOfLines={1}>
              {label}
            </Typography.Paragraph>
          </View>
        ))}
      </View>
      {node.series.length > 1 ? <Legend names={node.series.map((series) => series.name)} /> : null}
    </Panel>
  );
}

/** Fades its child in once (220 ms); reduced motion shows it at once. */
function FadeInView({ children }: { children: ReactNode }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, { duration: 220, reduceMotion: ReduceMotion.System }));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function ListView({ node }: { node: UiList }) {
  const colors = useColors();
  return (
    <Panel>
      {node.title ? <Title>{node.title}</Title> : null}
      {node.items.map((item, index) => {
        const Icon = item.icon ? ICONS[item.icon] : null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its items.
          <View key={index} className="flex-row items-center gap-3">
            {Icon ? <Icon size={18} color={colors.accent} /> : null}
            <View className="min-w-0 flex-1">
              <Typography.Paragraph className="text-foreground" numberOfLines={2}>
                {item.title}
              </Typography.Paragraph>
              {item.subtitle ? (
                <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={2}>
                  {item.subtitle}
                </Typography.Paragraph>
              ) : null}
            </View>
            {item.trailing ? (
              <Typography.Paragraph type="body-sm" className="text-muted" numberOfLines={1}>
                {item.trailing}
              </Typography.Paragraph>
            ) : null}
          </View>
        );
      })}
    </Panel>
  );
}

function ActionsView({ node }: { node: UiActions }) {
  const { send, sentId, markSent } = useBlock();
  const { t } = useText();
  const disabled = !send || sentId !== undefined;
  const press = (item: UiActions["items"][number]) => {
    if (disabled || !send) return;
    void haptics.impact("soft");
    markSent(item.id);
    send(openbotUiActionMessage(item.id, item.value, item.label));
  };
  if (node.style === "chips") {
    return (
      <View className="flex-row flex-wrap gap-2">
        {node.items.map((item) => {
          const chosen = sentId === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: chosen }}
              disabled={disabled}
              onPress={() => press(item)}
              className={`rounded-full border px-3.5 py-2 ${chosen ? "border-accent bg-accent/15" : "border-separator bg-control/50"} ${disabled && !chosen ? "opacity-50" : ""}`}
            >
              <Typography.Paragraph type="body-sm" className={chosen ? "text-accent" : "text-foreground"}>
                {chosen ? `${item.label} · ${t("mobile.chat.ui.chosen")}` : item.label}
              </Typography.Paragraph>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-2">
      {node.items.map((item) => (
        <Button
          key={item.id}
          size="sm"
          variant={item.style === "danger" ? "danger" : item.style === "secondary" ? "secondary" : "primary"}
          isDisabled={disabled}
          onPress={() => press(item)}
        >
          <Button.Label>
            {sentId === item.id ? `${item.label} · ${t("mobile.chat.ui.chosen")}` : item.label}
          </Button.Label>
        </Button>
      ))}
    </View>
  );
}

function FormView({ node }: { node: UiForm }) {
  const { send, sentId, markSent } = useBlock();
  const { t } = useText();
  const colors = useColors();
  const [drafts, setDrafts] = useState<Record<string, UiScalar | undefined>>(() =>
    Object.fromEntries(node.fields.map((field) => [field.name, field.default])),
  );
  const [error, setError] = useState(false);
  const sent = sentId === node.id;
  const disabled = !send || sentId !== undefined;
  const set = (name: string, value: UiScalar) => {
    setError(false);
    setDrafts((current) => ({ ...current, [name]: value }));
  };
  const submit = () => {
    if (disabled || !send) return;
    const values = formValues(node.fields, drafts);
    if (!values) {
      setError(true);
      void haptics.notification("error");
      return;
    }
    const summary = node.fields
      .filter((field) => values[field.name] !== undefined)
      .map((field) => {
        const value = values[field.name];
        const shown =
          typeof value === "boolean" ? t(value ? "mobile.chat.ui.yes" : "mobile.chat.ui.no") : String(value);
        return `${field.label}: ${shown}`;
      })
      .join(", ");
    void haptics.notification("success");
    markSent(node.id);
    send(openbotUiActionMessage(node.id, values, `${t("mobile.chat.ui.formSent")}${summary ? ` (${summary})` : ""}`));
  };
  return (
    <Panel>
      {node.title ? <Title>{node.title}</Title> : null}
      {node.fields.map((field) => (
        <View
          key={field.name}
          className={field.kind === "toggle" ? "flex-row items-center justify-between gap-3" : "gap-1.5"}
        >
          <Typography.Paragraph type="body-sm" className="text-foreground">
            {field.required ? `${field.label} *` : field.label}
          </Typography.Paragraph>
          {field.kind === "toggle" ? (
            <Switch
              value={drafts[field.name] === true}
              disabled={disabled}
              onValueChange={(value) => set(field.name, value)}
              accessibilityLabel={field.label}
            />
          ) : field.kind === "select" ? (
            <View className="flex-row flex-wrap gap-2">
              {field.options?.map((option) => {
                const chosen = drafts[field.name] === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen, disabled }}
                    disabled={disabled}
                    onPress={() => set(field.name, option)}
                    className={`rounded-full border px-3 py-1.5 ${chosen ? "border-accent bg-accent/15" : "border-separator"}`}
                  >
                    <Typography.Paragraph type="body-sm" className={chosen ? "text-accent" : "text-foreground"}>
                      {option}
                    </Typography.Paragraph>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              value={drafts[field.name] === undefined ? "" : String(drafts[field.name])}
              onChangeText={(value) => set(field.name, value)}
              editable={!disabled}
              placeholder={field.placeholder}
              placeholderTextColor={colors.muted}
              inputMode={field.kind === "number" ? "decimal" : "text"}
              accessibilityLabel={field.label}
              className="rounded-xl border border-separator px-3 py-2 text-foreground"
              style={{ color: colors.foreground, fontSize: 16 }}
            />
          )}
        </View>
      ))}
      {error ? (
        <Typography.Paragraph type="body-xs" accessibilityRole="alert" className="text-danger-text">
          {t("mobile.chat.ui.required")}
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row justify-end">
        <Button size="sm" variant="primary" isDisabled={disabled} onPress={submit}>
          <Button.Label>{sent ? t("mobile.chat.ui.chosen") : (node.submit ?? t("mobile.chat.ui.submit"))}</Button.Label>
        </Button>
      </View>
    </Panel>
  );
}

function StepsView({ node }: { node: UiSteps }) {
  const colors = useColors();
  const icon = (status: UiSteps["items"][number]["status"]) => {
    switch (status) {
      case "done":
        return <CircleCheck size={18} color={colors.success} />;
      case "active":
        return <CircleDot size={18} color={colors.accent} />;
      case "failed":
        return <CircleX size={18} color={colors.danger} />;
      case "pending":
        return <CircleDashed size={18} color={colors.muted} />;
    }
  };
  return (
    <Panel>
      {node.title ? <Title>{node.title}</Title> : null}
      {node.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a finished block never reorders its steps.
        <View key={index} className="flex-row gap-3">
          <View className="pt-0.5">{icon(item.status)}</View>
          <View className="min-w-0 flex-1">
            <Typography.Paragraph
              className={item.status === "pending" ? "text-muted" : "text-foreground"}
              numberOfLines={2}
            >
              {item.label}
            </Typography.Paragraph>
            {item.detail ? (
              <Typography.Paragraph type="body-xs" className="text-muted">
                {item.detail}
              </Typography.Paragraph>
            ) : null}
          </View>
        </View>
      ))}
    </Panel>
  );
}

function percent(value: number): `${number}%` {
  "worklet";
  return `${Math.max(0, Math.min(1, value)) * 100}%`;
}

function ProgressView({ node }: { node: UiProgress }) {
  const colors = useColors();
  const { format } = useText();
  const width = useSharedValue(0);
  useEffect(() => {
    width.set(withTiming(node.value, { duration: 420, reduceMotion: ReduceMotion.System }));
  }, [node.value, width]);
  const style = useAnimatedStyle(() => ({ width: percent(width.get()) }));
  return (
    <Panel>
      <View className="flex-row items-center justify-between gap-3">
        <Typography.Paragraph type="body-sm" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
          {node.label ?? ""}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="text-muted">
          {format.percent(node.value)}
        </Typography.Paragraph>
      </View>
      <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
        <Animated.View style={[{ height: "100%", borderRadius: 999, backgroundColor: colors.accent }, style]} />
      </View>
    </Panel>
  );
}

function CalloutView({ node }: { node: UiCallout }) {
  const colors = useColors();
  const color =
    node.tone === "success"
      ? colors.success
      : node.tone === "warning"
        ? colors.warning
        : node.tone === "error"
          ? colors.danger
          : colors.accent;
  const Icon =
    node.tone === "success"
      ? CircleCheck
      : node.tone === "warning"
        ? TriangleAlert
        : node.tone === "error"
          ? CircleX
          : Info;
  return (
    <View className="flex-row gap-3 overflow-hidden border border-separator p-3" style={CARD_STYLE}>
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: color, opacity: 0.1 }} />
      <Icon size={18} color={color} />
      <View className="min-w-0 flex-1 gap-0.5">
        {node.title ? <Title>{node.title}</Title> : null}
        <Typography.Paragraph type="body-sm" className="text-foreground">
          {node.body}
        </Typography.Paragraph>
      </View>
    </View>
  );
}
