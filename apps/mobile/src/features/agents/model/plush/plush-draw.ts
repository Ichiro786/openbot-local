import {
  BlendMode,
  FilterMode,
  MipmapMode,
  PaintStyle,
  type SkCanvas,
  type SkHostRect,
  type SkImage,
  Skia,
  type SkPaint,
  type SkPathBuilder,
  type SkPicture,
  type SkPictureRecorder,
  StrokeCap,
  StrokeJoin,
} from "@shopify/react-native-skia";
import {
  CLOSED_EYE_BEND,
  CLOSED_EYE_COLOR,
  CLOSED_EYE_STROKE,
  HALF_VIEW_BOX,
  type Matrix,
  type PlushBall,
  type PlushEye,
  type PlushZ,
  VIEW_BOX,
} from "./plush-felt";
import type { PlushFrame } from "./plush-frames";

export interface PlushArt {
  body: SkImage;
  padX: SkImage;
  padY: SkImage;
  dot: SkImage;
  notif: SkImage;
  ink: string;
}

interface PlushDrawKit {
  plain: SkPaint;
  alpha: SkPaint;
  plus: SkPaint;
  mask: SkPaint;
  band: SkPaint;
  line: SkPaint;
  stroke: SkPaint;
  strokeInk: string | null;
  grey: SkPaint;
  greySaturation: number | null;
  source: SkHostRect;
  target: SkHostRect;
  bandRect: { rect: SkHostRect; rx: number; ry: number };
  matrix: number[];
  eyeMatrix: MutableMatrix;
  innerMatrix: MutableMatrix;
  ball: PlushBall;
  z: PlushZ;
  path: SkPathBuilder;
  recorder: SkPictureRecorder;
  bounds: SkHostRect;
}

type MutableMatrix = [number, number, number, number, number, number];

declare global {
  var openbotPlushDrawKit: PlushDrawKit | undefined;
}

function makeDrawKit(): PlushDrawKit {
  "worklet";
  const plus = Skia.Paint();
  plus.setBlendMode(BlendMode.Plus);
  const mask = Skia.Paint();
  mask.setBlendMode(BlendMode.DstIn);
  const band = Skia.Paint();
  band.setAntiAlias(true);
  band.setColor(Skia.Color("white"));
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeCap(StrokeCap.Round);
  line.setColor(Skia.Color(CLOSED_EYE_COLOR));
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  return {
    plain: Skia.Paint(),
    alpha: Skia.Paint(),
    plus,
    mask,
    band,
    line,
    stroke,
    strokeInk: null,
    grey: Skia.Paint(),
    greySaturation: null,
    source: Skia.XYWHRect(0, 0, 0, 0),
    target: Skia.XYWHRect(0, 0, 0, 0),
    bandRect: { rect: Skia.XYWHRect(0, 0, 0, 0), rx: 0, ry: 0 },
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    eyeMatrix: [1, 0, 0, 1, 0, 0],
    innerMatrix: [1, 0, 0, 1, 0, 0],
    ball: { x: 0, y: 0, size: 0, opacity: 0 },
    z: { x: 0, y: 0, half: 0, width: 0, opacity: 0 },
    path: Skia.PathBuilder.Make(),
    recorder: Skia.PictureRecorder(),
    bounds: Skia.XYWHRect(0, 0, 0, 0),
  };
}

function drawKit(): PlushDrawKit {
  "worklet";
  let kit = globalThis.openbotPlushDrawKit;
  if (!kit) {
    kit = makeDrawKit();
    globalThis.openbotPlushDrawKit = kit;
  }
  return kit;
}

function concat(canvas: SkCanvas, kit: PlushDrawKit, [a, b, c, d, e, f]: Matrix) {
  "worklet";
  const values = kit.matrix;
  values[0] = a;
  values[1] = c;
  values[2] = e;
  values[3] = b;
  values[4] = d;
  values[5] = f;
  canvas.concat(values);
}

function alphaPaint(kit: PlushDrawKit, opacity: number): SkPaint {
  "worklet";
  kit.alpha.setAlphaf(opacity);
  return kit.alpha;
}

function drawPicture(
  canvas: SkCanvas,
  kit: PlushDrawKit,
  image: SkImage,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: SkPaint,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
) {
  "worklet";
  const imageWidth = image.width();
  const imageHeight = image.height();
  kit.source.setXYWH(sx * imageWidth, sy * imageHeight, sw * imageWidth, sh * imageHeight);
  kit.target.setXYWH(x, y, width, height);
  canvas.drawImageRectOptions(image, kit.source, kit.target, FilterMode.Linear, MipmapMode.Linear, paint);
}

function blendNumber(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

function blendAlpha(a: number, b: number, t: number): number {
  "worklet";
  return Math.max(0, Math.min(1, blendNumber(a, b, t)));
}

function blendMatrix(a: Matrix, b: Matrix, t: number, target: MutableMatrix): Matrix {
  "worklet";
  const detA = a[0] * a[3] - a[1] * a[2];
  const detB = b[0] * b[3] - b[1] * b[2];
  let angle = Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  else if (angle < -Math.PI) angle += 2 * Math.PI;
  if (detA * detB <= 0 || Math.abs(angle) > 0.2618) return t < 0.5 ? a : b;
  target[0] = blendNumber(a[0], b[0], t);
  target[1] = blendNumber(a[1], b[1], t);
  target[2] = blendNumber(a[2], b[2], t);
  target[3] = blendNumber(a[3], b[3], t);
  target[4] = blendNumber(a[4], b[4], t);
  target[5] = blendNumber(a[5], b[5], t);
  return target;
}

function blendBall(a: PlushBall, b: PlushBall, t: number, target: PlushBall, guard: boolean): PlushBall {
  "worklet";
  if (guard && Math.hypot(b.x - a.x, b.y - a.y) > VIEW_BOX * 0.25) return t < 0.5 ? a : b;
  target.x = blendNumber(a.x, b.x, t);
  target.y = blendNumber(a.y, b.y, t);
  target.size = blendNumber(a.size, b.size, t);
  target.opacity = blendNumber(a.opacity, b.opacity, t);
  return target;
}

function blendNotif(a: PlushBall | null, b: PlushBall | null, t: number, target: PlushBall): PlushBall | null {
  "worklet";
  if (a && b) return blendBall(a, b, t, target, false);
  const ball = a ?? b;
  if (!ball) return null;
  target.x = ball.x;
  target.y = ball.y;
  target.size = ball.size;
  target.opacity = ball.opacity * (a ? 1 - t : t);
  return target;
}

function blendZ(a: PlushZ, b: PlushZ, t: number, target: PlushZ): PlushZ {
  "worklet";
  if (Math.hypot(b.x - a.x, b.y - a.y) > VIEW_BOX * 0.25) return t < 0.5 ? a : b;
  target.x = blendNumber(a.x, b.x, t);
  target.y = blendNumber(a.y, b.y, t);
  target.half = blendNumber(a.half, b.half, t);
  target.width = blendNumber(a.width, b.width, t);
  target.opacity = blendNumber(a.opacity, b.opacity, t);
  return target;
}

function drawEye(canvas: SkCanvas, kit: PlushDrawKit, eye: PlushEye, art: PlushArt, to = eye, t = 0) {
  "worklet";
  const blending = t > 0 && eye !== to;
  const nearest = t < 0.5 ? eye : to;
  const matrix = blending ? blendMatrix(eye.matrix, to.matrix, t, kit.eyeMatrix) : eye.matrix;
  const inner =
    blending && eye.inner && to.inner
      ? blendMatrix(eye.inner, to.inner, t, kit.innerMatrix)
      : blending
        ? nearest.inner
        : eye.inner;
  const alpha = blending ? blendAlpha(eye.alpha, to.alpha, t) : eye.alpha;
  const opacity = alpha * (blending ? nearest.pad : eye.pad);
  const pieces = blending ? nearest.pieces : eye.pieces;
  const blendLid = blending && eye.lid && to.lid && eye.lid.bands.length === to.lid.bands.length;
  const lid = blendLid ? eye.lid : blending ? nearest.lid : eye.lid;
  const nextLid = blendLid ? to.lid : null;
  if (opacity > 0.001) {
    if (lid) canvas.saveLayer();
    canvas.save();
    concat(canvas, kit, matrix);
    if (inner) concat(canvas, kit, inner);
    canvas.saveLayer(alphaPaint(kit, opacity));
    const piecePaint = pieces.length > 1 ? kit.plus : kit.plain;
    for (const piece of pieces) {
      const image = piece.src === 0 ? art.padX : art.padY;
      drawPicture(
        canvas,
        kit,
        image,
        piece.x,
        piece.y,
        piece.w,
        piece.h,
        piecePaint,
        piece.sx,
        piece.sy,
        piece.sw,
        piece.sh,
      );
    }
    canvas.restore();
    canvas.restore();
    if (lid) {
      const cx = nextLid ? blendNumber(lid.cx, nextLid.cx, t) : lid.cx;
      const cy = nextLid ? blendNumber(lid.cy, nextLid.cy, t) : lid.cy;
      const s = nextLid ? blendNumber(lid.s, nextLid.s, t) : lid.s;
      canvas.saveLayer(kit.mask);
      canvas.translate(cx, cy);
      canvas.scale(1, s);
      canvas.translate(-cx, -cy);
      concat(canvas, kit, matrix);
      if (inner) concat(canvas, kit, inner);
      const band = kit.bandRect;
      for (let index = 0; index < lid.bands.length; index += 1) {
        const fromBand = lid.bands[index];
        if (!fromBand) continue;
        const toBand = nextLid?.bands[index];
        const w = toBand ? blendNumber(fromBand.w, toBand.w, t) : fromBand.w;
        const h = toBand ? blendNumber(fromBand.h, toBand.h, t) : fromBand.h;
        const r = toBand ? blendNumber(fromBand.r, toBand.r, t) : fromBand.r;
        kit.band.setAlphaf(toBand ? blendNumber(fromBand.alpha, toBand.alpha, t) : fromBand.alpha);
        band.rect.setXYWH(-w, -h, 2 * w, 2 * h);
        band.rx = r;
        band.ry = r;
        canvas.drawRRect(band, kit.band);
      }
      canvas.restore();
      canvas.restore();
    }
  }
  const closed = eye.closed ?? (blending ? to.closed : null);
  if (closed) {
    const w = blending && eye.closed && to.closed ? blendNumber(eye.closed.w, to.closed.w, t) : closed.w;
    const closedOpacity = blending ? blendNumber(eye.closed?.opacity ?? 0, to.closed?.opacity ?? 0, t) : closed.opacity;
    if (closedOpacity <= 0.001) return;
    const line = kit.line;
    line.setStrokeWidth(w * CLOSED_EYE_STROKE);
    line.setAlphaf(alpha * closedOpacity);
    canvas.save();
    concat(canvas, kit, matrix);
    canvas.drawPath(
      kit.path
        .reset()
        .moveTo(-w / 2, 0)
        .quadTo(0, w * CLOSED_EYE_BEND, w / 2, 0)
        .build(),
      line,
    );
    canvas.restore();
  }
}

export function saturationMatrix(s: number): number[] {
  "worklet";
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

export function drawPlush(
  canvas: SkCanvas,
  frame: PlushFrame,
  art: PlushArt,
  size: number,
  saturation = 1,
  to = frame,
  t = 0,
) {
  "worklet";
  const kit = drawKit();
  const blending = t > 0 && frame !== to;
  const nearest = t < 0.5 ? frame : to;
  const scale = size / VIEW_BOX;
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(scale, scale);
  const grey = saturation < 1;
  if (grey) {
    if (kit.greySaturation !== saturation) {
      kit.grey.setColorFilter(Skia.ColorFilter.MakeMatrix(saturationMatrix(saturation)));
      kit.greySaturation = saturation;
    }
    canvas.saveLayer(kit.grey);
  }
  const bodyAlpha = blending ? blendAlpha(frame.bodyAlpha, to.bodyAlpha, t) : frame.bodyAlpha;
  const faded = bodyAlpha < 1;
  if (faded) canvas.saveLayer(alphaPaint(kit, bodyAlpha));
  drawPicture(canvas, kit, art.body, -HALF_VIEW_BOX, -HALF_VIEW_BOX, VIEW_BOX, VIEW_BOX, kit.plain, 0, 0, 1, 1);
  const blendEyes = blending && frame.eyes.length === to.eyes.length;
  const eyes = blending && !blendEyes ? nearest.eyes : frame.eyes;
  for (let index = 0; index < eyes.length; index += 1) {
    const eye = eyes[index];
    if (eye) drawEye(canvas, kit, eye, art, blendEyes ? to.eyes[index] : eye, blendEyes ? t : 0);
  }
  if (faded) canvas.restore();
  const blendDots = blending && frame.dots.length === to.dots.length;
  const dots = blending && !blendDots ? nearest.dots : frame.dots;
  for (let index = 0; index < dots.length; index += 1) {
    const fromDot = dots[index];
    if (!fromDot) continue;
    const toDot = blendDots ? to.dots[index] : null;
    const dot = toDot ? blendBall(fromDot, toDot, t, kit.ball, true) : fromDot;
    drawPicture(canvas, kit, art.dot, dot.x, dot.y, dot.size, dot.size, alphaPaint(kit, dot.opacity), 0, 0, 1, 1);
  }
  const notif = blending ? blendNotif(frame.notif, to.notif, t, kit.ball) : frame.notif;
  if (notif && notif.opacity > 0.001) {
    const { x, y, size: ball } = notif;
    drawPicture(canvas, kit, art.notif, x, y, ball, ball, alphaPaint(kit, notif.opacity), 0, 0, 1, 1);
  }
  const blendZs = blending && frame.zs.length === to.zs.length;
  const zs = blending && !blendZs ? nearest.zs : frame.zs;
  if (zs.length > 0) {
    const stroke = kit.stroke;
    if (kit.strokeInk !== art.ink) {
      stroke.setColor(Skia.Color(art.ink));
      kit.strokeInk = art.ink;
    }
    for (let index = 0; index < zs.length; index += 1) {
      const fromZ = zs[index];
      if (!fromZ) continue;
      const toZ = blendZs ? to.zs[index] : null;
      const z = toZ ? blendZ(fromZ, toZ, t, kit.z) : fromZ;
      stroke.setStrokeWidth(z.width);
      stroke.setAlphaf(z.opacity);
      const path = kit.path
        .reset()
        .moveTo(z.x - z.half, z.y - z.half)
        .lineTo(z.x + z.half, z.y - z.half)
        .lineTo(z.x - z.half, z.y + z.half)
        .lineTo(z.x + z.half, z.y + z.half)
        .build();
      canvas.drawPath(path, stroke);
    }
  }
  if (grey) canvas.restore();
  canvas.restore();
}

export function recordPlush(
  from: PlushFrame | undefined,
  to: PlushFrame | undefined,
  t: number,
  art: PlushArt | null,
  size: number,
  saturation: number,
): SkPicture {
  "worklet";
  const kit = drawKit();
  kit.bounds.setXYWH(0, 0, size, size);
  const canvas = kit.recorder.beginRecording(kit.bounds);
  if (art && from) {
    if (t <= 0 || from === to || !to) drawPlush(canvas, from, art, size, saturation);
    else drawPlush(canvas, from, art, size, saturation, to, t);
  }
  return kit.recorder.finishRecordingAsPicture();
}
