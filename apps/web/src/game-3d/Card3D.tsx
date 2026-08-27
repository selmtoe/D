import { RoundedBox } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Color,
  Plane,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Object3D,
} from "three";
import type { CardView } from "../app/model";
import { isCourtRank, standardPipLayout, type PipPlacement } from "./cardDesign";

const suitSymbol = { spade: "♠", heart: "♥", diamond: "♦", club: "♣" } as const;
type PointerCaptureTarget = EventTarget & {
  setPointerCapture?: (pointerId: number) => void;
  hasPointerCapture?: (pointerId: number) => boolean;
  releasePointerCapture?: (pointerId: number) => void;
};

function capturePointer(target: PointerCaptureTarget | undefined, pointerId: number): void {
  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    // A synthetic or cancelled pointer may no longer be capturable.
  }
}

function releasePointer(target: PointerCaptureTarget | undefined, pointerId: number): void {
  try {
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
  } catch {
    // Pointer capture can disappear before pointercancel reaches React Three Fiber.
  }
}

export function dragPointInParentSpace(
  parent: Object3D | null | undefined,
  worldPoint: Vector3,
): [number, number, number] {
  const localPoint = worldPoint.clone();
  parent?.worldToLocal(localPoint);
  return [localPoint.x, localPoint.y, localPoint.z];
}

export function hitAreaCounterRotation(
  rotation: readonly [number, number, number],
): [number, number, number] {
  return [0, 0, -rotation[2]];
}

function CardProjectionProbe({ dataAttribute }: { dataAttribute: string }) {
  const marker = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const point = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!marker.current) return;
    marker.current.getWorldPosition(point).project(camera);
    gl.domElement.setAttribute(
      dataAttribute,
      `${(((point.x + 1) * size.width) / 2).toFixed(2)},${(((1 - point.y) * size.height) / 2).toFixed(2)}`,
    );
  });
  useEffect(
    () => () => {
      gl.domElement.removeAttribute(dataAttribute);
    },
    [dataAttribute, gl],
  );
  return <group ref={marker} />;
}

type VisibleCardAppearance = Extract<CardView, { visibility: "face" }>;

function drawPip(ctx: CanvasRenderingContext2D, symbol: string, placement: PipPlacement): void {
  ctx.save();
  ctx.translate(placement.x, placement.y);
  if (placement.upsideDown) ctx.rotate(Math.PI);
  ctx.scale(placement.scale ?? 1, placement.scale ?? 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "52px ui-serif, serif";
  ctx.fillText(symbol, 0, 0);
  ctx.restore();
}

function drawCornerIndex(
  ctx: CanvasRenderingContext2D,
  rank: string,
  symbol: string,
  x: number,
  y: number,
  upsideDown: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (upsideDown) ctx.rotate(Math.PI);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${rank === "10" ? 38 : 46}px ui-serif, serif`;
  ctx.fillText(rank, 0, 0);
  ctx.font = "32px ui-serif, serif";
  ctx.fillText(symbol, 0, 38);
  ctx.restore();
}

function drawCourtCard(ctx: CanvasRenderingContext2D, rank: "J" | "Q" | "K", symbol: string): void {
  ctx.save();
  ctx.fillStyle = "#e7d7aa";
  ctx.fillRect(62, 86, 132, 212);
  ctx.strokeStyle = "#b28a3b";
  ctx.lineWidth = 5;
  ctx.strokeRect(62, 86, 132, 212);
  ctx.fillStyle = "#183b4a";
  ctx.fillRect(70, 94, 116, 94);
  ctx.fillStyle = "#7f2940";
  ctx.fillRect(70, 196, 116, 94);
  ctx.fillStyle = "#f4df99";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 74px ui-serif, serif";
  ctx.fillText(rank, 128, 164);
  ctx.save();
  ctx.translate(128, 220);
  ctx.rotate(Math.PI);
  ctx.fillText(rank, 0, 0);
  ctx.restore();
  ctx.fillStyle = "#f7f1df";
  ctx.font = "42px ui-serif, serif";
  ctx.fillText(symbol, 128, 112);
  ctx.save();
  ctx.translate(128, 272);
  ctx.rotate(Math.PI);
  ctx.fillText(symbol, 0, 0);
  ctx.restore();
  ctx.restore();
}

function cardTexture(
  visibility: CardView["visibility"],
  suit: VisibleCardAppearance["suit"],
  rank: VisibleCardAppearance["rank"],
  joker: VisibleCardAppearance["joker"],
  mimicSuit: NonNullable<VisibleCardAppearance["mimic"]>["suit"] | undefined,
  mimicRank: NonNullable<VisibleCardAppearance["mimic"]>["rank"] | undefined,
  blind: boolean,
  back: boolean,
  mirrored = false,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    fallback.colorSpace = SRGBColorSpace;
    fallback.anisotropy = 1;
    return fallback;
  }
  if (mirrored) {
    // The physical back plane is rotated by PI around Y. Pre-mirroring its
    // texture keeps spectator-authorized face text readable from that side.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = back ? "#123f32" : "#f7f1df";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (back) {
    ctx.strokeStyle = "#d7b668";
    ctx.lineWidth = 9;
    ctx.strokeRect(18, 18, 220, 348);
    ctx.lineWidth = 2;
    for (let x = -400; x < 500; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 384, 384);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, 384);
      ctx.lineTo(x + 384, 0);
      ctx.stroke();
    }
    ctx.font = "700 38px serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#d7b668";
    ctx.fillText("大富豪", 128, 205);
  } else if (visibility === "face") {
    const isRed = suit === "heart" || suit === "diamond" || joker === "crimson";
    ctx.fillStyle = isRed ? "#a52535" : "#111720";
    ctx.textAlign = "left";
    ctx.font = "700 54px ui-serif, serif";
    if (joker) {
      ctx.fillText("J", 22, 68);
      ctx.font = "800 46px ui-serif, serif";
      ctx.textAlign = "center";
      ctx.fillText(joker === "crimson" ? "JOKER II" : "JOKER I", 128, 205);
      ctx.beginPath();
      ctx.arc(128, 260, 42, 0, Math.PI * 2);
      ctx.strokeStyle = "#d7b668";
      ctx.lineWidth = 7;
      ctx.stroke();
      if (mimicSuit && mimicRank) {
        ctx.font = "800 30px ui-serif, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = mimicSuit === "heart" || mimicSuit === "diamond" ? "#a52535" : "#111720";
        ctx.fillText(`${suitSymbol[mimicSuit]}${mimicRank}`, 128, blind ? 304 : 344);
      }
    } else {
      const symbol = suit ? suitSymbol[suit] : "";
      drawCornerIndex(ctx, rank ?? "", symbol, 28, 42, false);
      drawCornerIndex(ctx, rank ?? "", symbol, 228, 342, true);
      if (isCourtRank(rank)) drawCourtCard(ctx, rank, symbol);
      else if (rank)
        standardPipLayout(rank).forEach((placement) => drawPip(ctx, symbol, placement));
    }
    if (blind) {
      ctx.fillStyle = "rgba(8,23,21,.88)";
      ctx.fillRect(38, 310, 180, 42);
      ctx.fillStyle = "#f5d984";
      ctx.textAlign = "center";
      ctx.font = "700 22px sans-serif";
      ctx.fillText("BLIND", 128, 339);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function Card3D({
  card,
  position = [0, 0, 0],
  rotation = [-Math.PI / 2, 0, 0],
  selected = false,
  dimmed = false,
  hidden = false,
  onSelect,
  scale = 1,
  renderOrder = 0,
  selectedLift = 0.18,
  selectedDepth = 0,
  dragPlaneY = 1.15,
  onDragStart,
  onDragEnd,
  hitAreaWidth,
  hitAreaHeight,
  hitAreaOffsetX = 0,
  e2eProjectionAttribute,
  faceVisibleFromBack = false,
}: {
  card: CardView;
  position?: [number, number, number];
  rotation?: [number, number, number];
  selected?: boolean;
  dimmed?: boolean;
  hidden?: boolean;
  onSelect?: () => void;
  scale?: number;
  renderOrder?: number;
  selectedLift?: number;
  selectedDepth?: number;
  dragPlaneY?: number;
  onDragStart?: (() => void) | undefined;
  onDragEnd?: ((point: [number, number, number]) => void) | undefined;
  hitAreaWidth?: number | undefined;
  hitAreaHeight?: number | undefined;
  hitAreaOffsetX?: number | undefined;
  e2eProjectionAttribute?: string | undefined;
  faceVisibleFromBack?: boolean | undefined;
}) {
  const root = useRef<Group>(null);
  const dragging = useRef<number | null>(null);
  const captureTarget = useRef<PointerCaptureTarget | undefined>(undefined);
  const [dragPosition, setDragPosition] = useState<[number, number, number]>();
  const dragPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), -dragPlaneY), [dragPlaneY]);
  const dragPoint = useMemo(() => new Vector3(), []);
  const visibility = card.visibility;
  const suit = card.visibility === "face" ? card.suit : undefined;
  const rank = card.visibility === "face" ? card.rank : undefined;
  const joker = card.visibility === "face" ? card.joker : undefined;
  const mimicSuit = card.visibility === "face" ? card.mimic?.suit : undefined;
  const mimicRank = card.visibility === "face" ? card.mimic?.rank : undefined;
  const blind = card.blind;
  const front = useMemo(
    () =>
      cardTexture(
        visibility,
        suit,
        rank,
        joker,
        mimicSuit,
        mimicRank,
        blind,
        visibility === "hidden",
      ),
    [blind, joker, mimicRank, mimicSuit, rank, suit, visibility],
  );
  const back = useMemo(() => {
    if (faceVisibleFromBack && visibility === "face") {
      return cardTexture(visibility, suit, rank, joker, mimicSuit, mimicRank, blind, false, true);
    }
    return cardTexture(
      "hidden",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      true,
    );
  }, [blind, faceVisibleFromBack, joker, mimicRank, mimicSuit, rank, suit, visibility]);
  useEffect(
    () => () => {
      front.dispose();
      back.dispose();
    },
    [back, front],
  );
  const inactive = dimmed && !selected;
  const edge = selected ? "#f4d47f" : inactive ? "#242827" : "#d8cfb8";
  const restingPosition: [number, number, number] = [
    position[0],
    position[1] + (selected ? selectedLift : 0),
    position[2] + (selected ? selectedDepth : 0),
  ];
  return (
    <group
      ref={root}
      renderOrder={renderOrder}
      visible={!hidden}
      position={dragPosition ?? restingPosition}
      rotation={rotation}
      scale={scale}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (inactive) return;
        if (onDragEnd) {
          if (dragging.current !== null) return;
          dragging.current = event.pointerId;
          captureTarget.current = event.target as PointerCaptureTarget;
          capturePointer(captureTarget.current, event.pointerId);
          onDragStart?.();
        } else {
          onSelect?.();
        }
      }}
      onPointerMove={(event) => {
        if (dragging.current !== event.pointerId) return;
        event.stopPropagation();
        if (event.ray.intersectPlane(dragPlane, dragPoint)) {
          setDragPosition(dragPointInParentSpace(root.current?.parent, dragPoint));
        }
      }}
      onPointerUp={(event) => {
        if (dragging.current !== event.pointerId) return;
        event.stopPropagation();
        dragging.current = null;
        releasePointer(captureTarget.current, event.pointerId);
        const finalPoint = event.ray.intersectPlane(dragPlane, dragPoint)
          ? ([dragPoint.x, dragPlaneY, dragPoint.z] as [number, number, number])
          : root.current
            ? (root.current.getWorldPosition(dragPoint).toArray() as [number, number, number])
            : (dragPosition ?? restingPosition);
        setDragPosition(undefined);
        captureTarget.current = undefined;
        onDragEnd?.(finalPoint);
      }}
      onPointerCancel={(event) => {
        if (dragging.current !== event.pointerId) return;
        event.stopPropagation();
        dragging.current = null;
        releasePointer(captureTarget.current, event.pointerId);
        captureTarget.current = undefined;
        setDragPosition(undefined);
      }}
    >
      {e2eProjectionAttribute && <CardProjectionProbe dataAttribute={e2eProjectionAttribute} />}
      {(onDragEnd || onSelect) && (
        <group rotation={hitAreaCounterRotation(rotation)}>
          <mesh position={[hitAreaOffsetX, 0, 0.065]} renderOrder={renderOrder + 1}>
            <planeGeometry
              args={[
                hitAreaWidth ?? (onDragEnd ? 1.72 : 1.22),
                hitAreaHeight ?? (onDragEnd ? 2.24 : 2.32),
              ]}
            />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        </group>
      )}
      <RoundedBox
        raycast={() => undefined}
        renderOrder={renderOrder}
        args={[1.22, 1.78, 0.075]}
        radius={0.08}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={new Color(edge)}
          roughness={0.48}
          metalness={0.02}
          transparent={inactive}
          opacity={inactive ? 0.55 : 1}
        />
      </RoundedBox>
      <mesh raycast={() => undefined} renderOrder={renderOrder} position={[0, 0, 0.0405]}>
        <planeGeometry args={[1.13, 1.68]} />
        <meshStandardMaterial
          map={front}
          color={inactive ? "#313534" : "#ffffff"}
          roughness={0.55}
          transparent={inactive}
          opacity={inactive ? 0.42 : 1}
        />
      </mesh>
      <mesh
        raycast={() => undefined}
        renderOrder={renderOrder}
        position={[0, 0, -0.0405]}
        rotation={[0, Math.PI, 0]}
      >
        <planeGeometry args={[1.13, 1.68]} />
        <meshStandardMaterial
          map={back}
          color={inactive ? "#313534" : "#ffffff"}
          roughness={0.55}
          transparent={inactive}
          opacity={inactive ? 0.42 : 1}
        />
      </mesh>
    </group>
  );
}
