import { avatarBodyMetrics, type AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, SRGBColorSpace, type Group } from "three";
import { createFacePaintCanvas } from "./facePaint";
import { beardPresentation, mouthPresentation } from "./mouthPresentation";
import { animationPose, avatarFacingYaw, proceduralPartStyle } from "./proceduralAvatar";

function materialRoughness(material: AvatarProfileV1["materials"]["outfit"]): number {
  return { velvet: 0.88, satin: 0.24, wool: 0.76, silk: 0.34 }[material];
}

function proceduralColor(
  base: string,
  style: ReturnType<typeof proceduralPartStyle>,
  strength = 1,
): string {
  const color = new Color(base);
  color.offsetHSL(
    (style.wave - 0.5) * 0.12 * strength,
    (style.sweep - 0.5) * 0.16 * strength,
    (style.signature - 0.5) * 0.14 * strength,
  );
  return `#${color.getHexString()}`;
}

function Mouth({
  mouthId,
  expressionId,
  lowPower,
}: {
  mouthId: string;
  expressionId: string;
  lowPower: boolean;
}) {
  const mouth = mouthPresentation(mouthId, expressionId);
  const radialSegments = lowPower ? 6 : 9;
  const tubularSegments = lowPower ? 14 : 24;
  const lipColor = "#74352f";
  return (
    <group position={[0, -0.22, 0.045]} scale={[mouth.widthScale, mouth.heightScale, 1]}>
      {mouth.shape === "neutral" && (
        <mesh rotation={[0, 0, mouth.rotationZ]}>
          <capsuleGeometry args={[mouth.thickness, 0.16, 5, tubularSegments]} />
          <meshStandardMaterial color={lipColor} roughness={0.62} />
        </mesh>
      )}
      {(mouth.shape === "smile" || mouth.shape === "frown") && (
        <mesh rotation={[0, 0, mouth.rotationZ]}>
          <torusGeometry
            args={[0.11, mouth.thickness, radialSegments, tubularSegments, mouth.arc]}
          />
          <meshStandardMaterial color={lipColor} roughness={0.62} />
        </mesh>
      )}
      {mouth.shape === "toothy" && (
        <group>
          <mesh scale={[1.16, 0.58, 0.28]}>
            <sphereGeometry args={[0.11, tubularSegments, radialSegments]} />
            <meshStandardMaterial color="#552723" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.022, 0.034]}>
            <boxGeometry args={[0.19, 0.043, 0.018]} />
            <meshStandardMaterial color="#fff7df" roughness={0.38} />
          </mesh>
        </group>
      )}
      {mouth.shape === "surprised" && (
        <group scale={[0.72, 1, 1]}>
          <mesh position={[0, 0, -0.008]}>
            <circleGeometry args={[0.079, tubularSegments]} />
            <meshStandardMaterial color="#4e211f" roughness={0.72} />
          </mesh>
          <mesh>
            <torusGeometry
              args={[0.08, mouth.thickness, radialSegments, tubularSegments, mouth.arc]}
            />
            <meshStandardMaterial color={lipColor} roughness={0.62} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Hair({
  profile,
  lowPower,
  headY,
}: {
  profile: AvatarProfileV1;
  lowPower: boolean;
  headY: number;
}) {
  const style = proceduralPartStyle("hair", profile.parts.hair);
  const family = Math.min(11, Math.floor(style.signature * 12));
  const hairColor = proceduralColor(profile.colors.hair, style, 0.72);
  const strands = 5 + Math.floor(style.sweep * 7);
  const spikes = 3 + Math.floor(style.wave * 4);
  const alternating = (index: number) => index - Math.floor(index / 2) * 2;
  return (
    <group position={[0, headY + 0.35 + style.signature * 0.045, -0.02]}>
      {family === 0 && (
        <mesh scale={[0.98 + style.signature * 0.11, 0.46 + style.wave * 0.2, 0.96]}>
          <sphereGeometry args={[0.59, lowPower ? 14 : 22, lowPower ? 10 : 16]} />
          <meshStandardMaterial color={hairColor} roughness={0.68 + style.sweep * 0.22} />
        </mesh>
      )}
      {family === 1 &&
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
              <meshStandardMaterial color={hairColor} roughness={0.76} />
            </mesh>
          );
        })}
      {family === 2 && (
        <>
          <mesh scale={[1.02 + style.signature * 0.06, 0.48 + style.wave * 0.16, 1]}>
            <sphereGeometry args={[0.6, lowPower ? 14 : 22, lowPower ? 10 : 15]} />
            <meshStandardMaterial color={hairColor} roughness={0.84} />
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
              <meshStandardMaterial color={hairColor} roughness={0.72} />
            </mesh>
          ))}
        </>
      )}
      {family === 3 &&
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
            <meshStandardMaterial color={hairColor} roughness={0.67} />
          </mesh>
        ))}
      {family === 4 && (
        <>
          <mesh scale={[1.02, 0.43 + style.signature * 0.1, 1]}>
            <sphereGeometry args={[0.58, lowPower ? 14 : 20, 12]} />
            <meshStandardMaterial color={hairColor} roughness={0.9} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (0.5 + style.wave * 0.08), 0.12 + style.sweep * 0.1, -0.02]}
            >
              <sphereGeometry args={[0.17 + style.signature * 0.09, lowPower ? 10 : 16, 10]} />
              <meshStandardMaterial color={hairColor} roughness={0.92} />
            </mesh>
          ))}
        </>
      )}
      {family === 5 &&
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
              <meshStandardMaterial color={hairColor} roughness={0.82} />
            </mesh>
          );
        })}
      {family === 6 && (
        <>
          <mesh scale={[1.02, 0.42 + style.wave * 0.12, 0.98]}>
            <sphereGeometry args={[0.59, lowPower ? 14 : 22, lowPower ? 10 : 15]} />
            <meshStandardMaterial color={hairColor} roughness={0.76} />
          </mesh>
          <mesh position={[0, -0.16, -0.46]} rotation={[0.18, 0, 0]}>
            <capsuleGeometry
              args={[0.13 + style.signature * 0.04, 0.5 + style.sweep * 0.5, 7, 12]}
            />
            <meshStandardMaterial color={hairColor} roughness={0.82} />
          </mesh>
        </>
      )}
      {family === 7 && (
        <>
          <mesh scale={[1.03, 0.43, 0.98]}>
            <sphereGeometry args={[0.58, lowPower ? 14 : 22, 12]} />
            <meshStandardMaterial color={hairColor} roughness={0.79} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (0.51 + style.sweep * 0.06), -0.24, -0.02]}
              rotation={[0, 0, side * 0.2]}
            >
              <capsuleGeometry
                args={[0.1 + style.wave * 0.03, 0.42 + style.signature * 0.45, 6, 11]}
              />
              <meshStandardMaterial color={hairColor} roughness={0.84} />
            </mesh>
          ))}
        </>
      )}
      {family === 8 &&
        Array.from({ length: lowPower ? 8 : 14 }, (_, index) => {
          const angle = (index / (lowPower ? 8 : 14)) * Math.PI * 2;
          return (
            <mesh
              key={index}
              position={[
                Math.cos(angle) * 0.42,
                Math.sin(angle * 2) * 0.16,
                Math.sin(angle) * 0.34,
              ]}
            >
              <sphereGeometry args={[0.19 + style.wave * 0.055, lowPower ? 8 : 12, 8]} />
              <meshStandardMaterial color={hairColor} roughness={0.95} />
            </mesh>
          );
        })}
      {family === 9 &&
        Array.from({ length: 5 + Math.floor(style.sweep * 4) }, (_, index) => (
          <mesh
            key={index}
            position={[0, 0.18, (index - 3.5) * 0.11]}
            rotation={[style.wave * 0.25, 0, 0]}
          >
            <coneGeometry args={[0.13 + style.signature * 0.035, 0.4 + style.wave * 0.28, 8]} />
            <meshStandardMaterial color={hairColor} roughness={0.66} />
          </mesh>
        ))}
      {family === 10 && (
        <>
          <mesh scale={[1.04, 0.54 + style.wave * 0.08, 1]}>
            <sphereGeometry args={[0.58, lowPower ? 14 : 22, 13]} />
            <meshStandardMaterial color={hairColor} roughness={0.74} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.48, -0.2, 0.08]}
              scale={[0.75, 1.2 + style.signature * 0.4, 0.7]}
            >
              <sphereGeometry args={[0.2, 10, 8]} />
              <meshStandardMaterial color={hairColor} roughness={0.78} />
            </mesh>
          ))}
        </>
      )}
      {family === 11 && (
        <>
          <mesh scale={[1, 0.42, 0.96]}>
            <sphereGeometry args={[0.58, lowPower ? 14 : 22, 12]} />
            <meshStandardMaterial color={hairColor} roughness={0.78} />
          </mesh>
          {Array.from({ length: 4 + Math.floor(style.wave * 3) }, (_, index) => (
            <mesh
              key={index}
              position={[0.28 + Math.sin(index) * 0.03, -0.12 - index * 0.14, -0.28]}
            >
              <sphereGeometry args={[0.095 - index * 0.006, 10, 8]} />
              <meshStandardMaterial color={hairColor} roughness={0.86} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

function FaceMark({ profile }: { profile: AvatarProfileV1 }) {
  const style = proceduralPartStyle("marks", profile.parts.marks);
  if (!style.active) return null;
  const family = Math.min(7, Math.floor(style.signature * 8));
  const color = proceduralColor(profile.colors.accent, style, 0.86);
  const position: [number, number, number] = [
    -0.3 + style.sweep * 0.6,
    -0.13 + style.wave * 0.27,
    0.038,
  ];
  const material = (
    <meshStandardMaterial color={color} transparent opacity={0.78} roughness={0.5} />
  );
  return (
    <group position={position} rotation={[0, 0, style.signature * Math.PI]}>
      {family === 0 && (
        <mesh>
          <circleGeometry
            args={[0.025 + style.signature * 0.03, 3 + Math.floor(style.sweep * 5)]}
          />
          {material}
        </mesh>
      )}
      {family === 1 && (
        <mesh rotation={[0, 0, 0.55]}>
          <boxGeometry args={[0.025 + style.wave * 0.025, 0.16 + style.signature * 0.09, 0.012]} />
          {material}
        </mesh>
      )}
      {family === 2 && (
        <mesh>
          <torusGeometry
            args={[0.045 + style.signature * 0.025, 0.012 + style.wave * 0.008, 7, 16]}
          />
          {material}
        </mesh>
      )}
      {family === 3 && (
        <mesh scale={[0.8 + style.sweep * 0.5, 1, 0.5]}>
          <octahedronGeometry args={[0.055 + style.signature * 0.025, 0]} />
          {material}
        </mesh>
      )}
      {family === 4 &&
        [-1, 0, 1].map((offset) => (
          <mesh key={offset} position={[offset * (0.038 + style.sweep * 0.012), 0, 0]}>
            <circleGeometry args={[0.014 + style.wave * 0.008, 12]} />
            {material}
          </mesh>
        ))}
      {family === 5 && (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.06 + style.signature * 0.02, 0.012, 8, 18, Math.PI * 1.45]} />
          {material}
        </mesh>
      )}
      {family === 6 &&
        [-1, 1].map((offset) => (
          <mesh key={offset} position={[0, offset * 0.035, 0]} rotation={[0, 0, 0.35]}>
            <boxGeometry args={[0.14 + style.sweep * 0.06, 0.015 + style.wave * 0.008, 0.01]} />
            {material}
          </mesh>
        ))}
      {family === 7 && (
        <>
          <mesh>
            <tetrahedronGeometry args={[0.065 + style.signature * 0.025, 0]} />
            {material}
          </mesh>
          <mesh position={[0, -0.09, 0]}>
            <sphereGeometry args={[0.018 + style.wave * 0.009, 10, 8]} />
            {material}
          </mesh>
        </>
      )}
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

function Avatar3DView({
  profile,
  lowPower = false,
  active = false,
  viewYaw,
}: {
  profile: AvatarProfileV1;
  lowPower?: boolean;
  active?: boolean;
  /** First-person camera yaw; the model turns its face toward the same direction. */
  viewYaw?: number;
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
  const facePaintJson = JSON.stringify(profile.facePaint ?? null);
  const facePaintTexture = useMemo(() => {
    const facePaint = JSON.parse(facePaintJson) as AvatarProfileV1["facePaint"];
    if (!facePaint?.strokes.length || typeof document === "undefined") return null;
    const texture = new CanvasTexture(createFacePaintCanvas(facePaint));
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [facePaintJson]);
  useEffect(() => () => facePaintTexture?.dispose(), [facePaintTexture]);
  const body = avatarBodyMetrics(profile);
  const headY = 1.75 + (body.torsoLength - 1) * 0.24 + (body.legLength - 1) * 0.08;
  const armY = 1.02 + (body.torsoLength - 1) * 0.2;
  const legY = 0.27 + (body.legLength - 1) * 0.18;
  const headScale: [number, number, number] = [
    (0.78 + profile.morphs.faceWidth * 0.36) * (0.86 + style.head.signature * 0.28),
    0.84 + style.head.wave * 0.22,
    0.82 + style.head.sweep * 0.18,
  ];
  useFrame(({ clock }) => {
    if (lowPower || !root.current) return;
    const pose = animationPose(profile.animationSetId, clock.elapsedTime, active);
    root.current.position.set(pose.rootX, pose.rootY, 0);
    root.current.rotation.set(0, avatarFacingYaw(viewYaw, pose.rootYaw), pose.rootRoll);
    if (bodyRig.current) bodyRig.current.rotation.x = pose.bodyPitch;
    if (headRig.current) headRig.current.rotation.set(pose.headPitch, pose.headYaw, 0);
    if (leftArm.current) {
      leftArm.current.rotation.z = 0.2 + pose.leftArm;
      leftArm.current.position.y = armY + pose.leftArmLift;
    }
    if (rightArm.current) {
      rightArm.current.rotation.z = -0.2 + pose.rightArm;
      rightArm.current.position.y = armY + pose.rightArmLift;
    }
    if (leftLeg.current) leftLeg.current.position.y = legY + pose.legLift;
    if (rightLeg.current) rightLeg.current.position.y = legY - pose.legLift * 0.35;
  });
  const outfitRoughness = materialRoughness(profile.materials.outfit);
  const eyewearFamily = Math.min(9, Math.floor(style.eyewear.signature * 10));
  const headwearFamily = Math.min(11, Math.floor(style.headwear.signature * 12));
  const eyewearColor = proceduralColor(profile.colors.accent, style.eyewear, 0.88);
  const headwearColor = proceduralColor(profile.colors.accent, style.headwear, 1);
  const beard = beardPresentation(profile.parts.beard);
  return (
    <group ref={root} rotation={[0, avatarFacingYaw(viewYaw), 0]} scale={[1, body.heightScale, 1]}>
      <group ref={bodyRig}>
        <mesh
          position={[0, 0.95, 0]}
          scale={[
            body.shoulderWidth * (0.93 + style.tops.signature * 0.12),
            body.torsoLength * (1 + style.tops.wave * 0.08),
            body.bodyDepth * (0.92 + style.tops.sweep * 0.06),
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
        <group scale={[body.shoulderWidth, body.torsoLength, body.bodyDepth]}>
          <FullOutfit profile={profile} />
        </group>
        {style.outerwear.active && (
          <group>
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                position={[
                  side * body.shoulderWidth * (0.43 + style.outerwear.signature * 0.07),
                  1.18 + (body.torsoLength - 1) * 0.2,
                  -0.01,
                ]}
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

      <group ref={headRig} position={[0, headY, 0]}>
        <mesh scale={headScale} castShadow>
          <sphereGeometry args={[0.56, lowPower ? 16 : 28, lowPower ? 12 : 22]} />
          <meshStandardMaterial
            color={profile.colors.skin}
            roughness={0.5 + style.skin.signature * 0.32}
          />
        </mesh>
        {facePaintTexture && (
          <mesh scale={headScale} renderOrder={2}>
            <sphereGeometry args={[0.565, lowPower ? 16 : 28, lowPower ? 12 : 22]} />
            <meshBasicMaterial
              map={facePaintTexture}
              transparent
              alphaTest={0.01}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              toneMapped={false}
            />
          </mesh>
        )}
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
          <Mouth
            mouthId={profile.parts.mouth}
            expressionId={profile.parts.expression}
            lowPower={lowPower}
          />
          {style.beard.active && (
            <mesh
              position={[0, -0.26 - style.beard.signature * 0.04, -0.005]}
              rotation={[0, 0, beard.rotationZ]}
              scale={[beard.widthScale, beard.heightScale, 1]}
            >
              <torusGeometry args={[0.17, beard.thickness, 7, 18, Math.PI]} />
              <meshStandardMaterial color={profile.colors.hair} roughness={0.92} />
            </mesh>
          )}
          <FaceMark profile={profile} />
        </group>
      </group>

      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[
            side * (0.56 + style.ears.signature * 0.035),
            headY + 0.01 + (style.ears.wave - 0.5) * 0.065,
            0,
          ]}
          scale={[0.62 + style.ears.signature * 0.22, 0.9 + style.ears.sweep * 0.25, 0.65]}
        >
          <sphereGeometry args={[0.15, 12, 9]} />
          <meshStandardMaterial color={profile.colors.skin} roughness={0.72} />
        </mesh>
      ))}
      <Hair profile={profile} lowPower={lowPower} headY={headY} />

      <group ref={leftArm} position={[-0.52 * body.shoulderWidth, armY, 0]} rotation={[0, 0, 0.2]}>
        <mesh
          position={[0, -0.28 * body.armLength, 0]}
          scale={[1 + style.tops.signature * 0.09, body.armLength, body.bodyDepth]}
        >
          <capsuleGeometry args={[0.11, 0.55 + style.tops.wave * 0.08, 6, 10]} />
          <meshStandardMaterial color={profile.colors.skin} />
        </mesh>
        {style.gloves.active && (
          <mesh
            position={[0, -0.61 * body.armLength - style.gloves.signature * 0.03, 0]}
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
      <group ref={rightArm} position={[0.52 * body.shoulderWidth, armY, 0]} rotation={[0, 0, -0.2]}>
        <mesh
          position={[0, -0.28 * body.armLength, 0]}
          scale={[1 + style.tops.signature * 0.09, body.armLength, body.bodyDepth]}
        >
          <capsuleGeometry args={[0.11, 0.55 + style.tops.wave * 0.08, 6, 10]} />
          <meshStandardMaterial color={profile.colors.skin} />
        </mesh>
        {style.gloves.active && (
          <mesh
            position={[0, -0.61 * body.armLength - style.gloves.signature * 0.03, 0]}
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

      <group
        ref={leftLeg}
        position={[-body.hipWidth * (0.23 + style.bottoms.signature * 0.025), legY, 0]}
      >
        <mesh
          scale={[
            body.hipWidth * (1 + style.bottoms.signature * 0.18),
            body.legLength * (1 + style.bottoms.wave * 0.08),
            body.bodyDepth,
          ]}
        >
          <capsuleGeometry args={[0.12, 0.46, 6, 10]} />
          <meshStandardMaterial color={profile.colors.outfit} roughness={0.72} />
        </mesh>
        <mesh
          position={[0, -0.36 * body.legLength, 0.1]}
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
      <group
        ref={rightLeg}
        position={[body.hipWidth * (0.23 + style.bottoms.signature * 0.025), legY, 0]}
      >
        <mesh
          scale={[
            body.hipWidth * (1 + style.bottoms.signature * 0.18),
            body.legLength * (1 + style.bottoms.wave * 0.08),
            body.bodyDepth,
          ]}
        >
          <capsuleGeometry args={[0.12, 0.46, 6, 10]} />
          <meshStandardMaterial color={profile.colors.outfit} roughness={0.72} />
        </mesh>
        <mesh
          position={[0, -0.36 * body.legLength, 0.1]}
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
              headY - 0.2 - style.earrings.wave * 0.07,
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
          position={[0, headY + 0.1 + style.eyewear.signature * 0.025, 0.55]}
          rotation={[0, 0, (style.eyewear.wave - 0.5) * 0.07]}
        >
          {eyewearFamily <= 1 &&
            [-1, 1].map((side) => (
              <mesh
                key={side}
                position={[side * (0.2 + style.eyewear.signature * 0.018), 0, 0]}
                scale={[1 + style.eyewear.signature * 0.25, 0.72 + style.eyewear.sweep * 0.32, 1]}
              >
                <torusGeometry args={[0.13, 0.014 + style.eyewear.wave * 0.018, 8, 20]} />
                <meshStandardMaterial color={eyewearColor} metalness={0.74} />
              </mesh>
            ))}
          {(eyewearFamily === 2 || eyewearFamily === 3) &&
            [-1, 1].map((side) => (
              <group
                key={side}
                position={[side * 0.2, 0, 0]}
                rotation={[0, 0, side * (eyewearFamily === 3 ? -0.1 : 0)]}
              >
                <mesh
                  scale={[
                    1.05 + style.eyewear.signature * 0.18,
                    0.7 + style.eyewear.sweep * 0.2,
                    1,
                  ]}
                >
                  <boxGeometry args={[0.29, 0.18, 0.025]} />
                  <meshStandardMaterial
                    color={eyewearFamily === 3 ? profile.colors.eyes : "#11191d"}
                    metalness={0.28}
                    roughness={0.16}
                    transparent
                    opacity={0.88}
                  />
                </mesh>
                <mesh position={[0, 0, -0.012]}>
                  <boxGeometry args={[0.31, 0.025, 0.035]} />
                  <meshStandardMaterial color={eyewearColor} metalness={0.72} />
                </mesh>
              </group>
            ))}
          {(eyewearFamily === 4 || eyewearFamily === 5) && (
            <mesh scale={[1 + style.eyewear.signature * 0.16, 0.72 + style.eyewear.wave * 0.25, 1]}>
              <boxGeometry args={[0.72, 0.2, 0.028]} />
              <meshStandardMaterial
                color={eyewearFamily === 5 ? eyewearColor : "#263d52"}
                metalness={0.5}
                roughness={0.12}
                transparent
                opacity={0.78}
              />
            </mesh>
          )}
          {eyewearFamily === 6 && (
            <>
              <mesh position={[-0.2, 0, 0]}>
                <torusGeometry args={[0.145 + style.eyewear.signature * 0.02, 0.02, 9, 22]} />
                <meshStandardMaterial color={eyewearColor} metalness={0.82} />
              </mesh>
              {Array.from({ length: 4 }, (_, index) => (
                <mesh key={index} position={[-0.32 + index * 0.028, -0.13 - index * 0.055, -0.01]}>
                  <sphereGeometry args={[0.012 + style.eyewear.wave * 0.005, 8, 6]} />
                  <meshStandardMaterial color={eyewearColor} metalness={0.8} />
                </mesh>
              ))}
            </>
          )}
          {eyewearFamily === 7 &&
            [-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.2, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.14 + style.eyewear.wave * 0.025, 0.14, 0.07, 18]} />
                <meshStandardMaterial color={eyewearColor} metalness={0.62} roughness={0.22} />
              </mesh>
            ))}
          {eyewearFamily === 8 &&
            Array.from({ length: 7 }, (_, index) => (
              <mesh
                key={index}
                position={[(index - 3) * 0.095, 0.06 - Math.abs(index - 3) * 0.018, 0]}
                scale={0.75 + style.eyewear.signature * 0.35}
              >
                <octahedronGeometry args={[0.035 + style.eyewear.wave * 0.012, 0]} />
                <meshStandardMaterial color={eyewearColor} metalness={0.55} roughness={0.18} />
              </mesh>
            ))}
          {eyewearFamily === 9 &&
            [-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.21, 0, 0]} rotation={[0, 0, side * -0.18]}>
                <coneGeometry args={[0.17 + style.eyewear.wave * 0.035, 0.31, 3]} />
                <meshStandardMaterial
                  color={eyewearColor}
                  transparent
                  opacity={0.84}
                  metalness={0.36}
                />
              </mesh>
            ))}
          <mesh>
            <boxGeometry args={[0.12 + style.eyewear.signature * 0.06, 0.018, 0.018]} />
            <meshStandardMaterial color={eyewearColor} metalness={0.74} />
          </mesh>
        </group>
      )}
      {style.headwear.active && (
        <group
          position={[0, headY + 0.7 + style.headwear.signature * 0.14, 0]}
          rotation={[0, 0, (style.headwear.wave - 0.5) * 0.16]}
        >
          {headwearFamily === 0 && (
            <>
              <mesh>
                <cylinderGeometry
                  args={[
                    0.34 + style.headwear.signature * 0.08,
                    0.43 + style.headwear.sweep * 0.07,
                    0.25 + style.headwear.wave * 0.25,
                    20,
                  ]}
                />
                <meshStandardMaterial color={headwearColor} roughness={0.36} />
              </mesh>
              <mesh position={[0, -0.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.43, 0.065, 8, 24]} />
                <meshStandardMaterial color={headwearColor} roughness={0.4} />
              </mesh>
            </>
          )}
          {headwearFamily === 1 && (
            <>
              <mesh position={[0, -0.12, 0]}>
                <cylinderGeometry args={[0.4, 0.43, 0.19, 8]} />
                <meshStandardMaterial color={headwearColor} metalness={0.68} />
              </mesh>
              {[-1, -0.5, 0, 0.5, 1].map((offset) => (
                <mesh
                  key={offset}
                  position={[offset * 0.31, 0.12 + (1 - Math.abs(offset)) * 0.05, 0]}
                >
                  <coneGeometry
                    args={[
                      0.11 + style.headwear.signature * 0.025,
                      0.35 + style.headwear.wave * 0.16,
                      6,
                    ]}
                  />
                  <meshStandardMaterial color={headwearColor} metalness={0.76} />
                </mesh>
              ))}
            </>
          )}
          {headwearFamily === 2 && (
            <>
              <mesh>
                <coneGeometry
                  args={[
                    0.4 + style.headwear.signature * 0.13,
                    0.55 + style.headwear.wave * 0.48,
                    20,
                  ]}
                />
                <meshStandardMaterial color={headwearColor} roughness={0.3} />
              </mesh>
              <mesh position={[0, -0.27, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.42, 0.055, 8, 24]} />
                <meshStandardMaterial color={headwearColor} roughness={0.34} />
              </mesh>
            </>
          )}
          {headwearFamily === 3 && (
            <>
              <mesh scale={[1 + style.headwear.signature * 0.14, 0.46, 0.94]}>
                <sphereGeometry args={[0.49, 18, 12]} />
                <meshStandardMaterial color={headwearColor} roughness={0.62} />
              </mesh>
              <mesh position={[0, -0.11, 0.34 + style.headwear.sweep * 0.05]}>
                <boxGeometry args={[0.5 + style.headwear.signature * 0.16, 0.055, 0.35]} />
                <meshStandardMaterial color={headwearColor} roughness={0.58} />
              </mesh>
            </>
          )}
          {headwearFamily === 4 && (
            <mesh
              position={[0, 0.12 + style.headwear.wave * 0.16, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1 + style.headwear.signature * 0.2, 1, 1]}
            >
              <torusGeometry args={[0.4, 0.035 + style.headwear.wave * 0.025, 9, 28]} />
              <meshStandardMaterial
                color={headwearColor}
                emissive={headwearColor}
                emissiveIntensity={0.2}
                metalness={0.82}
              />
            </mesh>
          )}
          {headwearFamily === 5 && (
            <>
              <mesh position={[0, -0.13, 0.02]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry
                  args={[0.39, 0.055 + style.headwear.signature * 0.025, 9, 24, Math.PI]}
                />
                <meshStandardMaterial color={headwearColor} metalness={0.48} />
              </mesh>
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  position={[side * (0.29 + style.headwear.sweep * 0.06), 0.12, 0]}
                  rotation={[0, 0, side * -0.22]}
                >
                  <coneGeometry args={[0.13, 0.34 + style.headwear.wave * 0.16, 5]} />
                  <meshStandardMaterial color={headwearColor} metalness={0.55} />
                </mesh>
              ))}
            </>
          )}
          {headwearFamily === 6 && (
            <>
              <mesh position={[0, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.4, 0.025 + style.headwear.wave * 0.015, 8, 26]} />
                <meshStandardMaterial color={headwearColor} roughness={0.52} />
              </mesh>
              {Array.from({ length: 6 + Math.floor(style.headwear.sweep * 3) }, (_, index) => {
                const angle = (index / (6 + Math.floor(style.headwear.sweep * 3))) * Math.PI * 2;
                return (
                  <mesh
                    key={index}
                    position={[
                      Math.cos(angle) * 0.22,
                      0.02 + Math.sin(angle) * 0.08,
                      Math.sin(angle) * 0.16,
                    ]}
                    rotation={[0, 0, angle]}
                    scale={[1.45, 0.64, 0.55]}
                  >
                    <sphereGeometry args={[0.09 + style.headwear.signature * 0.02, 10, 7]} />
                    <meshStandardMaterial color={headwearColor} roughness={0.72} />
                  </mesh>
                );
              })}
              <mesh position={[0, 0.03, 0.18]}>
                <sphereGeometry args={[0.1, 12, 9]} />
                <meshStandardMaterial
                  color={proceduralColor("#f1bb41", style.headwear)}
                  metalness={0.25}
                />
              </mesh>
            </>
          )}
          {headwearFamily === 7 && (
            <>
              <mesh position={[0, -0.23, 0]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry
                  args={[0.48, 0.035 + style.headwear.signature * 0.02, 9, 28, Math.PI]}
                />
                <meshStandardMaterial color={headwearColor} metalness={0.45} roughness={0.38} />
              </mesh>
              {[-1, 1].map((side) => (
                <mesh key={side} position={[side * 0.5, -0.62, 0]} scale={[0.55, 1, 0.7]}>
                  <capsuleGeometry args={[0.14 + style.headwear.wave * 0.025, 0.18, 7, 11]} />
                  <meshStandardMaterial color={headwearColor} metalness={0.28} roughness={0.4} />
                </mesh>
              ))}
            </>
          )}
          {headwearFamily === 8 && (
            <>
              <mesh position={[0, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.4, 0.026, 8, 24]} />
                <meshStandardMaterial color={headwearColor} metalness={0.62} />
              </mesh>
              {[-1, 0, 1].map((offset) => (
                <mesh
                  key={offset}
                  position={[offset * 0.16, 0.22 + (1 - Math.abs(offset)) * 0.13, 0]}
                  rotation={[0, 0, offset * -0.22]}
                  scale={[
                    0.5 + style.headwear.wave * 0.16,
                    1.2 + style.headwear.signature * 0.35,
                    0.38,
                  ]}
                >
                  <coneGeometry args={[0.14, 0.55 + style.headwear.sweep * 0.25, 5]} />
                  <meshStandardMaterial color={headwearColor} roughness={0.68} />
                </mesh>
              ))}
            </>
          )}
          {headwearFamily === 9 && (
            <>
              <mesh position={[0, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.42, 0.032, 8, 26]} />
                <meshStandardMaterial color={headwearColor} metalness={0.72} />
              </mesh>
              <mesh position={[0, -0.43, 0.4]} rotation={[0.05, 0, 0]}>
                <planeGeometry
                  args={[0.76 + style.headwear.signature * 0.15, 0.68 + style.headwear.wave * 0.22]}
                />
                <meshStandardMaterial
                  color={headwearColor}
                  transparent
                  opacity={0.25 + style.headwear.sweep * 0.25}
                  side={2}
                />
              </mesh>
            </>
          )}
          {headwearFamily === 10 && (
            <>
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  position={[side * 0.17, 0, 0]}
                  rotation={[0, 0, side * 0.2]}
                  scale={[1.25, 0.8, 0.7]}
                >
                  <torusGeometry args={[0.16 + style.headwear.wave * 0.025, 0.055, 8, 18]} />
                  <meshStandardMaterial color={headwearColor} roughness={0.48} />
                </mesh>
              ))}
              <mesh>
                <octahedronGeometry args={[0.1 + style.headwear.signature * 0.025, 0]} />
                <meshStandardMaterial color={headwearColor} metalness={0.32} />
              </mesh>
            </>
          )}
          {headwearFamily === 11 && (
            <>
              {[-1, 1].map((side) => (
                <group
                  key={side}
                  position={[side * 0.22, -0.08, 0]}
                  rotation={[0, 0, side * -0.28]}
                >
                  <mesh position={[0, 0.24, 0]}>
                    <cylinderGeometry args={[0.018, 0.025, 0.48 + style.headwear.wave * 0.18, 8]} />
                    <meshStandardMaterial color={headwearColor} metalness={0.75} />
                  </mesh>
                  <mesh position={[0, 0.51 + style.headwear.wave * 0.09, 0]}>
                    <dodecahedronGeometry args={[0.11 + style.headwear.signature * 0.025, 0]} />
                    <meshStandardMaterial
                      color={headwearColor}
                      emissive={headwearColor}
                      emissiveIntensity={0.18}
                    />
                  </mesh>
                </group>
              ))}
            </>
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

export const Avatar3D = memo(
  Avatar3DView,
  (previous, next) =>
    previous.lowPower === next.lowPower &&
    previous.active === next.active &&
    previous.viewYaw === next.viewYaw &&
    JSON.stringify(previous.profile) === JSON.stringify(next.profile),
);
Avatar3D.displayName = "Avatar3D";
