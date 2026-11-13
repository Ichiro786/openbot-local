// A ring chart: one arc per segment, a total in the middle. Used by Settings › Local engine ›
// Storage and by `openbot-ui` chart blocks in chat. The ring sweeps in once (720 ms), and when the
// values change each arc morphs from its old place to its new one; reduced motion draws it at once.
import { Typography } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import type { DonutArc } from "@/shared/lib/donut-arcs";
import { useReducedMotion } from "@/shared/lib/motion";

export { type DonutArc, type DonutSegment, donutArcs } from "@/shared/lib/donut-arcs";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const FILL_MS = 720;
const MORPH_MS = 420;
const EASE = Easing.bezier(0.2, 0, 0, 1);

function Arc({
  arc,
  size,
  stroke,
  reveal,
  reduced,
}: {
  arc: DonutArc;
  size: number;
  stroke: number;
  reveal: SharedValue<number>;
  reduced: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const from = useSharedValue(arc.start);
  const to = useSharedValue(arc.end);
  useEffect(() => {
    if (reduced) {
      from.set(arc.start);
      to.set(arc.end);
      return;
    }
    from.set(withTiming(arc.start, { duration: MORPH_MS, easing: EASE }));
    to.set(withTiming(arc.end, { duration: MORPH_MS, easing: EASE }));
  }, [arc.start, arc.end, reduced, from, to]);
  const props = useAnimatedProps(() => {
    const shown = reveal.get();
    const a = Math.min(from.get(), shown);
    const b = Math.min(to.get(), shown);
    const length = Math.max(0, b - a) * circumference;
    return {
      strokeDasharray: [length, circumference],
      strokeDashoffset: -a * circumference,
      strokeOpacity: length > 0.5 ? 1 : 0,
    };
  });
  return (
    <AnimatedCircle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      stroke={arc.color}
      strokeWidth={stroke}
      strokeLinecap="butt"
      fill="none"
      animatedProps={props}
    />
  );
}

export function DonutChart({
  arcs,
  totalLabel,
  caption,
  size = 168,
  stroke = 18,
}: {
  arcs: readonly DonutArc[];
  totalLabel?: string;
  caption?: string;
  size?: number;
  stroke?: number;
}) {
  const reduced = useReducedMotion();
  const track = String(useCSSVariable("--openbot-border-grouped") ?? "#88888833");
  const reveal = useSharedValue(reduced ? 1 : 0);
  const hasData = arcs.some((arc) => arc.end > arc.start);
  useEffect(() => {
    if (!hasData) return;
    if (reduced) reveal.set(1);
    else if (reveal.get() < 1) reveal.set(withTiming(1, { duration: FILL_MS, easing: EASE }));
  }, [hasData, reduced, reveal]);
  const radius = (size - stroke) / 2;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center self-center">
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          {arcs.map((arc) => (
            <Arc key={arc.key} arc={arc} size={size} stroke={stroke} reveal={reveal} reduced={reduced} />
          ))}
        </G>
      </Svg>
      {totalLabel ? (
        <Typography type="h4" className="text-foreground" numberOfLines={1}>
          {totalLabel}
        </Typography>
      ) : null}
      {caption ? (
        <Typography type="body-xs" className="max-w-28 text-center text-grouped-secondary" numberOfLines={2}>
          {caption}
        </Typography>
      ) : null}
    </View>
  );
}
