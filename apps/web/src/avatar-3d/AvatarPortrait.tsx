import { Canvas } from "@react-three/fiber";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { Avatar3D } from "./Avatar3D";

export function AvatarPortrait({ profile, label }: { profile: AvatarProfileV1; label: string }) {
  const suppressCanvas =
    import.meta.env.DEV &&
    (window as unknown as { __DAIFUGO_E2E_RENDER_CANVAS__?: boolean })
      .__DAIFUGO_E2E_RENDER_CANVAS__ === false;
  return (
    <div className="avatar-portrait" role="img" aria-label={label}>
      {!suppressCanvas && (
        <Canvas dpr={0.65} frameloop="demand" camera={{ position: [0, 1.78, 4.2], fov: 34 }}>
          <ambientLight intensity={2.2} />
          <directionalLight position={[3, 5, 4]} intensity={2.5} />
          <Avatar3D profile={profile} lowPower />
        </Canvas>
      )}
    </div>
  );
}
