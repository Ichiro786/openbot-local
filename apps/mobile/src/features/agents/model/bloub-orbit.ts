import { BotEngine } from "@norbert_bodziony/bloub";
import { Skia, type SkPath } from "@shopify/react-native-skia";
import { Platform } from "react-native";
import { makeMutable } from "react-native-reanimated";

const ORBIT_FPS = Platform.OS === "android" ? 120 : 30;
export const ORBIT_CYCLE = 3.6;
const ORBIT_START = 1.2;
const FRAME_TOTAL = Math.round(ORBIT_CYCLE * ORBIT_FPS);
const BATCH = Platform.OS === "android" ? 16 : 6;

export interface OrbitRing {
  id: string;
  width: number;
  gradient: { x1: number; y1: number; x2: number; y2: number; stops: string[] };
}

export interface OrbitArc {
  front: SkPath | null;
  back: SkPath | null;
  opacity: number;
}

const NO_ARC: OrbitArc = { front: null, back: null, opacity: 0 };

let rings: OrbitRing[] | null = null;

export function orbitRings(): OrbitRing[] {
  rings ??= new BotEngine(100, "orbit")
    .sample(ORBIT_START)
    .arcs.map((arc) => ({ id: arc.id, width: arc.width, gradient: arc.grad }));
  return rings;
}

export const orbitFrames = makeMutable<OrbitArc[][]>([]);

let preparing = false;

export function prepareOrbitFrames(): void {
  if (preparing) return;
  preparing = true;
  const ids = orbitRings().map((ring) => ring.id);
  const engine = new BotEngine(100, "orbit");
  const frames: OrbitArc[][] = [];
  const batch = () => {
    for (let count = 0; count < BATCH && frames.length < FRAME_TOTAL; count += 1) {
      const arcs = engine.sample(frames.length / ORBIT_FPS).arcs;
      frames.push(
        ids.map((id) => {
          const arc = arcs.find((candidate) => candidate.id === id);
          return arc
            ? {
                front: arc.front ? Skia.Path.MakeFromSVGString(arc.front) : null,
                back: arc.back ? Skia.Path.MakeFromSVGString(arc.back) : null,
                opacity: arc.opacity,
              }
            : NO_ARC;
        }),
      );
    }
    if (frames.length < FRAME_TOTAL) requestIdleCallback(batch);
    else orbitFrames.set(frames);
  };
  requestIdleCallback(batch);
}

export function orbitFrameIndex(clock: number, count: number): number {
  "worklet";
  return Math.floor(((clock + ORBIT_START) % ORBIT_CYCLE) * ORBIT_FPS) % count;
}
