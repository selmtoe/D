import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MathUtils, type Group } from "three";
import type { CardView, RoomView } from "../app/model";
import type { StealVisualState } from "../screens/StealSequence";
import { Card3D } from "./Card3D";

const back = (index: number): CardView => ({
  id: `steal-back-${index}`,
  visibility: "hidden",
  blind: false,
});

function FingerPointer({ x, active }: { x: number; active: boolean }) {
  const root = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!root.current) return;
    const factor = 1 - Math.exp(-delta * 15);
    root.current.position.x = MathUtils.lerp(root.current.position.x, x, factor);
    root.current.position.y = MathUtils.lerp(root.current.position.y, active ? 0.72 : 0.92, factor);
  });
  return (
    <group ref={root} position={[0, 0.92, 0.08]} rotation={[0, 0, -0.2]} scale={0.68}>
      <mesh position={[0, 0.18, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.1, 0.42, 8, 14]} />
        <meshStandardMaterial color="#d8a57f" roughness={0.72} />
      </mesh>
      <mesh position={[0.31, 0.18, 0]} scale={[1.35, 0.8, 1]} castShadow>
        <sphereGeometry args={[0.14, 18, 12]} />
        <meshStandardMaterial color="#d8a57f" roughness={0.72} />
      </mesh>
      <mesh position={[-0.26, 0.14, 0.03]} rotation={[0, 0, -0.55]} castShadow>
        <capsuleGeometry args={[0.075, 0.24, 8, 12]} />
        <meshStandardMaterial color="#d8a57f" roughness={0.72} />
      </mesh>
      <pointLight
        position={[0.1, 0.25, 0.2]}
        intensity={active ? 2.2 : 0.8}
        distance={2.2}
        color="#ffd786"
      />
    </group>
  );
}

function AnimatedStealCards({ state, room }: { state: StealVisualState; room: RoomView }) {
  const targetIndex = Math.max(
    0,
    room.players.findIndex((player) => player.id === state.targetPlayerId),
  );
  const angle = (targetIndex / Math.max(1, room.players.length)) * Math.PI * 2 + Math.PI / 2;
  const count = Math.max(1, state.cardCount);
  const spread = Math.min(0.42, 5.4 / count);
  const rowWidth = Math.max(0.5, spread * (count - 1));
  const pointerX = MathUtils.clamp(state.pointerX ?? 0, -1, 1) * (rowWidth / 2);
  const selected = useMemo(() => new Set(state.selectedSlots ?? []), [state.selectedSlots]);
  const victimPerspective = state.perspective === "victim";
  const cards = state.cards ?? Array.from({ length: count }, (_, index) => back(index));
  const center: [number, number, number] = victimPerspective
    ? [0, 1.14, 4.02]
    : [Math.cos(angle) * 4.55, 0.32, Math.sin(angle) * 4.55];
  return (
    <group position={center} rotation={[0, victimPerspective ? 0 : -angle - Math.PI / 2, 0]}>
      {!victimPerspective &&
        cards.map((card, index) => {
          const centered = index - (cards.length - 1) / 2;
          const taken = selected.has(index);
          return (
            <Card3D
              key={card.id}
              card={card}
              faceVisibleFromBack={state.perspective === "observer" && card.visibility === "face"}
              position={[centered * spread, taken ? 0.34 : 0, taken ? -0.28 : 0]}
              rotation={[-Math.PI / 2, 0, taken ? 0.08 : 0]}
              scale={0.48}
              renderOrder={200 + index}
            />
          );
        })}
      <FingerPointer x={pointerX} active={state.stage === "point" || state.stage === "take"} />
      {state.stage === "complete" && (
        <pointLight position={[0, 1.2, 0]} color="#f5d77f" intensity={5} distance={4} />
      )}
    </group>
  );
}

export function StealVisualLayer({
  state,
  room,
}: {
  state?: StealVisualState | undefined;
  room: RoomView;
  mobile: boolean;
}) {
  if (!state) return null;
  return <AnimatedStealCards state={state} room={room} />;
}
