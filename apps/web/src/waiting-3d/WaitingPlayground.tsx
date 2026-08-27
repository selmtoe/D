import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Group } from "three";
import { Avatar3D } from "../avatar-3d/Avatar3D";
import { useUiStore } from "../app/store";
import {
  applyPlaygroundLook,
  playgroundPerformanceProfile,
  stepPlaygroundPosition,
  type PlaygroundLook,
  type PlaygroundMovement,
} from "./controls";
import "./waiting-playground.css";

export type WaitingPlaygroundMember = {
  id: string;
  name: string;
  avatar: AvatarProfileV1;
  cpu?: boolean | undefined;
  spectator?: boolean | undefined;
};

type NavigatorWithDeviceMemory = Navigator & { deviceMemory?: number };

const CAMERA_HEIGHT = 1.65;

function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(pointer: coarse), (max-width: 720px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse), (max-width: 720px)");
    const update = () => setMobile(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return mobile;
}

function FramePump({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let previous = 0;
    const interval = 1000 / fps;
    const tick = (now: number) => {
      if (now - previous >= interval) {
        previous = now;
        invalidate();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fps, invalidate]);
  return null;
}

function FirstPersonController({
  movement,
  look,
  resetVersion,
}: {
  movement: MutableRefObject<PlaygroundMovement>;
  look: MutableRefObject<PlaygroundLook>;
  resetVersion: number;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const keyboard = useRef(new Set<string>());
  const position = useRef({ x: 0, z: 8.4 });
  useEffect(() => {
    position.current = { x: 0, z: 8.4 };
    look.current = { yaw: 0, pitch: -0.04 };
    camera.position.set(0, CAMERA_HEIGHT, 8.4);
    camera.rotation.set(-0.04, 0, 0, "YXZ");
  }, [camera, look, resetVersion]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        keyboard.current.add(event.code);
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => keyboard.current.delete(event.code);
    const clear = () => keyboard.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  useFrame((_, delta) => {
    const forward =
      movement.current.forward +
      Number(keyboard.current.has("KeyW")) -
      Number(keyboard.current.has("KeyS"));
    const right =
      movement.current.right +
      Number(keyboard.current.has("KeyD")) -
      Number(keyboard.current.has("KeyA"));
    const sprinting = keyboard.current.has("ShiftLeft") || keyboard.current.has("ShiftRight");
    position.current = stepPlaygroundPosition(
      position.current,
      look.current,
      { forward, right },
      Math.min(delta, 0.05) * (sprinting ? 7.4 : 4.8),
    );
    camera.position.set(position.current.x, CAMERA_HEIGHT, position.current.z);
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, "YXZ");
    canvas.dataset.waitingPlaygroundPose = [
      position.current.x,
      CAMERA_HEIGHT,
      position.current.z,
      look.current.yaw,
      look.current.pitch,
    ]
      .map((value) => value.toFixed(3))
      .join(",");
  });
  return null;
}

function MemberAvatar({
  member,
  index,
  total,
  economical,
  reducedMotion,
}: {
  member: WaitingPlaygroundMember;
  index: number;
  total: number;
  economical: boolean;
  reducedMotion: boolean;
}) {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  const radius = total <= 3 ? 4.6 : 5.8;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return (
    <group position={[x, 0.18, z]} rotation={[0, -angle - Math.PI / 2, 0]}>
      <mesh position={[0, -0.11, 0]} receiveShadow>
        <cylinderGeometry args={[0.78, 0.9, 0.2, economical ? 16 : 28]} />
        <meshStandardMaterial color={member.spectator ? "#37658a" : "#79582b"} roughness={0.74} />
      </mesh>
      <group scale={0.72}>
        <Avatar3D
          profile={member.avatar}
          lowPower={economical}
          active={!reducedMotion && !economical}
        />
      </group>
      <Html center position={[0, 2.65, 0]} distanceFactor={8} className="waiting-member-label">
        <span>{member.name}</span>
        {member.cpu && <small>CPU</small>}
        {member.spectator && <small>観戦</small>}
      </Html>
    </group>
  );
}

function MovingPlaygroundDecor({ reducedMotion }: { reducedMotion: boolean }) {
  const ring = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ring.current || reducedMotion) return;
    ring.current.rotation.y = clock.elapsedTime * 0.22;
    ring.current.position.y = 2.3 + Math.sin(clock.elapsedTime * 0.7) * 0.12;
  });
  return (
    <group ref={ring} position={[0, 2.3, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.45, 0.08, 10, 36]} />
        <meshStandardMaterial color="#e8c66f" emissive="#71591f" emissiveIntensity={0.7} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[1.05, 0.055, 8, 30]} />
        <meshStandardMaterial color="#6ed9c0" emissive="#175e55" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function PlaygroundWorld({
  members,
  economical,
  reducedMotion,
}: {
  members: WaitingPlaygroundMember[];
  economical: boolean;
  reducedMotion: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#102725"]} />
      <fog attach="fog" args={["#102725", 18, 34]} />
      <ambientLight intensity={1.35} color="#d5eee6" />
      <directionalLight
        castShadow={!economical}
        position={[5, 9, 7]}
        intensity={2.2}
        color="#ffe2a0"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[0, 4, 0]} intensity={18} distance={14} color="#6ed9c0" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[13, economical ? 40 : 72]} />
        <meshStandardMaterial color="#24483f" roughness={0.93} />
      </mesh>
      <gridHelper
        args={[24, economical ? 16 : 24, "#6e9f87", "#315e52"]}
        position={[0, 0.012, 0]}
      />
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.2, 2.32, economical ? 32 : 64]} />
        <meshStandardMaterial color="#d0aa55" emissive="#5e4317" emissiveIntensity={0.35} />
      </mesh>
      <MovingPlaygroundDecor reducedMotion={reducedMotion} />
      {members.map((member, index) => (
        <MemberAvatar
          key={member.id}
          member={member}
          index={index}
          total={members.length}
          economical={economical}
          reducedMotion={reducedMotion}
        />
      ))}
      {(
        [
          [-8, -7],
          [8, -7],
          [-8, 7],
          [8, 7],
        ] satisfies Array<[number, number]>
      ).map(([x, z], index) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow={!economical}>
            <boxGeometry args={[1.5, 1, 1.5]} />
            <meshStandardMaterial color={index % 2 ? "#b46351" : "#496e9b"} roughness={0.76} />
          </mesh>
          <mesh position={[0, 1.22, 0]} rotation={[0.22, index * 0.7, 0.18]}>
            <octahedronGeometry args={[0.46, 0]} />
            <meshStandardMaterial color="#f2d987" emissive="#604f19" emissiveIntensity={0.4} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function MobileMovementPad({ movement }: { movement: MutableRefObject<PlaygroundMovement> }) {
  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const activePointer = useRef<number | undefined>(undefined);
  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pad.current || activePointer.current !== event.pointerId) return;
    const box = pad.current.getBoundingClientRect();
    const radius = Math.max(1, box.width * 0.34);
    const rawX = event.clientX - (box.left + box.width / 2);
    const rawY = event.clientY - (box.top + box.height / 2);
    const scale = Math.min(1, radius / Math.max(radius, Math.hypot(rawX, rawY)));
    const x = rawX * scale;
    const y = rawY * scale;
    movement.current = { right: x / radius, forward: -y / radius };
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`;
  };
  const reset = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && activePointer.current !== event.pointerId) return;
    activePointer.current = undefined;
    movement.current = { right: 0, forward: 0 };
    if (knob.current) knob.current.style.transform = "translate(0, 0)";
  };
  return (
    <div
      ref={pad}
      className="waiting-movement-pad"
      role="group"
      aria-label="移動パッド"
      onPointerDown={(event) => {
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
        event.stopPropagation();
      }}
      onPointerMove={update}
      onPointerUp={reset}
      onPointerCancel={reset}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="waiting-pad-arrow up" aria-hidden="true">
        ▲
      </span>
      <span className="waiting-pad-arrow right" aria-hidden="true">
        ▶
      </span>
      <span className="waiting-pad-arrow down" aria-hidden="true">
        ▼
      </span>
      <span className="waiting-pad-arrow left" aria-hidden="true">
        ◀
      </span>
      <span ref={knob} className="waiting-pad-knob" aria-hidden="true" />
    </div>
  );
}

export function WaitingPlayground({
  members,
  onClose,
}: {
  members: WaitingPlaygroundMember[];
  onClose: () => void;
}) {
  const lowPower = useUiStore((state) => state.lowPower);
  const reducedMotion = useUiStore((state) => state.reducedMotion);
  const forcedMobile = useUiStore((state) => state.mobileMode);
  const mobileViewport = useMobileViewport();
  const mobile = forcedMobile || mobileViewport;
  const profile = useMemo(
    () =>
      playgroundPerformanceProfile({
        lowPower,
        mobile,
        reducedMotion,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as NavigatorWithDeviceMemory).deviceMemory,
      }),
    [lowPower, mobile, reducedMotion],
  );
  const movement = useRef<PlaygroundMovement>({ forward: 0, right: 0 });
  const look = useRef<PlaygroundLook>({ yaw: 0, pitch: -0.04 });
  const lookPointer = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const pointerLockChange = () =>
      setPointerLocked(Boolean(viewport.current?.contains(document.pointerLockElement)));
    const mouseMove = (event: MouseEvent) => {
      if (!viewport.current?.contains(document.pointerLockElement)) return;
      look.current = applyPlaygroundLook(look.current, event.movementX, event.movementY);
    };
    const escapePointerLock = (event: KeyboardEvent) => {
      if (event.key === "Escape" && viewport.current?.contains(document.pointerLockElement)) {
        document.exitPointerLock?.();
      }
    };
    document.addEventListener("pointerlockchange", pointerLockChange);
    document.addEventListener("mousemove", mouseMove);
    document.addEventListener("keydown", escapePointerLock);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerlockchange", pointerLockChange);
      document.removeEventListener("mousemove", mouseMove);
      document.removeEventListener("keydown", escapePointerLock);
      if (viewport.current?.contains(document.pointerLockElement)) document.exitPointerLock?.();
    };
  }, []);

  const beginLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || mobile) {
      lookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const canvas = viewport.current?.querySelector("canvas");
    if (canvas && document.pointerLockElement !== canvas) {
      const request = canvas.requestPointerLock?.();
      if (request) void request.catch(() => undefined);
    }
  };
  const moveLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = lookPointer.current;
    if (!previous || previous.id !== event.pointerId) return;
    look.current = applyPlaygroundLook(
      look.current,
      event.clientX - previous.x,
      event.clientY - previous.y,
      0.005,
    );
    lookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const endLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointer.current?.id === event.pointerId) lookPointer.current = undefined;
  };
  const close = () => {
    if (viewport.current?.contains(document.pointerLockElement)) document.exitPointerLock?.();
    onClose();
  };

  return (
    <section
      className="waiting-playground"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiting-playground-title"
      data-performance-mode={profile.economical ? "economical" : "full"}
    >
      <div
        ref={viewport}
        className="waiting-playground-viewport"
        data-pointer-locked={pointerLocked ? "true" : "false"}
        onPointerDown={beginLook}
        onPointerMove={moveLook}
        onPointerUp={endLook}
        onPointerCancel={endLook}
      >
        <Canvas
          frameloop="demand"
          dpr={profile.dpr}
          shadows={profile.shadows}
          camera={{ position: [0, CAMERA_HEIGHT, 8.4], fov: mobile ? 72 : 67, near: 0.08, far: 42 }}
          gl={{
            antialias: !profile.economical,
            powerPreference: profile.economical ? "low-power" : "high-performance",
          }}
        >
          <FramePump fps={profile.fps} />
          <FirstPersonController movement={movement} look={look} resetVersion={resetVersion} />
          <Suspense fallback={null}>
            <PlaygroundWorld
              members={members}
              economical={profile.economical}
              reducedMotion={reducedMotion}
            />
          </Suspense>
        </Canvas>
      </div>

      <header className="waiting-playground-toolbar">
        <div>
          <p className="eyebrow">ゲーム開始まで自由に散策</p>
          <h1 id="waiting-playground-title">3D待機室</h1>
        </div>
        <div className="waiting-playground-actions">
          <button
            type="button"
            onClick={() => setResetVersion((version) => version + 1)}
            aria-label="開始位置に戻る"
          >
            位置を戻す
          </button>
          <button type="button" className="waiting-playground-close" onClick={close}>
            待機画面へ戻る
          </button>
        </div>
      </header>

      <div className="waiting-playground-guide" aria-live="polite">
        {mobile ? (
          <p>左のパッドで移動 · それ以外の画面をドラッグして視点変更</p>
        ) : pointerLocked ? (
          <p>WASDで移動 · マウスで視点変更 · Escでカーソルを戻す</p>
        ) : (
          <p>画面をクリックしてFPS操作 · WASDで移動 · Escでカーソルを戻す</p>
        )}
      </div>

      <div className="waiting-playground-roster" aria-label="待機室にいるメンバー">
        {members.map((member) => (
          <span key={member.id}>
            {member.name}
            {member.cpu ? " · CPU" : member.spectator ? " · 観戦" : ""}
          </span>
        ))}
      </div>
      <MobileMovementPad movement={movement} />
    </section>
  );
}

export default WaitingPlayground;
