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
import { MathUtils, type Group } from "three";
import { Avatar3D } from "../avatar-3d/Avatar3D";
import { useUiStore } from "../app/store";
import { FirstPersonTouchControls } from "../components/FirstPersonTouchControls";
import { useFirstPersonTouchDevice } from "../components/useFirstPersonTouchDevice";
import type { WaitingPoseCue } from "../network/peerCues";
import {
  FREE_ROAM_GROUND_Y,
  separateFreeRoamAvatars,
  stepFreeRoamVertical,
} from "../game-3d/spectatorControls";
import {
  applyPlaygroundLook,
  containPlaygroundPosition,
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
const emptyWaitingPoses: ReadonlyMap<string, WaitingPoseCue> = new Map();

export type WaitingPlaygroundPose = Pick<WaitingPoseCue, "x" | "y" | "z" | "yaw" | "moving">;

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
  jumpVersion,
  selfId,
  remotePoses,
  onPoseChange,
}: {
  movement: MutableRefObject<PlaygroundMovement>;
  look: MutableRefObject<PlaygroundLook>;
  resetVersion: number;
  jumpVersion: number;
  selfId: string;
  remotePoses: ReadonlyMap<string, WaitingPoseCue>;
  onPoseChange: (pose: WaitingPlaygroundPose, inPlayground: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const keyboard = useRef(new Set<string>());
  const position = useRef({ x: 0, z: 8.4 });
  const height = useRef(FREE_ROAM_GROUND_Y);
  const verticalVelocity = useRef(0);
  const jumpRequested = useRef(false);
  const handledJumpVersion = useRef(jumpVersion);
  const lastPose = useRef<WaitingPlaygroundPose | undefined>(undefined);
  const lastPoseSentAt = useRef(Number.NEGATIVE_INFINITY);
  const onPoseChangeRef = useRef(onPoseChange);
  onPoseChangeRef.current = onPoseChange;
  useEffect(() => {
    position.current = { x: 0, z: 8.4 };
    height.current = FREE_ROAM_GROUND_Y;
    verticalVelocity.current = 0;
    look.current = { yaw: 0, pitch: -0.04 };
    camera.position.set(0, CAMERA_HEIGHT + FREE_ROAM_GROUND_Y, 8.4);
    camera.rotation.set(-0.04, 0, 0, "YXZ");
  }, [camera, look, resetVersion]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space"].includes(event.code)
      ) {
        keyboard.current.add(event.code);
        event.preventDefault();
        if (event.code === "Space" && !event.repeat) jumpRequested.current = true;
      }
    };
    const up = (event: KeyboardEvent) => keyboard.current.delete(event.code);
    const clear = () => {
      keyboard.current.clear();
      jumpRequested.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  useEffect(
    () => () => {
      const pose = lastPose.current;
      if (pose) onPoseChangeRef.current({ ...pose, moving: false }, false);
    },
    [],
  );
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
    const nextPosition = stepPlaygroundPosition(
      position.current,
      look.current,
      { forward, right },
      Math.min(delta, 0.05) * (sprinting ? 7.4 : 4.8),
    );
    separateFreeRoamAvatars(nextPosition, remotePoses, selfId);
    position.current = containPlaygroundPosition(nextPosition);
    const touchJumpStarted = jumpVersion !== handledJumpVersion.current;
    handledJumpVersion.current = jumpVersion;
    const vertical = stepFreeRoamVertical(
      height.current,
      verticalVelocity.current,
      Math.min(delta, 0.05),
      jumpRequested.current || touchJumpStarted,
    );
    jumpRequested.current = false;
    height.current = vertical.height;
    verticalVelocity.current = vertical.velocity;
    camera.position.set(position.current.x, CAMERA_HEIGHT + height.current, position.current.z);
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, "YXZ");
    canvas.dataset.waitingPlaygroundPose = [
      position.current.x,
      CAMERA_HEIGHT + height.current,
      position.current.z,
      look.current.yaw,
      look.current.pitch,
    ]
      .map((value) => value.toFixed(3))
      .join(",");
    const moving =
      Math.abs(forward) > 0.01 ||
      Math.abs(right) > 0.01 ||
      Math.abs(verticalVelocity.current) > 0.05;
    const pose: WaitingPlaygroundPose = {
      x: position.current.x,
      y: height.current,
      z: position.current.z,
      yaw: look.current.yaw,
      moving,
    };
    const previous = lastPose.current;
    const changed =
      !previous ||
      Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z) > 0.025 ||
      Math.abs(Math.atan2(Math.sin(pose.yaw - previous.yaw), Math.cos(pose.yaw - previous.yaw))) >
        0.02 ||
      pose.moving !== previous.moving;
    const now = performance.now();
    if (now - lastPoseSentAt.current >= (changed || moving ? 50 : 750)) {
      lastPose.current = pose;
      lastPoseSentAt.current = now;
      onPoseChangeRef.current(pose, true);
    }
  });
  return null;
}

function MemberAvatar({
  member,
  index,
  total,
  economical,
  reducedMotion,
  pose,
}: {
  member: WaitingPlaygroundMember;
  index: number;
  total: number;
  economical: boolean;
  reducedMotion: boolean;
  pose?: WaitingPoseCue | undefined;
}) {
  // Offset the ring by half a slot so nobody blocks the first-person spawn corridor.
  const angle = ((index + 0.5) / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  const radius = total <= 3 ? 4.6 : 5.8;
  const staticX = Math.cos(angle) * radius;
  const staticZ = Math.sin(angle) * radius;
  const staticYaw = -angle - Math.PI / 2;
  const avatarGroup = useRef<Group>(null);
  const initialPosition = useRef<[number, number, number]>([staticX, 0.18, staticZ]);
  const initialRotation = useRef<[number, number, number]>([0, staticYaw, 0]);
  useFrame((_, delta) => {
    const group = avatarGroup.current;
    if (!group) return;
    const factor = 1 - Math.exp(-Math.min(delta, 0.05) * 14);
    group.position.x = MathUtils.lerp(group.position.x, pose?.x ?? staticX, factor);
    group.position.y = MathUtils.lerp(group.position.y, pose?.y ?? 0.18, factor);
    group.position.z = MathUtils.lerp(group.position.z, pose?.z ?? staticZ, factor);
    const targetYaw = pose?.yaw ?? staticYaw;
    const yawDelta = Math.atan2(
      Math.sin(targetYaw - group.rotation.y),
      Math.cos(targetYaw - group.rotation.y),
    );
    group.rotation.y += yawDelta * factor;
  });
  return (
    <group ref={avatarGroup} position={initialPosition.current} rotation={initialRotation.current}>
      {!pose && (
        <mesh position={[0, -0.11, 0]} receiveShadow>
          <cylinderGeometry args={[0.78, 0.9, 0.2, economical ? 16 : 28]} />
          <meshStandardMaterial color={member.spectator ? "#37658a" : "#79582b"} roughness={0.74} />
        </mesh>
      )}
      <group scale={0.72}>
        <Avatar3D
          profile={member.avatar}
          lowPower={economical}
          active={!reducedMotion && (pose?.moving ?? !economical)}
        />
      </group>
      <Html center position={[0, 2.65, 0]} distanceFactor={8} className="waiting-member-label">
        <span
          data-waiting-member-id={member.id}
          data-waiting-member-pose={
            pose
              ? [pose.x, pose.y, pose.z, pose.yaw].map((value) => value.toFixed(3)).join(",")
              : "stationary"
          }
        >
          {member.name}
        </span>
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
  selfId,
  remotePoses,
}: {
  members: WaitingPlaygroundMember[];
  economical: boolean;
  reducedMotion: boolean;
  selfId: string;
  remotePoses: ReadonlyMap<string, WaitingPoseCue>;
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
      {members.map((member, index) =>
        member.id === selfId ? null : (
          <MemberAvatar
            key={member.id}
            member={member}
            index={index}
            total={members.length}
            economical={economical}
            reducedMotion={reducedMotion}
            pose={remotePoses.get(member.id)}
          />
        ),
      )}
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

export function WaitingPlayground({
  members,
  selfId,
  remotePoses = emptyWaitingPoses,
  onPoseChange = () => undefined,
  onClose,
}: {
  members: WaitingPlaygroundMember[];
  selfId: string;
  remotePoses?: ReadonlyMap<string, WaitingPoseCue> | undefined;
  onPoseChange?: ((pose: WaitingPlaygroundPose, inPlayground: boolean) => void) | undefined;
  onClose: () => void;
}) {
  const lowPower = useUiStore((state) => state.lowPower);
  const reducedMotion = useUiStore((state) => state.reducedMotion);
  const forcedMobile = useUiStore((state) => state.mobileMode);
  const mobileViewport = useFirstPersonTouchDevice();
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
  const [jumpVersion, setJumpVersion] = useState(0);

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
            antialias: true,
            powerPreference: lowPower ? "low-power" : "high-performance",
          }}
        >
          <FramePump fps={profile.fps} />
          <FirstPersonController
            movement={movement}
            look={look}
            resetVersion={resetVersion}
            jumpVersion={jumpVersion}
            selfId={selfId}
            remotePoses={remotePoses}
            onPoseChange={onPoseChange}
          />
          <Suspense fallback={null}>
            <PlaygroundWorld
              members={members}
              economical={profile.economical}
              reducedMotion={reducedMotion}
              selfId={selfId}
              remotePoses={remotePoses}
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
          <p>左のパッドで移動 · 右のジャンプ · それ以外をドラッグして視点変更</p>
        ) : pointerLocked ? (
          <p>WASDで移動 · Spaceでジャンプ · マウスで視点変更 · Escでカーソルを戻す</p>
        ) : (
          <p>画面をクリックしてFPS操作 · WASD／Spaceで移動・ジャンプ</p>
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
      {mobile && (
        <FirstPersonTouchControls
          label="3D待機室の移動操作"
          onMove={(nextMovement) => {
            movement.current = nextMovement;
          }}
          onJump={() => setJumpVersion((version) => version + 1)}
        />
      )}
    </section>
  );
}

export default WaitingPlayground;
