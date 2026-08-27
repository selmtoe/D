import { Canvas } from "@react-three/fiber";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useEffect, useRef, useState } from "react";
import { Avatar3D } from "./Avatar3D";

export function AvatarPortrait({ profile, label }: { profile: AvatarProfileV1; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const suppressCanvas =
    import.meta.env.DEV &&
    (window as unknown as { __DAIFUGO_E2E_RENDER_CANVAS__?: boolean })
      .__DAIFUGO_E2E_RENDER_CANVAS__ === false;
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "120px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="avatar-portrait" role="img" aria-label={label}>
      {!suppressCanvas && nearViewport && (
        <Canvas
          dpr={0.65}
          frameloop="demand"
          camera={{ position: [0, 1.78, 4.2], rotation: [0, 0, 0], fov: 34 }}
        >
          <ambientLight intensity={2.2} />
          <directionalLight position={[3, 5, 4]} intensity={2.5} />
          <Avatar3D profile={profile} lowPower />
        </Canvas>
      )}
    </div>
  );
}
