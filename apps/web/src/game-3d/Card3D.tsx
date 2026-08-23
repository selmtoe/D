import { RoundedBox } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, Color, Plane, SRGBColorSpace, Vector3, type Group } from "three";
import type { CardView } from "../app/model";

const suitSymbol = { spade: "♠", heart: "♥", diamond: "♦", club: "♣" } as const;
type PointerCaptureTarget = EventTarget & {
  setPointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  releasePointerCapture: (pointerId: number) => void;
};

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

function cardTexture(
  visibility: CardView["visibility"],
  suit: VisibleCardAppearance["suit"],
  rank: VisibleCardAppearance["rank"],
  joker: VisibleCardAppearance["joker"],
  blind: boolean,
  back: boolean,
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
    } else {
      const symbol = suit ? suitSymbol[suit] : "";
      ctx.fillText(rank ?? "", 22, 68);
      ctx.font = "46px serif";
      ctx.fillText(symbol, 24, 116);
      ctx.textAlign = "center";
      ctx.font = "116px serif";
      ctx.fillText(symbol, 128, 244);
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
  expandedHitArea = false,
  e2eProjectionAttribute,
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
  expandedHitArea?: boolean | undefined;
  e2eProjectionAttribute?: string | undefined;
}) {
  const dragging = useRef(false);
  const captureTarget = useRef<PointerCaptureTarget | undefined>(undefined);
  const [dragPosition, setDragPosition] = useState<[number, number, number]>();
  const dragPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), -dragPlaneY), [dragPlaneY]);
  const dragPoint = useMemo(() => new Vector3(), []);
  const visibility = card.visibility;
  const suit = card.visibility === "face" ? card.suit : undefined;
  const rank = card.visibility === "face" ? card.rank : undefined;
  const joker = card.visibility === "face" ? card.joker : undefined;
  const blind = card.blind;
  const front = useMemo(
    () => cardTexture(visibility, suit, rank, joker, blind, visibility === "hidden"),
    [blind, joker, rank, suit, visibility],
  );
  const back = useMemo(
    () => cardTexture("hidden", undefined, undefined, undefined, false, true),
    [],
  );
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
      renderOrder={renderOrder}
      visible={!hidden}
      position={dragPosition ?? restingPosition}
      rotation={rotation}
      scale={scale}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (inactive) return;
        if (onDragEnd) {
          dragging.current = true;
          captureTarget.current = event.target as PointerCaptureTarget;
          captureTarget.current?.setPointerCapture(event.pointerId);
          onDragStart?.();
        } else {
          onSelect?.();
        }
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        if (event.ray.intersectPlane(dragPlane, dragPoint)) {
          setDragPosition([dragPoint.x, dragPlaneY, dragPoint.z]);
        }
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        dragging.current = false;
        if (captureTarget.current?.hasPointerCapture(event.pointerId)) {
          captureTarget.current.releasePointerCapture(event.pointerId);
        }
        const finalPoint = event.ray.intersectPlane(dragPlane, dragPoint)
          ? ([dragPoint.x, dragPlaneY, dragPoint.z] as [number, number, number])
          : (dragPosition ?? restingPosition);
        setDragPosition(undefined);
        captureTarget.current = undefined;
        onDragEnd?.(finalPoint);
      }}
      onPointerCancel={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        dragging.current = false;
        if (captureTarget.current?.hasPointerCapture(event.pointerId)) {
          captureTarget.current.releasePointerCapture(event.pointerId);
        }
        captureTarget.current = undefined;
        setDragPosition(undefined);
      }}
    >
      {e2eProjectionAttribute && <CardProjectionProbe dataAttribute={e2eProjectionAttribute} />}
      {(onDragEnd || (onSelect && expandedHitArea)) && (
        <mesh position={[0, 0, 0.065]} renderOrder={renderOrder + 1}>
          <planeGeometry args={onDragEnd ? [1.72, 2.24] : [1.48, 2.32]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
      <RoundedBox
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
      <mesh renderOrder={renderOrder} position={[0, 0, 0.0405]}>
        <planeGeometry args={[1.13, 1.68]} />
        <meshStandardMaterial
          map={front}
          color={inactive ? "#313534" : "#ffffff"}
          roughness={0.55}
          transparent={inactive}
          opacity={inactive ? 0.42 : 1}
        />
      </mesh>
      <mesh renderOrder={renderOrder} position={[0, 0, -0.0405]} rotation={[0, Math.PI, 0]}>
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
