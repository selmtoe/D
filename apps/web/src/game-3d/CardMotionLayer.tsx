import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MathUtils, type Group } from "three";
import type { RoomView } from "../app/model";
import { Card3D } from "./Card3D";
import {
  cardMotionsForDisplay,
  collectCardRackPlacement,
  discardStackPlacement,
  fieldCardPlacement,
  type CardAnchor,
  type CardMotionEvent,
} from "./cardMotion";

export function cardAnchorPosition(
  anchor: CardAnchor,
  room: RoomView,
  mobile: boolean,
  handViewpointId?: string,
): [number, number, number] {
  if (anchor.kind === "hand") {
    const distance = mobile ? 3.75 : 4.15;
    const viewpointIndex = Math.max(
      0,
      room.players.findIndex((player) => player.id === handViewpointId),
    );
    const rotation = (viewpointIndex / Math.max(1, room.players.length)) * Math.PI * 2;
    return [-Math.sin(rotation) * distance, 1.15, Math.cos(rotation) * distance];
  }
  if (anchor.kind === "field") {
    if (
      anchor.playIndex !== undefined &&
      anchor.playCount !== undefined &&
      anchor.cardIndex !== undefined &&
      anchor.cardCount !== undefined &&
      anchor.layerIndex !== undefined
    ) {
      return fieldCardPlacement(
        anchor.playIndex,
        anchor.playCount,
        anchor.cardIndex,
        anchor.cardCount,
        anchor.layerIndex,
      ).position;
    }
    return [0, 0.28, 0];
  }
  if (anchor.kind === "discard") {
    return anchor.cardIndex === undefined
      ? [2.9, 0.23, -1.45]
      : discardStackPlacement(anchor.cardIndex).position;
  }
  if (anchor.kind === "deck") return [-2.9, 0.28, -1.45];
  if (anchor.kind === "discardRack") {
    return collectCardRackPlacement(anchor.cardIndex, anchor.cardCount, mobile).position;
  }
  const playerId = "playerId" in anchor ? anchor.playerId : room.viewerId;
  const index = Math.max(
    0,
    room.players.findIndex((player) => player.id === playerId),
  );
  const angle = (index / Math.max(1, room.players.length)) * Math.PI * 2 + Math.PI / 2;
  return [Math.cos(angle) * 4.1, 0.32, Math.sin(angle) * 4.1];
}

function MotionCard({
  motion,
  room,
  mobile,
  handViewpointId,
  onDone,
}: {
  motion: CardMotionEvent;
  room: RoomView;
  mobile: boolean;
  handViewpointId?: string | undefined;
  onDone: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const startedAt = useRef<number | undefined>(undefined);
  const arrivedAt = useRef<number | undefined>(undefined);
  const finished = useRef(false);
  const from = useMemo(
    () => cardAnchorPosition(motion.from, room, mobile, handViewpointId),
    [handViewpointId, mobile, motion.from, room],
  );
  const to = useMemo(
    () => cardAnchorPosition(motion.to, room, mobile, handViewpointId),
    [handViewpointId, mobile, motion.to, room],
  );
  useFrame(({ clock }) => {
    if (!root.current) return;
    startedAt.current ??= clock.elapsedTime;
    const duration = motion.kind === "flush" ? 0.7 : motion.kind === "play" ? 0.78 : 0.95;
    const progress = MathUtils.clamp((clock.elapsedTime - startedAt.current) / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const arc = motion.kind === "flush" ? 0.42 : motion.kind === "discard" ? 0.68 : 1.35;
    root.current.position.set(
      MathUtils.lerp(from[0], to[0], eased),
      MathUtils.lerp(from[1], to[1], eased) + Math.sin(progress * Math.PI) * arc,
      MathUtils.lerp(from[2], to[2], eased),
    );
    root.current.rotation.y = Math.sin(progress * Math.PI) * 0.55;
    root.current.rotation.z = MathUtils.lerp(-0.12, 0.08, eased);
    if (progress === 1) {
      arrivedAt.current ??= clock.elapsedTime;
    }
    const heldForMs =
      arrivedAt.current === undefined ? 0 : (clock.elapsedTime - arrivedAt.current) * 1000;
    if (progress === 1 && heldForMs >= (motion.holdMs ?? 0) && !finished.current) {
      finished.current = true;
      root.current.visible = false;
      onDone(motion.id);
    }
  });
  return (
    <group ref={root}>
      <Card3D card={motion.card} scale={motion.kind === "flush" ? 0.66 : 0.74} />
    </group>
  );
}

function QueuedMotionCard({
  motion,
  room,
  mobile,
  handViewpointId,
}: {
  motion: CardMotionEvent;
  room: RoomView;
  mobile: boolean;
  handViewpointId?: string | undefined;
}) {
  const position = cardAnchorPosition(motion.from, room, mobile, handViewpointId);
  return (
    <group position={position}>
      <Card3D card={motion.card} scale={motion.kind === "flush" ? 0.66 : 0.74} />
    </group>
  );
}

export function CardMotionLayer({
  motions,
  room,
  mobile,
  handViewpointId,
  onDone,
}: {
  motions: CardMotionEvent[];
  room: RoomView;
  mobile: boolean;
  handViewpointId?: string | undefined;
  onDone: (id: string) => void;
}) {
  const display = cardMotionsForDisplay(motions);
  return (
    <>
      {display.queued.map((motion) => (
        <QueuedMotionCard
          key={`queued-${motion.id}`}
          motion={motion}
          room={room}
          mobile={mobile}
          handViewpointId={handViewpointId}
        />
      ))}
      {display.active.map((motion) => (
        <MotionCard
          key={motion.id}
          motion={motion}
          room={room}
          mobile={mobile}
          handViewpointId={handViewpointId}
          onDone={onDone}
        />
      ))}
    </>
  );
}
