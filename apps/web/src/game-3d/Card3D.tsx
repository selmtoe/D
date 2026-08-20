import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { CanvasTexture, Color, SRGBColorSpace } from "three";
import type { CardView } from "../app/model";

const suitSymbol = { spade: "♠", heart: "♥", diamond: "♦", club: "♣" } as const;

function cardTexture(card: CardView, back: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
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
  } else if (card.visibility === "face") {
    const isRed = card.suit === "heart" || card.suit === "diamond" || card.joker === "crimson";
    ctx.fillStyle = isRed ? "#a52535" : "#111720";
    ctx.textAlign = "left";
    ctx.font = "700 54px ui-serif, serif";
    if (card.joker) {
      ctx.fillText("J", 22, 68);
      ctx.font = "800 46px ui-serif, serif";
      ctx.textAlign = "center";
      ctx.fillText(card.joker === "crimson" ? "JOKER II" : "JOKER I", 128, 205);
      ctx.beginPath();
      ctx.arc(128, 260, 42, 0, Math.PI * 2);
      ctx.strokeStyle = "#d7b668";
      ctx.lineWidth = 7;
      ctx.stroke();
    } else {
      const symbol = card.suit ? suitSymbol[card.suit] : "";
      ctx.fillText(card.rank ?? "", 22, 68);
      ctx.font = "46px serif";
      ctx.fillText(symbol, 24, 116);
      ctx.textAlign = "center";
      ctx.font = "116px serif";
      ctx.fillText(symbol, 128, 244);
    }
    if (card.blind) {
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
}: {
  card: CardView;
  position?: [number, number, number];
  rotation?: [number, number, number];
  selected?: boolean;
  dimmed?: boolean;
  hidden?: boolean;
  onSelect?: () => void;
  scale?: number;
}) {
  const front = useMemo(() => cardTexture(card, card.visibility === "hidden"), [card]);
  const back = useMemo(() => cardTexture(card, true), [card]);
  useEffect(
    () => () => {
      front.dispose();
      back.dispose();
    },
    [back, front],
  );
  const inactive = dimmed && !selected;
  const edge = selected ? "#f4d47f" : inactive ? "#242827" : "#d8cfb8";
  return (
    <group
      visible={!hidden}
      position={[position[0], position[1] + (selected ? 0.18 : 0), position[2]]}
      rotation={rotation}
      scale={scale}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!inactive) onSelect?.();
      }}
    >
      <RoundedBox args={[1.22, 1.78, 0.075]} radius={0.08} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial
          color={new Color(edge)}
          roughness={0.48}
          metalness={0.02}
          transparent={inactive}
          opacity={inactive ? 0.55 : 1}
        />
      </RoundedBox>
      <mesh position={[0, 0, 0.0405]}>
        <planeGeometry args={[1.13, 1.68]} />
        <meshStandardMaterial
          map={front}
          color={inactive ? "#313534" : "#ffffff"}
          roughness={0.55}
          transparent={inactive}
          opacity={inactive ? 0.42 : 1}
        />
      </mesh>
      <mesh position={[0, 0, -0.0405]} rotation={[0, Math.PI, 0]}>
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
