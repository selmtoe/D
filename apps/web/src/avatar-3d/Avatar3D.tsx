import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { animationPose, proceduralPartStyle } from "./proceduralAvatar";

function materialRoughness(material: AvatarProfileV1["materials"]["outfit"]): number {
  return { velvet: 0.88, satin: 0.24, wool: 0.76, silk: 0.34 }[material];
}

function Hair({ profile, lowPower }: { profile: AvatarProfileV1; lowPower: boolean }) {
  const style = proceduralPartStyle("hair", profile.parts.hair);
  const strands = 5 + Math.floor(style.sweep * 7);
  const spikes = 3 + Math.floor(style.wave * 4);
  const alternating = (index: number) => index - Math.floor(index / 2) * 2;
  return (
    <group position={[0, 2.1 + style.signature * 0.018, -0.02]}>
      {style.family === 0 && (
        <mesh scale={[0.98 + style.signature * 0.11, 0.46 + style.wave * 0.2, 0.96]}>
          <sphereGeometry args={[0.59, lowPower ? 14 : 22, lowPower ? 10 : 16]} />
          <meshStandardMaterial color={profile.colors.hair} roughness={0.68 + style.sweep * 0.22} />
        </mesh>
      )}
      {style.family === 1 &&
        Array.from({ length: strands }, (_, index) => {
          const center = index - (strands - 1) / 2;
          return (
            <mesh
              key={index}
              position={[
                center * (0.09 + style.signature * 0.018),
                -Math.abs(center) * 0.018,
                0.01,
              ]}
              rotation={[0.16 + style.wave * 0.18, 0, center * (-0.075 - style.sweep * 0.025)]}
            >
              <capsuleGeometry
                args={[
                  0.075 + style.signature * 0.026,
                  0.27 + style.wave * 0.35 + alternating(index) * 0.09,
                  5,
                  lowPower ? 7 : 11,
                ]}
              />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.76} />
            </mesh>
          );
        })}
      {style.family === 2 && (
        <>
          <mesh scale={[1.02 + style.signature * 0.06, 0.48 + style.wave * 0.16, 1]}>
            <sphereGeometry args={[0.6, lowPower ? 14 : 22, lowPower ? 10 : 15]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.84} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (0.46 + style.signature * 0.06), -0.2 - style.sweep * 0.08, 0]}
              rotation={[0, 0, side * (-0.18 - style.wave * 0.12)]}
            >
              <capsuleGeometry
                args={[0.1 + style.signature * 0.025, 0.42 + style.sweep * 0.42, 6, 10]}
              />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.72} />
            </mesh>
          ))}
        </>
      )}
      {style.family === 3 &&
        Array.from({ length: spikes }, (_, index) => (
          <mesh
            key={index}
            position={[
              0,
              0.14 + index * (0.08 + style.signature * 0.01),
              (index - (spikes - 1) / 2) * 0.13,
            ]}
            rotation={[style.sweep * 0.22, 0, (style.signature - 0.5) * 0.12]}
          >
            <coneGeometry args={[0.22 + style.wave * 0.08, 0.46 + style.signature * 0.42, 10]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.67} />
          </mesh>
        ))}
      {style.family === 4 && (
        <>
          <mesh scale={[1.02, 0.43 + style.signature * 0.1, 1]}>
            <sphereGeometry args={[0.58, lowPower ? 14 : 20, 12]} />
            <meshStandardMaterial color={profile.colors.hair} roughness={0.9} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (0.5 + style.wave * 0.08), 0.12 + style.sweep * 0.1, -0.02]}
            >
              <sphereGeometry args={[0.17 + style.signature * 0.09, lowPower ? 10 : 16, 10]} />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.92} />
            </mesh>
          ))}
        </>
      )}
      {style.family === 5 &&
        Array.from({ length: strands }, (_, index) => {
          const angle = (index / strands) * Math.PI * 2;
          return (
            <mesh
              key={index}
              position={[
                Math.cos(angle) * (0.42 + style.signature * 0.07),
                Math.sin(angle * 2) * 0.1,
                Math.sin(angle) * 0.34,
              ]}
              rotation={[Math.PI / 2, 0, angle]}
            >
              <torusGeometry
                args={[0.1 + style.wave * 0.035, 0.035 + style.signature * 0.018, 7, 14]}
              />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.82} />
            </mesh>
          );
        })}
    </group>
  );
}

function FullOutfit({ profile }: { profile: AvatarProfileV1 }) {
  const style = proceduralPartStyle("fullOutfit", profile.parts.fullOutfit);
  if (!style.active) return null;
  const roughness = materialRoughness(profile.materials.outfit);
  return (
    <group position={[0, 0.83, 0.015]}>
      <mesh scale={[1 + style.signature * 0.12, 1 + style.wave * 0.08, 1]} castShadow>
        {style.family <= 1 ? (
          <capsuleGeometry
            args={[0.49 + style.signature * 0.035, 0.72 + style.sweep * 0.22, 8, 18]}
          />
        ) : style.family <= 3 ? (
          <cylinderGeometry
            args={[0.43 + style.wave * 0.07, 0.58 + style.signature * 0.1, 1.35, 20]}
          />
        ) : (
          <coneGeometry args={[0.59 + style.signature * 0.08, 1.48 + style.wave * 0.16, 22]} />
        )}
        <meshStandardMaterial color={profile.colors.outfit} roughness={roughness} />
      </mesh>
      <mesh position={[0, 0.43, 0.43]} scale={[0.72 + style.signature * 0.16, 1, 1]}>
        <circleGeometry args={[0.34 + style.wave * 0.035, 20]} />
        <meshStandardMaterial color={profile.colors.accent} metalness={0.25} roughness={0.44} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * (0.5 + style.signature * 0.045), 0.35, 0]}
          rotation={[0, 0, side * (0.15 + style.sweep * 0.09)]}
          scale={[1, 0.82 + style.wave * 0.22, 1]}
        >
          <capsuleGeometry
            args={[0.13 + style.signature * 0.02, 0.56 + style.sweep * 0.2, 6, 12]}
          />
          <meshStandardMaterial color={profile.colors.outfit} roughness={roughness} />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0.43]} scale={[1 + style.signature * 0.12, 1, 1]}>
        <boxGeometry args={[0.82, 0.08 + style.wave * 0.04, 0.06]} />
        <meshStandardMaterial color={profile.colors.accent} metalness={0.68} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.63, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry
          args={[0.24 + style.signature * 0.06, 0.025 + style.wave * 0.018, 8, 20, Math.PI]}
        />
        <meshStandardMaterial color={profile.colors.accent} metalness={0.56} />
      </mesh>
      <mesh position={[0, -0.48 - style.sweep * 0.05, 0.44]}>
        <boxGeometry args={[0.42 + style.signature * 0.22, 0.05, 0.035]} />
        <meshStandardMaterial color={profile.colors.accent} metalness={0.52} />
      </mesh>
    </group>
  );
}

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
  const bodyRig = useRef<Group>(null);
  const headRig = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const style = useMemo(
    () => ({
      body: proceduralPartStyle("bodyPresetId", profile.bodyPresetId),
      head: proceduralPartStyle("headPresetId", profile.headPresetId),
      skin: proceduralPartStyle("skinTone", profile.parts.skinTone),
      eyes: proceduralPartStyle("eyes", profile.parts.eyes),
      iris: proceduralPartStyle("iris", profile.parts.iris),
      brows: proceduralPartStyle("brows", profile.parts.brows),
      nose: proceduralPartStyle("nose", profile.parts.nose),
      mouth: proceduralPartStyle("mouth", profile.parts.mouth),
      ears: proceduralPartStyle("ears", profile.parts.ears),
      beard: proceduralPartStyle("beard", profile.parts.beard),
      marks: proceduralPartStyle("marks", profile.parts.marks),
      eyewear: proceduralPartStyle("eyewear", profile.parts.eyewear),
      headwear: proceduralPartStyle("headwear", profile.parts.headwear),
      earrings: proceduralPartStyle("earrings", profile.parts.earrings),
      jewelry: proceduralPartStyle("jewelry", profile.parts.jewelry),
      tops: proceduralPartStyle("tops", profile.parts.tops),
      outerwear: proceduralPartStyle("outerwear", profile.parts.outerwear),
      bottoms: proceduralPartStyle("bottoms", profile.parts.bottoms),
      shoes: proceduralPartStyle("shoes", profile.parts.shoes),
      gloves: proceduralPartStyle("gloves", profile.parts.gloves),
      expression: proceduralPartStyle("expression", profile.parts.expression),
    }),
    [profile],
  );
  const build = 0.8 + profile.morphs.build * 0.34 + style.body.signature * 0.09;
  const height = 0.87 + profile.morphs.height * 0.23 + style.body.wave * 0.035;
  useFrame(({ clock }) => {
    if (lowPower || !root.current) return;
    const pose = animationPose(profile.animationSetId, clock.elapsedTime, active);
    root.current.position.set(pose.rootX, pose.rootY, 0);
    root.current.rotation.set(0, pose.rootYaw, pose.rootRoll);
    if (bodyRig.current) bodyRig.current.rotation.x = pose.bodyPitch;
    if (headRig.current) headRig.current.rotation.set(pose.headPitch, pose.headYaw, 0);
    if (leftArm.current) {
      leftArm.current.rotation.z = 0.2 + pose.leftArm;
      leftArm.current.position.y = 1.02 + pose.leftArmLift;
    }
    if (rightArm.current) {
      rightArm.current.rotation.z = -0.2 + pose.rightArm;
      rightArm.current.position.y = 1.02 + pose.rightArmLift;
    }
    if (leftLeg.current) leftLeg.current.position.y = 0.27 + pose.legLift;
    if (rightLeg.current) rightLeg.current.position.y = 0.27 - pose.legLift * 0.35;
  });
  const outfitRoughness = materialRoughness(profile.materials.outfit);
  return (
    <group ref={root} scale={[build, height, build]}>
      <group ref={bodyRig}>
        <mesh
          position={[0, 0.95, 0]}
          scale={[
            0.93 + style.tops.signature * 0.12,
            1 + style.tops.wave * 0.08,
            0.92 + style.tops.sweep * 0.06,
          ]}
          castShadow
        >
          <capsuleGeometry args={[0.43, 0.55, 8, 18]} />
          <meshStandardMaterial
            color={profile.colors.outfit}
            roughness={outfitRoughness}
            metalness={0.04}
          />
        </mesh>
        <mesh
          position={[0, 1.2 + style.tops.signature * 0.04, 0.43]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry
            args={[
              0.24 + style.tops.wave * 0.04,
              0.025 + style.tops.signature * 0.02,
              7,
              20,
              Math.PI,
            ]}
          />
          <meshStandardMaterial color={profile.colors.accent} metalness={0.42} />
        </mesh>
        <FullOutfit profile={profile} />
        {style.outerwear.active && (
          <group>
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                position={[side * (0.43 + style.outerwear.signature * 0.07), 1.18, -0.01]}
                scale={[1 + style.outerwear.wave * 0.18, 0.68 + style.outerwear.sweep * 0.14, 1]}
              >
                <sphereGeometry args={[0.25, 14, 9]} />
                <meshStandardMaterial color={profile.colors.outfit} roughness={outfitRoughness} />
              </mesh>
            ))}
            <mesh position={[0, 1.25, 0.39]}>
              <boxGeometry
                args={[
                  0.18 + style.outerwear.signature * 0.24,
                  0.34 + style.outerwear.wave * 0.16,
                  0.04,
                ]}
              />
              <meshStandardMaterial color={profile.colors.accent} metalness={0.48} />
            </mesh>
          </group>
        )}
      </group>

      <group ref={headRig} position={[0, 1.75, 0]}>
        <mesh
          scale={[
            (0.88 + profile.morphs.faceWidth * 0.2) * (0.94 + style.head.signature * 0.12),
            0.9 + style.head.wave * 0.13,
            0.87 + style.head.sweep * 0.09,
          ]}
          castShadow
        >
          <sphereGeometry args={[0.56, lowPower ? 16 : 28, lowPower ? 12 : 22]} />
          <meshStandardMaterial
            color={profile.colors.skin}
            roughness={0.5 + style.skin.signature * 0.32}
          />
        </mesh>
        <group position={[0, 0.07, 0.5]}>
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * (0.18 + style.eyes.signature * 0.035), 0.02, 0]}
              rotation={[0, 0, side * (style.expression.signature - 0.5) * 0.08]}
            >
              <mesh
                scale={[0.92 + style.eyes.signature * 0.34, 0.72 + style.eyes.wave * 0.38, 0.9]}
              >
                <sphereGeometry args={[0.08, 14, 9]} />
                <meshStandardMaterial color="#f3eee2" roughness={0.34} />
              </mesh>
              <mesh
                position={[side * (style.iris.sweep - 0.5) * 0.018, 0, 0.071]}
                scale={0.58 + style.iris.signature * 0.26}
              >
                <circleGeometry args={[0.065 + style.iris.wave * 0.012, 16]} />
                <meshStandardMaterial
                  color={profile.colors.eyes}
                  roughness={0.28 + style.iris.signature * 0.22}
                />
              </mesh>
              <mesh position={[0, 0, 0.077]} scale={0.38 + style.iris.sweep * 0.14}>
                <circleGeometry args={[0.045, 14]} />
                <meshStandardMaterial color="#101515" roughness={0.25} />
              </mesh>
              <mesh
                position={[0, 0.15 + style.brows.signature * 0.035, -0.01]}
                rotation={[0, 0, side * (0.08 + style.brows.wave * 0.34)]}
              >
                <capsuleGeometry
                  args={[
                    0.016 + style.brows.signature * 0.012,
                    0.15 + style.brows.sweep * 0.08,
                    4,
                    9,
                  ]}
                />
                <meshStandardMaterial color={profile.colors.hair} roughness={0.8} />
              </mesh>
            </group>
          ))}
          <mesh
            position={[
              (style.nose.sweep - 0.5) * 0.025,
              -0.08 + style.nose.signature * 0.025,
              0.025,
            ]}
            rotation={[Math.PI / 2 + (style.nose.wave - 0.5) * 0.18, 0, 0]}
            scale={[0.65 + style.nose.signature * 0.38, 1, 0.72 + style.nose.sweep * 0.24]}
          >
            <coneGeometry args={[0.07, 0.16 + style.nose.signature * 0.05, 10]} />
            <meshStandardMaterial color={profile.colors.skin} roughness={0.7} />
          </mesh>
          <mesh
            position={[0, -0.22 + (style.expression.signature - 0.5) * 0.035, 0.045]}
            rotation={[0, 0, Math.PI / 2 + (style.mouth.wave - 0.5) * 0.2]}
            scale={[0.78 + style.mouth.signature * 0.46, 0.78 + style.expression.wave * 0.3, 1]}
          >
            <torusGeometry args={[0.11, 0.018 + style.mouth.sweep * 0.015, 7, 20, Math.PI]} />
            <meshStandardMaterial color="#74352f" roughness={0.62} />
          </mesh>
          {style.beard.active && (
            <mesh
              position={[0, -0.26 - style.beard.signature * 0.04, -0.005]}
              rotation={[0, 0, Math.PI / 2]}
              scale={[0.9 + style.beard.signature * 0.42, 0.88 + style.beard.wave * 0.25, 1]}
            >
              <torusGeometry args={[0.17, 0.035 + style.beard.sweep * 0.035, 7, 18, Math.PI]} />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.92} />
            </mesh>
          )}
          {style.marks.active && (
            <mesh
              position={[-0.3 + style.marks.sweep * 0.6, -0.13 + style.marks.wave * 0.27, 0.035]}
              rotation={[0, 0, style.marks.signature * Math.PI]}
            >
              <circleGeometry
                args={[
                  0.018 + style.marks.signature * 0.035,
                  3 + Math.floor(style.marks.sweep * 9),
                ]}
              />
              <meshStandardMaterial color="#7d493d" transparent opacity={0.72} />
            </mesh>
          )}
        </group>
      </group>

      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[
            side * (0.56 + style.ears.signature * 0.035),
            1.76 + (style.ears.wave - 0.5) * 0.045,
            0,
          ]}
          scale={[0.62 + style.ears.signature * 0.22, 0.9 + style.ears.sweep * 0.25, 0.65]}
        >
          <sphereGeometry args={[0.15, 12, 9]} />
          <meshStandardMaterial color={profile.colors.skin} roughness={0.72} />
        </mesh>
      ))}
      <Hair profile={profile} lowPower={lowPower} />

      <group ref={leftArm} position={[-0.52, 1.02, 0]} rotation={[0, 0, 0.2]}>
        <mesh position={[0, -0.28, 0]} scale={[1 + style.tops.signature * 0.09, 1, 1]}>
          <capsuleGeometry args={[0.11, 0.55 + style.tops.wave * 0.08, 6, 10]} />
          <meshStandardMaterial color={profile.colors.skin} />
        </mesh>
        {style.gloves.active && (
          <mesh
            position={[0, -0.61 - style.gloves.signature * 0.03, 0]}
            scale={[0.86 + style.gloves.signature * 0.2, 0.82 + style.gloves.wave * 0.2, 0.88]}
          >
            <sphereGeometry args={[0.14, 11, 8]} />
            <meshStandardMaterial
              color={profile.colors.outfit}
              roughness={0.38 + style.gloves.sweep * 0.45}
            />
          </mesh>
        )}
      </group>
      <group ref={rightArm} position={[0.52, 1.02, 0]} rotation={[0, 0, -0.2]}>
        <mesh position={[0, -0.28, 0]} scale={[1 + style.tops.signature * 0.09, 1, 1]}>
          <capsuleGeometry args={[0.11, 0.55 + style.tops.wave * 0.08, 6, 10]} />
          <meshStandardMaterial color={profile.colors.skin} />
        </mesh>
        {style.gloves.active && (
          <mesh
            position={[0, -0.61 - style.gloves.signature * 0.03, 0]}
            scale={[0.86 + style.gloves.signature * 0.2, 0.82 + style.gloves.wave * 0.2, 0.88]}
          >
            <sphereGeometry args={[0.14, 11, 8]} />
            <meshStandardMaterial
              color={profile.colors.outfit}
              roughness={0.38 + style.gloves.sweep * 0.45}
            />
          </mesh>
        )}
      </group>

      <group ref={leftLeg} position={[-0.23 - style.bottoms.signature * 0.025, 0.27, 0]}>
        <mesh scale={[1 + style.bottoms.signature * 0.18, 1 + style.bottoms.wave * 0.08, 1]}>
          <capsuleGeometry args={[0.12, 0.46, 6, 10]} />
          <meshStandardMaterial color={profile.colors.outfit} roughness={0.72} />
        </mesh>
        <mesh
          position={[0, -0.36, 0.1]}
          scale={[
            0.88 + style.shoes.signature * 0.28,
            0.65 + style.shoes.wave * 0.18,
            1.12 + style.shoes.sweep * 0.28,
          ]}
        >
          <boxGeometry args={[0.28, 0.18, 0.42]} />
          <meshStandardMaterial color="#171719" roughness={0.42 + style.shoes.signature * 0.3} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.23 + style.bottoms.signature * 0.025, 0.27, 0]}>
        <mesh scale={[1 + style.bottoms.signature * 0.18, 1 + style.bottoms.wave * 0.08, 1]}>
          <capsuleGeometry args={[0.12, 0.46, 6, 10]} />
          <meshStandardMaterial color={profile.colors.outfit} roughness={0.72} />
        </mesh>
        <mesh
          position={[0, -0.36, 0.1]}
          scale={[
            0.88 + style.shoes.signature * 0.28,
            0.65 + style.shoes.wave * 0.18,
            1.12 + style.shoes.sweep * 0.28,
          ]}
        >
          <boxGeometry args={[0.28, 0.18, 0.42]} />
          <meshStandardMaterial color="#171719" roughness={0.42 + style.shoes.signature * 0.3} />
        </mesh>
      </group>

      {style.earrings.active &&
        [-1, 1].map((side) => (
          <mesh
            key={side}
            position={[
              side * (0.58 + style.earrings.signature * 0.025),
              1.55 - style.earrings.wave * 0.07,
              0.04,
            ]}
            rotation={[style.earrings.sweep * 0.18, 0, 0]}
          >
            <torusGeometry
              args={[
                0.05 + style.earrings.signature * 0.055,
                0.01 + style.earrings.sweep * 0.014,
                7,
                15,
              ]}
            />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.82} roughness={0.2} />
          </mesh>
        ))}
      {style.eyewear.active && (
        <group
          position={[0, 1.85 + style.eyewear.signature * 0.02, 0.55]}
          rotation={[0, 0, (style.eyewear.wave - 0.5) * 0.07]}
        >
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (0.2 + style.eyewear.signature * 0.018), 0, 0]}
              scale={[1 + style.eyewear.signature * 0.25, 0.75 + style.eyewear.sweep * 0.3, 1]}
            >
              <torusGeometry args={[0.13, 0.014 + style.eyewear.wave * 0.018, 8, 20]} />
              <meshStandardMaterial color={profile.colors.accent} metalness={0.74} />
            </mesh>
          ))}
          <mesh>
            <boxGeometry args={[0.12 + style.eyewear.signature * 0.06, 0.018, 0.018]} />
            <meshStandardMaterial color={profile.colors.accent} metalness={0.74} />
          </mesh>
        </group>
      )}
      {style.headwear.active && (
        <group
          position={[0, 2.45 + style.headwear.signature * 0.14, 0]}
          rotation={[0, 0, (style.headwear.wave - 0.5) * 0.16]}
        >
          {style.headwear.family <= 1 ? (
            <mesh>
              <cylinderGeometry
                args={[
                  0.34 + style.headwear.signature * 0.12,
                  0.46 + style.headwear.sweep * 0.08,
                  0.24 + style.headwear.wave * 0.28,
                  20,
                ]}
              />
              <meshStandardMaterial
                color={profile.colors.accent}
                metalness={0.62}
                roughness={0.25}
              />
            </mesh>
          ) : style.headwear.family <= 3 ? (
            <mesh>
              <coneGeometry
                args={[
                  0.42 + style.headwear.signature * 0.13,
                  0.48 + style.headwear.wave * 0.42,
                  20,
                ]}
              />
              <meshStandardMaterial
                color={profile.colors.accent}
                metalness={0.58}
                roughness={0.28}
              />
            </mesh>
          ) : (
            <mesh
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1 + style.headwear.signature * 0.18, 1, 0.82 + style.headwear.sweep * 0.24]}
            >
              <torusGeometry args={[0.38, 0.07 + style.headwear.wave * 0.07, 10, 26]} />
              <meshStandardMaterial
                color={profile.colors.accent}
                metalness={0.68}
                roughness={0.21}
              />
            </mesh>
          )}
        </group>
      )}
      {style.jewelry.active && (
        <mesh
          position={[
            (style.jewelry.sweep - 0.5) * 0.06,
            1.31 - style.jewelry.signature * 0.045,
            0.46,
          ]}
          rotation={[Math.PI / 2, 0, (style.jewelry.wave - 0.5) * 0.12]}
          scale={[1 + style.jewelry.signature * 0.22, 1, 1]}
        >
          <torusGeometry
            args={[
              0.22 + style.jewelry.sweep * 0.07,
              0.012 + style.jewelry.signature * 0.027,
              8,
              22,
            ]}
          />
          <meshStandardMaterial color={profile.colors.accent} metalness={0.7} roughness={0.18} />
        </mesh>
      )}
      {active && (
        <pointLight position={[0, 0.3, 0.8]} intensity={1.2} distance={3} color="#ffd986" />
      )}
    </group>
  );
}
