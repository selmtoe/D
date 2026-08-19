import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

export function Avatar3D({
  profile,
  lowPower = false,
  active = false,
}: {
  profile: AvatarProfileV1;
  lowPower?: boolean;
  active?: boolean;
}) {
  const root = useRef<Group>(null);
  const hairId = Number(profile.parts.hair.split("-")[1] ?? 1);
  const hairVariant = hairId % 4;
  const eyeId = Number(profile.parts.eyes.split("-")[1] ?? 1);
  const eyeVariant = eyeId % 3;
  const partNumber = (id: string) => (id === "none" ? 0 : Number(id.split("-").at(-1) ?? 0));
  const bodyId = partNumber(profile.bodyPresetId);
  const headId = partNumber(profile.headPresetId);
  const skinId = partNumber(profile.parts.skinTone);
  const topsId = partNumber(profile.parts.tops);
  const outerwearId = partNumber(profile.parts.outerwear);
  const bottomsId = partNumber(profile.parts.bottoms);
  const fullOutfitId = partNumber(profile.parts.fullOutfit);
  const shoesId = partNumber(profile.parts.shoes);
  const glovesId = partNumber(profile.parts.gloves);
  const earsId = partNumber(profile.parts.ears);
  const noseId = partNumber(profile.parts.nose);
  const browsId = partNumber(profile.parts.brows);
  const mouthId = partNumber(profile.parts.mouth);
  const irisId = partNumber(profile.parts.iris);
  const expressionId = partNumber(profile.parts.expression);
  const eyewearId = partNumber(profile.parts.eyewear);
  const headwearId = partNumber(profile.parts.headwear);
  const jewelryId = partNumber(profile.parts.jewelry);
  const build = 0.8 + profile.morphs.build * 0.38 + (bodyId % 4) * 0.025;
  const height = 0.88 + profile.morphs.height * 0.24;
  useFrame(({ clock }) => {
    if (!root.current || lowPower) return;
    root.current.position.y =
      Math.sin(clock.elapsedTime * (1.15 + (partNumber(profile.animationSetId) % 6) * 0.08)) *
      0.018;
    root.current.rotation.y = Math.sin(clock.elapsedTime * 0.42) * 0.03;
  });
  return (
    <group ref={root} scale={[build, height, build]}>
      <mesh
        position={[0, 0.95, 0]}
        scale={[0.92 + (topsId % 8) * 0.025, 1 + (topsId % 5) * 0.02, 0.94]}
        castShadow
      >
        <capsuleGeometry args={[0.43, 0.55, 8, 18]} />
        <meshStandardMaterial
          color={profile.colors.outfit}
          roughness={profile.materials.outfit === "satin" ? 0.25 : 0.68}
          metalness={0.04}
        />
      </mesh>
      {fullOutfitId > 0 && (
        <mesh
          position={[0, 0.78, 0.02]}
          scale={[1 + (fullOutfitId % 7) * 0.025, 1 + (fullOutfitId % 5) * 0.035, 1]}
          castShadow
        >
          {fullOutfitId % 3 === 0 ? (
            <coneGeometry args={[0.58, 1.45, 18]} />
          ) : fullOutfitId % 3 === 1 ? (
            <capsuleGeometry args={[0.48, 0.72, 8, 18]} />
          ) : (
            <cylinderGeometry args={[0.43, 0.58, 1.35, 18]} />
          )}
          <meshStandardMaterial
            color={profile.colors.outfit}
            roughness={0.25 + (fullOutfitId % 6) * 0.1}
          />
        </mesh>
      )}
      <mesh
        position={[0, 1.75, 0]}
        scale={[
          (0.9 + profile.morphs.faceWidth * 0.2) * (0.9 + (headId % 5) * 0.04),
          0.9 + (headId % 7) * 0.03,
          0.87 + (headId % 4) * 0.03,
        ]}
        castShadow
      >
        <sphereGeometry args={[0.56, lowPower ? 16 : 28, lowPower ? 12 : 22]} />
        <meshStandardMaterial color={profile.colors.skin} roughness={0.58 + (skinId % 6) * 0.045} />
      </mesh>
      <group position={[0, 1.82, 0.5]}>
        <mesh
          position={[-0.19, 0.04, 0]}
          scale={[
            (eyeVariant === 1 ? 1.2 : 1) * (0.88 + (eyeId % 7) * 0.035),
            (eyeVariant === 2 ? 0.65 : 1) *
              (0.9 + (eyeId % 5) * 0.025) *
              (0.85 + (expressionId % 4) * 0.08),
            0.82 + (irisId % 6) * 0.04,
          ]}
        >
          <sphereGeometry args={[0.075, 12, 8]} />
          <meshStandardMaterial color={profile.colors.eyes} roughness={0.35} />
        </mesh>
        <mesh
          position={[0.19, 0.04, 0]}
          scale={[
            (eyeVariant === 1 ? 1.2 : 1) * (0.88 + (eyeId % 7) * 0.035),
            (eyeVariant === 2 ? 0.65 : 1) *
              (0.9 + (eyeId % 5) * 0.025) *
              (0.85 + (expressionId % 4) * 0.08),
            0.82 + (irisId % 6) * 0.04,
          ]}
        >
          <sphereGeometry args={[0.075, 12, 8]} />
          <meshStandardMaterial color={profile.colors.eyes} roughness={0.35} />
        </mesh>
        <mesh
          position={[0, -0.2, 0.04]}
          rotation={[0, 0, Math.PI / 2 + ((mouthId % 7) - 3) * 0.045]}
          scale={[0.8 + (mouthId % 6) * 0.07, 0.85 + (expressionId % 5) * 0.05, 1]}
        >
          <torusGeometry args={[0.11, 0.022, 7, 18, Math.PI]} />
          <meshStandardMaterial color="#6e302b" roughness={0.6} />
        </mesh>
        <mesh
          position={[0, -0.045, 0.02]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.65 + (noseId % 6) * 0.07, 1, 0.75 + (noseId % 4) * 0.08]}
        >
          <coneGeometry args={[0.07, 0.16, 10]} />
          <meshStandardMaterial color={profile.colors.skin} roughness={0.72} />
        </mesh>
        <mesh position={[-0.19, 0.19, -0.01]} rotation={[0, 0, ((browsId % 9) - 4) * 0.04]}>
          <capsuleGeometry args={[0.018, 0.17 + (browsId % 5) * 0.015, 4, 8]} />
          <meshStandardMaterial color={profile.colors.hair} />
        </mesh>
        <mesh
          position={[0.19, 0.19, -0.01]}
          rotation={[0, 0, Math.PI - ((browsId % 9) - 4) * 0.04]}
        >
          <capsuleGeometry args={[0.018, 0.17 + (browsId % 5) * 0.015, 4, 8]} />
          <meshStandardMaterial color={profile.colors.hair} />
        </mesh>
        {profile.parts.beard !== "none" && (
          <mesh
            position={[0, -0.23, -0.01]}
            rotation={[0, 0, Math.PI / 2]}
            scale={[1 + (partNumber(profile.parts.beard) % 5) * 0.08, 1, 1]}
          >
            <torusGeometry args={[0.17, 0.045, 7, 16, Math.PI]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.9} />
          </mesh>
        )}
        {profile.parts.marks !== "none" && (
          <mesh
            position={[
              -0.29 + (partNumber(profile.parts.marks) % 3) * 0.29,
              -0.1 + (partNumber(profile.parts.marks) % 4) * 0.055,
              0.035,
            ]}
          >
            <circleGeometry args={[0.025 + (partNumber(profile.parts.marks) % 4) * 0.008, 9]} />
            <meshStandardMaterial color="#7d493d" transparent opacity={0.7} />
          </mesh>
        )}
      </group>
      <mesh
        position={[-0.56 - (earsId % 3) * 0.012, 1.76, 0]}
        scale={[0.65 + (earsId % 4) * 0.09, 1 + (earsId % 5) * 0.04, 0.65]}
      >
        <sphereGeometry args={[0.15, 12, 9]} />
        <meshStandardMaterial color={profile.colors.skin} roughness={0.72} />
      </mesh>
      <mesh
        position={[0.56 + (earsId % 3) * 0.012, 1.76, 0]}
        scale={[0.65 + (earsId % 4) * 0.09, 1 + (earsId % 5) * 0.04, 0.65]}
      >
        <sphereGeometry args={[0.15, 12, 9]} />
        <meshStandardMaterial color={profile.colors.skin} roughness={0.72} />
      </mesh>
      <group position={[0, 2.1, -0.02]}>
        {hairVariant === 0 && (
          <mesh scale={[1.02, 0.58, 0.98]}>
            <sphereGeometry args={[0.59, 20, 14]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.78} />
          </mesh>
        )}
        {hairVariant === 1 &&
          Array.from({ length: 6 + (hairId % 5) }, (_, index) => (
            <mesh
              key={index}
              position={[
                (index - (5 + (hairId % 5)) / 2) * 0.12,
                Math.abs(index - 3.5) * -0.025,
                0,
              ]}
              rotation={[0.2, 0, (index - 3.5) * (-0.07 - (hairId % 6) * 0.008)]}
            >
              <capsuleGeometry
                args={[
                  0.09 + (hairId % 4) * 0.008,
                  0.32 + (hairId % 9) * 0.035 + (index % 2) * 0.1,
                  5,
                  10,
                ]}
              />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.75} />
            </mesh>
          ))}
        {hairVariant === 2 && (
          <>
            <mesh scale={[1.03, 0.5, 1]}>
              <sphereGeometry args={[0.6, 20, 12]} />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.9} />
            </mesh>
            <mesh position={[0.5, -0.15, -0.05]} rotation={[0, 0, -0.25]}>
              <capsuleGeometry args={[0.13, 0.58, 6, 12]} />
              <meshStandardMaterial color={profile.colors.hair} />
            </mesh>
          </>
        )}
        {hairVariant === 3 && (
          <mesh rotation={[0, 0, 0.1]}>
            <coneGeometry args={[0.62, 0.8, 16]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.74} />
          </mesh>
        )}
      </group>
      <mesh position={[-0.52, 0.98, 0]} rotation={[0, 0, 0.2]}>
        <capsuleGeometry args={[0.11, 0.55, 6, 10]} />
        <meshStandardMaterial color={profile.colors.skin} />
      </mesh>
      <mesh position={[0.52, 0.98, 0]} rotation={[0, 0, -0.2]}>
        <capsuleGeometry args={[0.11, 0.55, 6, 10]} />
        <meshStandardMaterial color={profile.colors.skin} />
      </mesh>
      {outerwearId > 0 && (
        <>
          <mesh position={[-0.43, 1.18, 0]} scale={[1 + (outerwearId % 5) * 0.08, 0.7, 1]}>
            <sphereGeometry args={[0.25, 12, 8]} />
            <meshStandardMaterial color={profile.colors.outfit} roughness={0.55} />
          </mesh>
          <mesh position={[0.43, 1.18, 0]} scale={[1 + (outerwearId % 5) * 0.08, 0.7, 1]}>
            <sphereGeometry args={[0.25, 12, 8]} />
            <meshStandardMaterial color={profile.colors.outfit} roughness={0.55} />
          </mesh>
        </>
      )}
      <mesh position={[-0.23, 0.27, 0]}>
        <capsuleGeometry args={[0.12 + (bottomsId % 4) * 0.008, 0.46, 6, 10]} />
        <meshStandardMaterial color={profile.colors.outfit} roughness={0.76} />
      </mesh>
      <mesh position={[0.23, 0.27, 0]}>
        <capsuleGeometry args={[0.12 + (bottomsId % 4) * 0.008, 0.46, 6, 10]} />
        <meshStandardMaterial color={profile.colors.outfit} roughness={0.76} />
      </mesh>
      <mesh position={[-0.23, -0.08, 0.08]} scale={[0.9 + (shoesId % 6) * 0.045, 0.7, 1.2]}>
        <boxGeometry args={[0.28, 0.18, 0.42]} />
        <meshStandardMaterial color="#171719" roughness={0.55} />
      </mesh>
      <mesh position={[0.23, -0.08, 0.08]} scale={[0.9 + (shoesId % 6) * 0.045, 0.7, 1.2]}>
        <boxGeometry args={[0.28, 0.18, 0.42]} />
        <meshStandardMaterial color="#171719" roughness={0.55} />
      </mesh>
      {glovesId > 0 && (
        <>
          <mesh position={[-0.61, 0.66, 0]} scale={0.9 + (glovesId % 4) * 0.06}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color={profile.colors.outfit} />
          </mesh>
          <mesh position={[0.61, 0.66, 0]} scale={0.9 + (glovesId % 4) * 0.06}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color={profile.colors.outfit} />
          </mesh>
        </>
      )}
      {profile.parts.earrings !== "none" && (
        <>
          <mesh position={[-0.58, 1.55, 0.04]}>
            <torusGeometry
              args={[0.06 + (partNumber(profile.parts.earrings) % 4) * 0.012, 0.014, 6, 12]}
            />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.8} />
          </mesh>
          <mesh position={[0.58, 1.55, 0.04]}>
            <torusGeometry
              args={[0.06 + (partNumber(profile.parts.earrings) % 4) * 0.012, 0.014, 6, 12]}
            />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.8} />
          </mesh>
        </>
      )}
      {eyewearId > 0 && (
        <group position={[0, 1.85, 0.55]}>
          <mesh
            position={[-0.2, 0, 0]}
            scale={[1 + (eyewearId % 5) * 0.06, 0.8 + (eyewearId % 4) * 0.08, 1]}
          >
            <torusGeometry args={[0.13, 0.018 + (eyewearId % 3) * 0.006, 8, 20]} />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.75} />
          </mesh>
          <mesh
            position={[0.2, 0, 0]}
            scale={[1 + (eyewearId % 5) * 0.06, 0.8 + (eyewearId % 4) * 0.08, 1]}
          >
            <torusGeometry args={[0.13, 0.018 + (eyewearId % 3) * 0.006, 8, 20]} />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.75} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.12, 0.018, 0.018]} />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.75} />
          </mesh>
        </group>
      )}
      {headwearId > 0 && (
        <mesh
          position={[0, 2.47 + (headwearId % 4) * 0.025, 0]}
          rotation={[0, 0, ((headwearId % 5) - 2) * 0.035]}
        >
          {headwearId % 3 === 0 ? (
            <coneGeometry args={[0.48, 0.62, 20]} />
          ) : headwearId % 3 === 1 ? (
            <cylinderGeometry args={[0.34, 0.46, 0.28 + (headwearId % 5) * 0.04, 20]} />
          ) : (
            <torusGeometry args={[0.38, 0.11, 10, 24]} />
          )}
          <meshStandardMaterial color={profile.colors.accent} metalness={0.65} roughness={0.22} />
        </mesh>
      )}
      {jewelryId > 0 && (
        <mesh
          position={[0, 1.31, 0.46]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1 + (jewelryId % 6) * 0.035, 1, 1]}
        >
          <torusGeometry
            args={[0.24 + (jewelryId % 4) * 0.018, 0.018 + (jewelryId % 3) * 0.007, 8, 22]}
          />
          <meshStandardMaterial color={profile.colors.accent} metalness={0.65} />
        </mesh>
      )}
      {active && (
        <pointLight position={[0, 0.3, 0.8]} intensity={1.2} distance={3} color="#ffd986" />
      )}
    </group>
  );
}
