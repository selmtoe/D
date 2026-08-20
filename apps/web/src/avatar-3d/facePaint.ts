import {
  FACE_PAINT_LIMITS,
  validateFacePaint,
  type FacePaintLayer,
  type FacePaintPoint,
  type FacePaintStroke,
} from "@daifugo/avatar-schema";

export const emptyFacePaint = (): FacePaintLayer => ({ version: 1, strokes: [] });

export function normalizedFacePaintPoint(x: number, y: number): FacePaintPoint {
  const safeX = Number.isFinite(x) ? x : 0.5;
  const safeY = Number.isFinite(y) ? y : 0.5;
  return {
    x: Math.round(Math.max(0, Math.min(1, safeX)) * 10_000) / 10_000,
    y: Math.round(Math.max(0, Math.min(1, safeY)) * 10_000) / 10_000,
  };
}

export function appendFacePaintStroke(
  layer: FacePaintLayer | undefined,
  stroke: FacePaintStroke,
): FacePaintLayer {
  const next = {
    version: 1 as const,
    strokes: [...(layer?.strokes ?? []), stroke],
  };
  return validateFacePaint(next);
}

export function undoFacePaintStroke(layer: FacePaintLayer | undefined): FacePaintLayer | undefined {
  if (!layer?.strokes.length) return undefined;
  const strokes = layer.strokes.slice(0, -1);
  return strokes.length ? { version: 1, strokes: structuredClone(strokes) } : undefined;
}

export function canAddFacePaintPoint(
  layer: FacePaintLayer | undefined,
  activePoints: number,
): boolean {
  const total = (layer?.strokes ?? []).reduce((sum, stroke) => sum + stroke.points.length, 0);
  return (
    activePoints < FACE_PAINT_LIMITS.maxPointsPerStroke &&
    total + activePoints < FACE_PAINT_LIMITS.maxTotalPoints
  );
}

export interface FacePaintBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Replays a validated layer onto a transparent 2D surface. */
export function drawFacePaintLayer(
  context: CanvasRenderingContext2D,
  layer: FacePaintLayer | undefined,
  bounds: FacePaintBounds,
  activeStroke?: FacePaintStroke,
): void {
  const strokes = activeStroke ? [...(layer?.strokes ?? []), activeStroke] : (layer?.strokes ?? []);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    const points = stroke.points;
    if (!points.length) continue;
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = Math.max(1, stroke.width * bounds.width);
    const first = points[0]!;
    const startX = bounds.x + first.x * bounds.width;
    const startY = bounds.y + first.y * bounds.height;
    if (points.length === 1) {
      context.beginPath();
      context.arc(startX, startY, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(startX, startY);
    for (const point of points.slice(1)) {
      context.lineTo(bounds.x + point.x * bounds.width, bounds.y + point.y * bounds.height);
    }
    context.stroke();
  }
  context.restore();
}

/**
 * Builds an equirectangular transparent face overlay. SphereGeometry's +Z face
 * is centred around U=0.25, so the drawing is confined to the visible facial patch.
 */
export function createFacePaintCanvas(layer: FacePaintLayer): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    drawFacePaintLayer(context, layer, {
      x: canvas.width * 0.09,
      y: canvas.height * 0.16,
      width: canvas.width * 0.32,
      height: canvas.height * 0.7,
    });
  }
  return canvas;
}
