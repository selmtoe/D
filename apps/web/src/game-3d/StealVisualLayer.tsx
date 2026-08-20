import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { CardView, RoomView } from "../app/model";
import type { StealVisualState } from "../screens/StealSequence";
import { Card3D } from "./Card3D";
import { cardAnchorPosition } from "./CardMotionLayer";

const BACK: CardView = { id: "steal-back", visibility: "hidden", blind: false };

function AnimatedStealCards({
  state,
  room,
  mobile,
}: {
  state: StealVisualState;
  room: RoomView;
  mobile: boolean;
}) {
  const root = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!root.current) return;
    const energy = state.stage === "shuffle" ? 1 : 0;
    root.current.rotation.y = Math.sin(clock.elapsedTime * 9) * 0.16 * energy;
    root.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.22 * energy;
  });
  const anchor = cardAnchorPosition({ kind: "seat", playerId: state.targetPlayerId }, room, mobile);
  const count = Math.max(1, Math.min(12, state.cardCount));
  return (
    <group ref={root} position={[anchor[0] * 0.93, anchor[1] + 0.3, anchor[2] * 0.93]}>
      {Array.from({ length: count }, (_, index) => {
        const centered = index - (count - 1) / 2;
        const spread = Math.min(0.24, 2.3 / count);
        const shuffleOffset = state.stage === "shuffle" ? Math.sin(index * 4.3) * 0.16 : 0;
        return (
          <group
            key={index}
            position={[centered * spread + shuffleOffset, Math.abs(centered) * 0.01, 0]}
          >
            <Card3D card={state.cards?.[index] ?? { ...BACK, id: `steal-${index}` }} scale={0.36} />
            {state.stage === "point" && state.slot === index && (
              <group position={[0, 0.62, 0]}>
                <mesh rotation={[0, 0, Math.PI]}>
                  <coneGeometry args={[0.1, 0.32, 12]} />
                  <meshStandardMaterial
                    color="#ffe083"
                    emissive="#7c4f05"
                    emissiveIntensity={1.1}
                  />
                </mesh>
                <mesh position={[0, 0.22, 0]} scale={[1.2, 0.8, 1]}>
                  <sphereGeometry args={[0.12, 14, 10]} />
                  <meshStandardMaterial
                    color="#ffe083"
                    emissive="#7c4f05"
                    emissiveIntensity={0.7}
                  />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
      {state.stage === "confirm" && (
        <pointLight position={[0, 1, 0]} color="#f5d77f" intensity={4} distance={4} />
      )}
    </group>
  );
}

export function StealVisualLayer({
  state,
  room,
  mobile,
}: {
  state?: StealVisualState | undefined;
  room: RoomView;
  mobile: boolean;
}) {
  if (!state) return null;
  return <AnimatedStealCards state={state} room={room} mobile={mobile} />;
}
