import { Canvas } from "@react-three/fiber";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { Avatar3D } from "./Avatar3D";

export function AvatarPortrait({ profile, label }: { profile: AvatarProfileV1; label: string }) {
  return (
    <div className="avatar-portrait" role="img" aria-label={label}>
      <Canvas dpr={0.65} frameloop="demand" camera={{ position: [0, 1.78, 4.2], fov: 34 }}>
        <ambientLight intensity={2.2} />
        <directionalLight position={[3, 5, 4]} intensity={2.5} />
        <Avatar3D profile={profile} lowPower />
      </Canvas>
    </div>
  );
}
