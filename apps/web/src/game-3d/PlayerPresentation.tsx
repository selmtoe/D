import { Html } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { Object3D, SpotLight as ThreeSpotLight } from "three";

export type CharacterLabelKind = "player" | "spectator";

export function characterNameForDisplay(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  return normalized || ("プレイヤー" satisfies string);
}

export function currentTurnSpotlightPresentation(
  lowPower: boolean,
  mobile: boolean,
): {
  intensity: number;
  segments: number;
  poolOpacity: number;
} {
  if (lowPower) return { intensity: 11, segments: 16, poolOpacity: 0.07 };
  if (mobile) return { intensity: 20, segments: 24, poolOpacity: 0.085 };
  return { intensity: 30, segments: 36, poolOpacity: 0.1 };
}

export function CharacterNameTag({
  name,
  rank,
  disqualified = false,
  currentTurn = false,
  kind = "player",
  mobile = false,
}: {
  name: string;
  rank?: number | undefined;
  disqualified?: boolean | undefined;
  currentTurn?: boolean;
  kind?: CharacterLabelKind;
  mobile?: boolean;
}) {
  const displayName = characterNameForDisplay(name);
  return (
    <Html
      center
      position={[0, kind === "spectator" ? 2.82 : 2.72, 0]}
      distanceFactor={mobile ? 9.4 : 8.4}
      zIndexRange={[4, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div
        className={`character-name-tag character-name-tag--${kind}${currentTurn ? " is-current-turn" : ""}`}
        data-current-turn={currentTurn || undefined}
      >
        <span>{displayName}</span>
        {disqualified ? <small>失格</small> : rank !== undefined && <small>{rank}位</small>}
        {currentTurn && <small>手番</small>}
      </div>
    </Html>
  );
}

export function CurrentTurnSpotlight({ lowPower, mobile }: { lowPower: boolean; mobile: boolean }) {
  const light = useRef<ThreeSpotLight>(null);
  const target = useRef<Object3D>(null);
  const presentation = currentTurnSpotlightPresentation(lowPower, mobile);

  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  return (
    <group name="current-turn-presentation">
      <object3D ref={target} position={[0, 0.72, 0.12]} />
      <spotLight
        ref={light}
        name="current-turn-spotlight"
        position={[0, 5.2, -0.25]}
        color="#ffdfa0"
        intensity={presentation.intensity}
        distance={7.2}
        angle={0.48}
        penumbra={0.88}
        decay={2}
        castShadow={false}
      />
      <mesh
        name="current-turn-floor-pool"
        position={[0, 0.016, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={18}
      >
        <circleGeometry args={[1.34, presentation.segments]} />
        <meshBasicMaterial
          color="#ffe2a3"
          transparent
          opacity={presentation.poolOpacity}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        name="current-turn-floor-ring"
        position={[0, 0.024, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={19}
      >
        <ringGeometry args={[1.27, 1.4, presentation.segments]} />
        <meshBasicMaterial
          color="#f4d47f"
          transparent
          opacity={lowPower ? 0.48 : 0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
