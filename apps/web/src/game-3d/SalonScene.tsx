import { Billboard, ContactShadows, Environment } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  BackSide,
  MathUtils,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from "three";
import type { CardView, PlayerView, RoomView } from "../app/model";
import { useVisualViewport } from "../app/visualViewport";
import { Avatar3D } from "../avatar-3d/Avatar3D";
import { Card3D } from "./Card3D";
import { CardMotionLayer } from "./CardMotionLayer";
import type { CardMotionEvent } from "./cardMotion";
import { StealVisualLayer } from "./StealVisualLayer";
import type { StealVisualState } from "../screens/StealSequence";

export interface TableEffectInteraction {
  kind: "steal" | "give" | "discard" | "collect";
  selectedIds: ReadonlySet<string>;
  selectableIds: ReadonlySet<string>;
  targetPlayerIds: ReadonlySet<string>;
  pendingGiveCardId?: string | undefined;
  giveTargets: Readonly<Record<string, string>>;
  giveCards: readonly CardView[];
}

export function playersAtTable(players: readonly PlayerView[]): PlayerView[] {
  return players.filter((player) => player.present !== false);
}

function FrameScheduler({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const timer = window.setInterval(invalidate, Math.round(1000 / fps));
    return () => window.clearInterval(timer);
  }, [fps, invalidate]);
  return null;
}

function CameraRig({
  spectator,
  mobile,
  reducedMotion,
  focusIndex,
  playerCount,
  keyboardOpen,
  effectPerspective,
  effectOverview,
  actorIndex,
}: {
  spectator: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  focusIndex: number;
  playerCount: number;
  keyboardOpen: boolean;
  effectPerspective?: StealVisualState["perspective"] | undefined;
  effectOverview?: boolean | undefined;
  actorIndex: number;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const target = useMemo(() => {
    const crowdedMobileSpectator = mobile && spectator && playerCount >= 6;
    const radius = mobile
      ? spectator
        ? keyboardOpen
          ? crowdedMobileSpectator
            ? 15.8
            : 13.2
          : crowdedMobileSpectator
            ? 14.5
            : 11.9
        : keyboardOpen
          ? 11.4
          : 9.7
      : 10.8;
    const targetAngle = (focusIndex / Math.max(1, playerCount)) * Math.PI * 2 + Math.PI / 2;
    const actorAngle = (actorIndex / Math.max(1, playerCount)) * Math.PI * 2 + Math.PI / 2;
    if (mobile && effectOverview) {
      return {
        y: 10.6,
        x: 0,
        z: 14.4,
        lookX: 0,
        lookY: 0.65,
        lookZ: -0.25,
      };
    }
    if (effectPerspective === "actor") {
      return {
        y: mobile ? 3.35 : 3.05,
        x: Math.cos(targetAngle) * 2.15,
        z: Math.sin(targetAngle) * 2.15,
        lookX: Math.cos(targetAngle) * 5.15,
        lookY: 0.9,
        lookZ: Math.sin(targetAngle) * 5.15,
      };
    }
    if (effectPerspective === "victim") {
      return {
        y: mobile ? 7.3 : 6.4,
        x: 0,
        z: radius,
        lookX: Math.cos(actorAngle) * 5.1,
        lookY: 1.1,
        lookZ: Math.sin(actorAngle) * 5.1,
      };
    }
    const angle = spectator && playerCount > 0 ? targetAngle : Math.PI / 2;
    return {
      y: mobile
        ? spectator
          ? keyboardOpen
            ? crowdedMobileSpectator
              ? 10
              : 9.4
            : crowdedMobileSpectator
              ? 9.3
              : 8.65
          : keyboardOpen
            ? 8.1
            : 7.3
        : 6.4,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      lookX: 0,
      lookY: 0.3,
      lookZ: 0,
    };
  }, [
    actorIndex,
    effectOverview,
    effectPerspective,
    focusIndex,
    keyboardOpen,
    mobile,
    playerCount,
    spectator,
  ]);
  useEffect(() => {
    camera.fov = mobile
      ? effectOverview
        ? 68
        : spectator
          ? keyboardOpen
            ? 72
            : 70
          : keyboardOpen
            ? 58
            : 51
      : 45;
    camera.updateProjectionMatrix();
  }, [camera, effectOverview, keyboardOpen, mobile, spectator]);
  useFrame((_, delta) => {
    const factor = reducedMotion || (mobile && effectOverview) ? 1 : 1 - Math.exp(-delta * 4.5);
    camera.position.y = MathUtils.lerp(camera.position.y, target.y, factor);
    camera.position.x = MathUtils.lerp(camera.position.x, target.x, factor);
    camera.position.z = MathUtils.lerp(camera.position.z, target.z, factor);
    camera.lookAt(target.lookX, target.lookY, target.lookZ);
  });
  return null;
}

type FreeRoamInput = { forward: number; strafe: number; turn: number; jump: number };

export function resetFreeRoamInput(input: FreeRoamInput): FreeRoamInput {
  return { ...input, forward: 0, strafe: 0, turn: 0, jump: 0 };
}

export function shouldIgnoreFreeRoamKeyboardTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.matches("input, textarea, select") || element?.isContentEditable);
}

export function isFreeRoamControlActivationKey(code: string): boolean {
  return code === "Enter" || code === "Space";
}

export function containFreeRoamCamera(target: { x: number; z: number }): void {
  // Keep the near plane just inside the solid side and rear walls. The front of
  // the salon is intentionally open, so positive Z does not need clamping.
  target.x = MathUtils.clamp(target.x, -6.62, 6.62);
  target.z = Math.max(target.z, -7.62);
}

function FreeRoamAvatar({
  mobileInput,
  playerCount,
  mobile,
  profile,
  lowPower,
  reducedMotion,
  onExit,
}: {
  mobileInput: FreeRoamInput;
  playerCount: number;
  mobile: boolean;
  profile: PlayerView["avatar"];
  lowPower: boolean;
  reducedMotion: boolean;
  onExit: () => void;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  // The north-west aisle stays clear for every supported 3–6 seat layout and keeps
  // the initial third-person camera inside the two solid side walls.
  const spawnAngle = (Math.PI * 2) / 3;
  const spawnRadius = 7.2;
  const spawnX = Math.cos(spawnAngle) * spawnRadius;
  const spawnZ = Math.sin(spawnAngle) * spawnRadius;
  const spawnYaw = Math.atan2(-spawnX, spawnZ);
  const avatar = useRef<Group>(null);
  const keys = useRef(new Set<string>());
  const yaw = useRef(spawnYaw);
  const pitch = useRef(0);
  const dragging = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const position = useRef(new Vector3(spawnX, 0.05, spawnZ));
  const desiredCamera = useRef(new Vector3());
  const verticalVelocity = useRef(0);
  const jumpRequested = useRef(false);
  const handledMobileJump = useRef(mobileInput.jump);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const initialBehind = mobile ? 5.9 : 5.25;
    const initialShoulder = mobile ? 1.25 : 1.1;
    camera.position.set(
      spawnX - Math.sin(spawnYaw) * initialBehind + Math.cos(spawnYaw) * initialShoulder,
      mobile ? 3.4 : 3.2,
      spawnZ + Math.cos(spawnYaw) * initialBehind + Math.sin(spawnYaw) * initialShoulder,
    );
    camera.fov = mobile ? 61 : 56;
    camera.updateProjectionMatrix();
    const down = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        keys.current.clear();
        exitRef.current();
        return;
      }
      if (shouldIgnoreFreeRoamKeyboardTarget(event.target)) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) jumpRequested.current = true;
      }
      keys.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const canvas = gl.domElement;
    const previousTabIndex = canvas.tabIndex;
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
    const pointerDown = (event: PointerEvent) => {
      if (dragging.current !== null) return;
      dragging.current = event.pointerId;
      pointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (dragging.current !== event.pointerId) return;
      yaw.current -= (event.clientX - pointer.current.x) * 0.004;
      pitch.current = MathUtils.clamp(
        pitch.current - (event.clientY - pointer.current.y) * 0.003,
        -0.62,
        0.52,
      );
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      if (dragging.current !== event.pointerId) return;
      dragging.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const resetInput = () => {
      keys.current.clear();
      jumpRequested.current = false;
      const pointerId = dragging.current;
      dragging.current = null;
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    };
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") resetInput();
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", resetInput);
    document.addEventListener("visibilitychange", visibilityChange);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", resetInput);
      document.removeEventListener("visibilitychange", visibilityChange);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeAttribute("data-free-roam-pose");
      canvas.tabIndex = previousTabIndex;
      canvas.blur();
      resetInput();
    };
  }, [camera, gl, mobile, spawnX, spawnYaw, spawnZ]);

  useFrame((_, delta) => {
    // Keep traversal tied to elapsed time even when a busy mobile GPU misses frames.
    // Jump integration stays tightly capped so a resumed tab cannot tunnel through the floor.
    const movementDelta = Math.min(delta, 0.2);
    const physicsDelta = Math.min(delta, 0.05);
    const forward =
      (keys.current.has("KeyW") || keys.current.has("ArrowUp") ? 1 : 0) -
      (keys.current.has("KeyS") || keys.current.has("ArrowDown") ? 1 : 0) +
      mobileInput.forward;
    const strafe =
      (keys.current.has("KeyD") || keys.current.has("ArrowRight") ? 1 : 0) -
      (keys.current.has("KeyA") || keys.current.has("ArrowLeft") ? 1 : 0) +
      mobileInput.strafe;
    yaw.current += mobileInput.turn * movementDelta * 1.65;
    const speed = (keys.current.has("ShiftLeft") ? 5.2 : 3.6) * movementDelta;
    let nextX =
      position.current.x +
      (Math.sin(yaw.current) * forward + Math.cos(yaw.current) * strafe) * speed;
    let nextZ =
      position.current.z +
      (-Math.cos(yaw.current) * forward + Math.sin(yaw.current) * strafe) * speed;
    const xLimit = 6.55;
    const zMinimum = -7.35;
    const zMaximum = mobile ? 9.5 : 8.6;
    nextX = MathUtils.clamp(nextX, -xLimit, xLimit);
    nextZ = MathUtils.clamp(nextZ, zMinimum, zMaximum);
    const radius = Math.hypot(nextX, nextZ);
    if (radius < 5.28) {
      const angle = radius > 0.01 ? Math.atan2(nextZ, nextX) : Math.PI / 2;
      nextX = Math.cos(angle) * 5.28;
      nextZ = Math.sin(angle) * 5.28;
    }
    for (let index = 0; index < playerCount; index += 1) {
      const angle = (index / playerCount) * Math.PI * 2 + Math.PI / 2;
      const seatX = Math.cos(angle) * 5.45;
      const seatZ = Math.sin(angle) * 5.45;
      const dx = nextX - seatX;
      const dz = nextZ - seatZ;
      const distance = Math.hypot(dx, dz);
      const clearance = 1.62;
      if (distance >= clearance) continue;
      const pushAngle = distance > 0.01 ? Math.atan2(dz, dx) : angle;
      const candidates = [pushAngle, angle + Math.PI / 2, angle - Math.PI / 2]
        .map((candidateAngle) => ({
          x: seatX + Math.cos(candidateAngle) * clearance,
          z: seatZ + Math.sin(candidateAngle) * clearance,
        }))
        .filter(
          (candidate) =>
            Math.abs(candidate.x) <= xLimit &&
            candidate.z >= zMinimum &&
            candidate.z <= zMaximum &&
            Math.hypot(candidate.x, candidate.z) >= 5.28,
        )
        .sort(
          (left, right) =>
            Math.hypot(left.x - nextX, left.z - nextZ) -
            Math.hypot(right.x - nextX, right.z - nextZ),
        );
      const resolved = candidates[0];
      if (resolved) {
        nextX = resolved.x;
        nextZ = resolved.z;
      }
    }
    const mobileJumpStarted = mobileInput.jump !== handledMobileJump.current;
    handledMobileJump.current = mobileInput.jump;
    if ((jumpRequested.current || mobileJumpStarted) && position.current.y <= 0.051) {
      verticalVelocity.current = 5.2;
    }
    jumpRequested.current = false;
    verticalVelocity.current -= 12.8 * physicsDelta;
    const nextY = Math.max(0.05, position.current.y + verticalVelocity.current * physicsDelta);
    if (nextY <= 0.05) verticalVelocity.current = 0;
    position.current.set(nextX, nextY, nextZ);
    if (avatar.current) {
      avatar.current.position.copy(position.current);
      avatar.current.rotation.y = yaw.current + Math.PI;
    }
    gl.domElement.dataset.freeRoamPose = [nextX, nextY, nextZ, yaw.current, pitch.current]
      .map((value) => value.toFixed(3))
      .join(",");
    const behind = mobile ? 5.9 : 5.25;
    const shoulder = mobile ? 1.25 : 1.1;
    desiredCamera.current.set(
      nextX - Math.sin(yaw.current) * behind + Math.cos(yaw.current) * shoulder,
      nextY + (mobile ? 3.35 : 3.15),
      nextZ + Math.cos(yaw.current) * behind + Math.sin(yaw.current) * shoulder,
    );
    containFreeRoamCamera(desiredCamera.current);
    camera.position.lerp(
      desiredCamera.current,
      reducedMotion ? 1 : 1 - Math.exp(-physicsDelta * 8),
    );
    const lookAhead = 5.2;
    camera.lookAt(
      nextX + Math.sin(yaw.current) * lookAhead,
      nextY + 1.45 + Math.sin(pitch.current) * lookAhead,
      nextZ - Math.cos(yaw.current) * lookAhead,
    );
  });
  return (
    <group ref={avatar} position={position.current.toArray()}>
      <Avatar3D profile={profile} lowPower={lowPower} active />
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.66, 0.78, 32]} />
        <meshBasicMaterial color="#f4d47f" transparent opacity={0.68} />
      </mesh>
    </group>
  );
}

function CircularTable() {
  return (
    <group scale={1}>
      <mesh position={[0, -0.36, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[4.85, 4.85, 0.58, 96]} />
        <meshStandardMaterial color="#48291c" roughness={0.46} />
      </mesh>
      <mesh position={[0, -0.035, 0]} receiveShadow>
        <cylinderGeometry args={[4.62, 4.62, 0.12, 96]} />
        <meshStandardMaterial color="#123f32" roughness={0.92} />
      </mesh>
      <mesh position={[2.9, 0.08, -1.45]} receiveShadow>
        <boxGeometry args={[1.65, 0.09, 2.18]} />
        <meshStandardMaterial color="#182c27" roughness={0.76} metalness={0.08} />
      </mesh>
      <mesh position={[0, -1.7, 0]}>
        <cylinderGeometry args={[1.4, 1.9, 2.6, 48]} />
        <meshStandardMaterial color="#281710" roughness={0.5} />
      </mesh>
    </group>
  );
}

function SalonRoom({ lowPower }: { lowPower: boolean }) {
  return (
    <>
      <mesh position={[0, -2.25, 0]} receiveShadow>
        <cylinderGeometry args={[15, 15, 0.15, 64]} />
        <meshStandardMaterial color="#090c0c" roughness={0.88} />
      </mesh>
      <mesh position={[0, 4, -8]}>
        <boxGeometry args={[22, 10, 0.3]} />
        <meshStandardMaterial color="#101918" roughness={0.85} />
      </mesh>
      <mesh position={[-7, 4, 0]}>
        <boxGeometry args={[0.3, 10, 18]} />
        <meshStandardMaterial color="#171311" roughness={0.75} />
      </mesh>
      <mesh position={[7, 4, 0]}>
        <boxGeometry args={[0.3, 10, 18]} />
        <meshStandardMaterial color="#171311" roughness={0.75} />
      </mesh>
      {!lowPower && (
        <>
          <pointLight
            position={[-3.5, 5, 1]}
            intensity={18}
            distance={12}
            color="#ffcf89"
            castShadow
          />
          <pointLight
            position={[3.5, 5, 1]}
            intensity={18}
            distance={12}
            color="#ffcf89"
            castShadow
          />
        </>
      )}
    </>
  );
}

function seats(
  players: PlayerView[],
  viewerId: string | undefined,
  currentPlayerId?: string,
  lowPower = false,
  mobile = false,
  e2eProjectionProbe = false,
  movingToSeats = new Map<string, ReadonlySet<string>>(),
  hiddenCardPlayerId?: string,
  hideViewerAvatar = true,
  effectInteraction?: TableEffectInteraction,
  onEffectCardSelect: (card: CardView, ownerId: string) => void = () => undefined,
  onEffectPlayerSelect: (playerId: string) => void = () => undefined,
) {
  const stealLayout = stealCardInteractionLayout(mobile);
  return players.map((player, index) => {
    const angle = (index / players.length) * Math.PI * 2 + Math.PI / 2;
    const radius = 5.45;
    const giveTarget =
      effectInteraction?.kind === "give" &&
      ((Boolean(effectInteraction.pendingGiveCardId) &&
        effectInteraction.targetPlayerIds.has(player.id)) ||
        Object.values(effectInteraction.giveTargets).includes(player.id));
    const assignedGiveCards =
      effectInteraction?.kind === "give"
        ? effectInteraction.giveCards.filter(
            (card) => effectInteraction.giveTargets[card.id] === player.id,
          )
        : [];
    return (
      <group
        key={player.id}
        position={[Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius]}
        rotation={[0, -angle - Math.PI / 2, 0]}
        onPointerDown={(event) => {
          if (
            effectInteraction?.kind === "give" &&
            effectInteraction.pendingGiveCardId &&
            effectInteraction.targetPlayerIds.has(player.id)
          ) {
            event.stopPropagation();
            onEffectPlayerSelect(player.id);
          }
        }}
      >
        {(!hideViewerAvatar || player.id !== viewerId) && (
          <Avatar3D
            profile={player.avatar}
            active={player.id === currentPlayerId || giveTarget}
            lowPower={lowPower}
          />
        )}
        {player.id !== viewerId && player.id !== hiddenCardPlayerId && (
          <Billboard position={[0, 1.14, 1.35]} follow lockX={false} lockY={false} lockZ={false}>
            {(player.cards ?? []).map((card, cardIndex) => {
              const centered = cardIndex - ((player.cards?.length ?? 1) - 1) / 2;
              const stealHitArea = stealCardHitArea(cardIndex, player.cards?.length ?? 0, mobile);
              const spacing = Math.min(
                mobile ? 0.19 : 0.24,
                (mobile ? 2.55 : 3.2) / Math.max(player.cards?.length ?? 1, 1),
              );
              return (
                <Card3D
                  key={card.id}
                  card={card}
                  selected={Boolean(effectInteraction?.selectedIds.has(card.id))}
                  dimmed={
                    effectInteraction?.kind === "steal" &&
                    !effectInteraction.selectableIds.has(card.id)
                  }
                  hidden={movingToSeats.get(player.id)?.has(card.id) ?? false}
                  {...(effectInteraction?.kind === "steal" &&
                  effectInteraction.selectableIds.has(card.id)
                    ? {
                        onSelect: () => onEffectCardSelect(card, player.id),
                        hitAreaWidth: stealHitArea.width,
                        hitAreaOffsetX: stealHitArea.offsetX,
                        ...(e2eProjectionProbe
                          ? { e2eProjectionAttribute: "data-effect-steal-card" }
                          : {}),
                      }
                    : {})}
                  position={[
                    centered *
                      (effectInteraction?.kind === "steal" ? stealLayout.spacing : spacing),
                    Math.abs(centered) * 0.008,
                    cardIndex * 0.012,
                  ]}
                  rotation={[0, 0, -centered * 0.035]}
                  scale={
                    effectInteraction?.kind === "steal" ? stealLayout.scale : mobile ? 0.32 : 0.36
                  }
                  selectedLift={0.42}
                  selectedDepth={-0.3}
                />
              );
            })}
          </Billboard>
        )}
        {assignedGiveCards.length > 0 && (
          <Billboard position={[0, 2.65, 0.42]} follow lockX={false} lockY={false} lockZ={false}>
            {assignedGiveCards.map((card, cardIndex) => {
              const centered = cardIndex - (assignedGiveCards.length - 1) / 2;
              return (
                <group
                  key={`give-preview-${card.id}`}
                  position={[centered * 0.62, Math.abs(centered) * 0.025, cardIndex * 0.02]}
                >
                  <mesh position={[0, 0, -0.045]}>
                    <planeGeometry args={[0.74, 1.02]} />
                    <meshBasicMaterial
                      color="#f4d47f"
                      transparent
                      opacity={0.34}
                      depthWrite={false}
                    />
                  </mesh>
                  <Card3D
                    card={card}
                    selected
                    rotation={[0, 0, -centered * 0.07]}
                    scale={0.48}
                    selectedLift={0}
                  />
                </group>
              );
            })}
          </Billboard>
        )}
      </group>
    );
  });
}

function handCards(
  cards: CardView[],
  selectedIds: string[],
  playableIds: ReadonlySet<string> | undefined,
  toggle: (card: CardView) => void,
  mobile: boolean,
  movingToHand: ReadonlySet<string>,
  effectInteraction?: TableEffectInteraction,
  onGiveCardDrop: (card: CardView, playerId: string) => void = () => undefined,
  players: PlayerView[] = [],
) {
  const layout = handCardInteractionLayout(cards.length, mobile);
  return cards.map((card, index) => {
    const centered = index - (cards.length - 1) / 2;
    const hitArea = handCardHitArea(index, cards.length, mobile);
    return (
      <Card3D
        key={card.id}
        card={card}
        selected={selectedIds.includes(card.id)}
        dimmed={Boolean(playableIds && !playableIds.has(card.id))}
        hidden={
          movingToHand.has(card.id) ||
          (effectInteraction?.kind === "give" && Boolean(effectInteraction.giveTargets[card.id]))
        }
        {...(effectInteraction?.kind === "give" && effectInteraction.selectableIds.has(card.id)
          ? {
              onDragStart: () => {
                if (!effectInteraction.selectedIds.has(card.id)) toggle(card);
              },
              onDragEnd: (point: [number, number, number]) => {
                const target = nearestGiveTarget(players, effectInteraction.targetPlayerIds, point);
                if (target) onGiveCardDrop(card, target);
              },
            }
          : { onSelect: () => toggle(card) })}
        position={[
          centered * layout.spacing,
          1.05 - Math.abs(centered) * 0.015,
          4.08 + index * 0.035,
        ]}
        rotation={[-0.42, 0, -centered * 0.035]}
        scale={layout.scale}
        hitAreaWidth={hitArea.width}
        hitAreaOffsetX={hitArea.offsetX}
        renderOrder={100 + index}
        selectedLift={mobile ? 1.22 : 1.55}
        selectedDepth={mobile ? -0.64 : -0.84}
        dragPlaneY={1.32}
      />
    );
  });
}

export function nearestGiveTarget(
  players: PlayerView[],
  eligiblePlayerIds: ReadonlySet<string>,
  point: readonly [number, number, number],
  threshold = 2.25,
): string | undefined {
  let nearest: { id: string; distance: number } | undefined;
  for (const [index, player] of players.entries()) {
    if (!eligiblePlayerIds.has(player.id)) continue;
    const angle = (index / Math.max(1, players.length)) * Math.PI * 2 + Math.PI / 2;
    const distance = Math.hypot(
      point[0] - Math.cos(angle) * 5.45,
      point[2] - Math.sin(angle) * 5.45,
    );
    if (!nearest || distance < nearest.distance) nearest = { id: player.id, distance };
  }
  return nearest && nearest.distance <= threshold ? nearest.id : undefined;
}

export function stealCardInteractionLayout(mobile: boolean): {
  spacing: number;
  scale: number;
  hitAreaWidth: number;
} {
  const spacing = mobile ? 0.27 : 0.31;
  const scale = mobile ? 0.4 : 0.44;
  return { spacing, scale, hitAreaWidth: nonOverlappingHitAreaWidth(spacing, scale) };
}

export function handCardInteractionLayout(
  cardCount: number,
  mobile: boolean,
): { spacing: number; scale: number; hitAreaWidth: number } {
  const scale = mobile ? 0.78 : 0.92;
  const spacing = Math.min(mobile ? 0.44 : 0.62, (mobile ? 6.8 : 8.8) / Math.max(cardCount, 1));
  return { spacing, scale, hitAreaWidth: nonOverlappingHitAreaWidth(spacing, scale) };
}

export function handCardHitArea(
  cardIndex: number,
  cardCount: number,
  mobile: boolean,
): { width: number; offsetX: number } {
  const layout = handCardInteractionLayout(cardCount, mobile);
  return horizontalCardHitArea(cardIndex, cardCount, layout.scale, layout.hitAreaWidth);
}

export function stealCardHitArea(
  cardIndex: number,
  cardCount: number,
  mobile: boolean,
): { width: number; offsetX: number } {
  const layout = stealCardInteractionLayout(mobile);
  return horizontalCardHitArea(cardIndex, cardCount, layout.scale, layout.hitAreaWidth);
}

function horizontalCardHitArea(
  cardIndex: number,
  cardCount: number,
  scale: number,
  centerHitWidth: number,
): { width: number; offsetX: number } {
  if (cardCount <= 1) return { width: 1.22, offsetX: 0 };
  const centerHitWorld = centerHitWidth * scale;
  const cardWorld = 1.22 * scale;
  const outerWingWorld = Math.max(0, (cardWorld - centerHitWorld) / 2);
  if (cardIndex !== 0 && cardIndex !== cardCount - 1) {
    return { width: centerHitWidth, offsetX: 0 };
  }
  return {
    width: (centerHitWorld + outerWingWorld) / scale,
    offsetX: ((cardIndex === 0 ? -1 : 1) * outerWingWorld) / (2 * scale),
  };
}

function nonOverlappingHitAreaWidth(spacing: number, scale: number): number {
  return (spacing * 0.92) / scale;
}

function fieldCards(plays: CardView[][], movingToField: ReadonlySet<string>) {
  return plays.flatMap((play, playIndex) => {
    const stackX = ((playIndex % 3) - 1) * 0.1;
    const stackZ = ((playIndex % 4) - 1.5) * 0.065;
    const stackRotation = ((playIndex % 5) - 2) * 0.025;
    return play.map((card, cardIndex) => {
      const centered = cardIndex - (play.length - 1) / 2;
      return (
        <Card3D
          key={card.id}
          card={card}
          hidden={movingToField.has(card.id)}
          position={[
            stackX + centered * 0.43,
            0.16 + playIndex * 0.018 + cardIndex * 0.002,
            stackZ + Math.abs(centered) * 0.018,
          ]}
          rotation={[-Math.PI / 2, 0, stackRotation + centered * 0.018]}
          scale={0.72}
          renderOrder={playIndex * 10 + cardIndex}
        />
      );
    });
  });
}

function discardStack(
  cards: CardView[],
  movingToDiscard: ReadonlySet<string>,
  effectInteraction?: TableEffectInteraction,
  onEffectCardSelect: (card: CardView) => void = () => undefined,
  mobile = false,
) {
  const collecting = effectInteraction?.kind === "collect";
  const collectLayout = collectCardInteractionLayout(mobile);
  const visibleStack = collecting
    ? cards.filter((card) => !movingToDiscard.has(card.id))
    : cards.filter((card) => !movingToDiscard.has(card.id)).slice(-12);
  const columns = Math.min(mobile ? 7 : 14, Math.max(1, visibleStack.length));
  return visibleStack.map((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centeredColumn =
      column - (Math.min(columns, visibleStack.length - row * columns) - 1) / 2;
    return (
      <Card3D
        key={card.id}
        card={card}
        selected={Boolean(effectInteraction?.selectedIds.has(card.id))}
        dimmed={collecting && !effectInteraction.selectableIds.has(card.id)}
        {...(collecting && effectInteraction.selectableIds.has(card.id)
          ? {
              onSelect: () => onEffectCardSelect(card),
              hitAreaHeight: collectLayout.hitAreaHeight,
            }
          : {})}
        position={
          collecting
            ? [
                centeredColumn * (mobile ? 0.46 : 0.48),
                (mobile ? 0.72 : 0.88) + row * collectLayout.rowSpacing,
                1.48 - row * (mobile ? 0.035 : 0.06),
              ]
            : [2.9, 0.15 + index * 0.012, -1.45]
        }
        rotation={
          collecting ? [0, 0, centeredColumn * 0.012] : [-Math.PI / 2, 0, ((index % 5) - 2) * 0.018]
        }
        scale={collecting ? collectLayout.scale : 0.62}
        renderOrder={(collecting ? 700 : 500) + index}
        selectedLift={collecting ? 0.22 : 0.5}
        selectedDepth={collecting ? -0.24 : 0}
      />
    );
  });
}

export function collectCardInteractionLayout(mobile: boolean): {
  rowSpacing: number;
  scale: number;
  hitAreaHeight: number;
} {
  const rowSpacing = mobile ? 0.52 : 0.76;
  const scale = mobile ? 0.29 : 0.39;
  return { rowSpacing, scale, hitAreaHeight: 1.78 };
}

function EffectProjectionProbe({
  room,
  effectInteraction,
  mobile,
}: {
  room: RoomView;
  effectInteraction?: TableEffectInteraction | undefined;
  mobile: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const project = (point: Vector3): [number, number] => {
    point.project(camera);
    return [((point.x + 1) * size.width) / 2, ((1 - point.y) * size.height) / 2];
  };
  useFrame(() => {
    const canvas = gl.domElement;
    delete canvas.dataset.effectGiveDrag;
    delete canvas.dataset.effectCardPoints;
    if (effectInteraction?.kind === "give") {
      const cardIndex = room.hand.findIndex((card) => effectInteraction.selectableIds.has(card.id));
      const targetIndex = room.players.findIndex((player) =>
        effectInteraction.targetPlayerIds.has(player.id),
      );
      if (cardIndex >= 0 && targetIndex >= 0) {
        const centered = cardIndex - (room.hand.length - 1) / 2;
        const spacing = Math.min(
          mobile ? 0.44 : 0.62,
          (mobile ? 6.8 : 8.8) / Math.max(room.hand.length, 1),
        );
        const angle = (targetIndex / room.players.length) * Math.PI * 2 + Math.PI / 2;
        const start = project(
          new Vector3(
            centered * spacing,
            1.05 - Math.abs(centered) * 0.015,
            4.08 + cardIndex * 0.035,
          ),
        );
        const end = project(new Vector3(Math.cos(angle) * 5.45, 1.32, Math.sin(angle) * 5.45));
        canvas.dataset.effectGiveDrag = [...start, ...end]
          .map((value) => value.toFixed(2))
          .join(",");
      }
    }
    if (effectInteraction?.kind === "collect") {
      const cards = room.discard.filter((card) => effectInteraction.selectableIds.has(card.id));
      const columns = Math.min(mobile ? 7 : 14, Math.max(1, cards.length));
      const collectLayout = collectCardInteractionLayout(mobile);
      canvas.dataset.effectCardPoints = cards
        .map((_, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const centeredColumn = column - (Math.min(columns, cards.length - row * columns) - 1) / 2;
          return project(
            new Vector3(
              centeredColumn * (mobile ? 0.46 : 0.48),
              (mobile ? 0.72 : 0.88) + row * collectLayout.rowSpacing,
              1.48 - row * (mobile ? 0.035 : 0.06),
            ),
          ).join(":");
        })
        .join(";");
    }
  });
  useEffect(
    () => () => {
      delete gl.domElement.dataset.effectGiveDrag;
      delete gl.domElement.dataset.effectCardPoints;
    },
    [gl],
  );
  return null;
}

const DEAL_CARD: CardView = { id: "deal-card", visibility: "hidden", blind: false };
const DECK_POSITION = [-2.9, 0.18, -1.45] as const;

function TableDeck() {
  return (
    <group>
      {Array.from({ length: 5 }, (_, index) => (
        <Card3D
          key={`deck-${index}`}
          card={{ ...DEAL_CARD, id: `deck-${index}` }}
          position={[DECK_POSITION[0], DECK_POSITION[1] + index * 0.012, DECK_POSITION[2]]}
          rotation={[-Math.PI / 2, 0, index * 0.018]}
          scale={0.46}
          renderOrder={450 + index}
        />
      ))}
    </group>
  );
}

function AnimatedDealCard({
  sequence,
  seatIndex,
  playerCount,
  round,
}: {
  sequence: number;
  seatIndex: number;
  playerCount: number;
  round: number;
}) {
  const root = useRef<Group>(null);
  const startedAt = useRef<number | undefined>(undefined);
  useFrame(({ clock }) => {
    if (!root.current) return;
    startedAt.current ??= clock.elapsedTime;
    const elapsed = clock.elapsedTime - startedAt.current - sequence * 0.045;
    const progress = MathUtils.clamp(elapsed / 0.54, 0, 1);
    root.current.visible = elapsed >= 0;
    const eased = progress * progress * (3 - 2 * progress);
    const angle = (seatIndex / playerCount) * Math.PI * 2 + Math.PI / 2;
    const tangentX = -Math.sin(angle) * (round - 1.5) * 0.13;
    const tangentZ = Math.cos(angle) * (round - 1.5) * 0.13;
    const targetX = Math.cos(angle) * 4.05 + tangentX;
    const targetZ = Math.sin(angle) * 4.05 + tangentZ;
    root.current.position.set(
      MathUtils.lerp(DECK_POSITION[0], targetX, eased),
      0.24 + Math.sin(progress * Math.PI) * 2.15 + round * 0.008,
      MathUtils.lerp(DECK_POSITION[2], targetZ, eased),
    );
    root.current.rotation.y = MathUtils.lerp(sequence * 0.08, -angle + Math.PI / 2, eased);
    root.current.rotation.z = Math.sin(progress * Math.PI) * 0.16;
  });
  return (
    <group ref={root} visible={false}>
      <Card3D card={{ ...DEAL_CARD, id: `deal-${sequence}` }} scale={0.42} />
    </group>
  );
}

function DealingSequence({ playerCount }: { playerCount: number }) {
  const cards = useMemo(
    () =>
      Array.from({ length: playerCount * 4 }, (_, sequence) => ({
        sequence,
        seatIndex: sequence - Math.floor(sequence / playerCount) * playerCount,
        round: Math.floor(sequence / playerCount),
      })),
    [playerCount],
  );
  if (!playerCount) return null;
  return (
    <group>
      {cards.map((card) => (
        <AnimatedDealCard key={card.sequence} {...card} playerCount={playerCount} />
      ))}
    </group>
  );
}

export function SalonScene({
  room,
  previewAvatar,
  selectedIds = [],
  playableIds,
  onToggleCard = () => undefined,
  lowPower,
  reducedMotion,
  dealing = false,
  cardMotions = [],
  onCardMotionDone = () => undefined,
  stealVisual,
  effectInteraction,
  onEffectCardSelect = () => undefined,
  onEffectPlayerSelect = () => undefined,
  onGiveCardDrop = () => undefined,
  spectatorMode = "follow",
  freeRoamAvatar,
  onExitFreeRoam = () => undefined,
}: {
  room?: RoomView;
  previewAvatar?: PlayerView["avatar"];
  selectedIds?: string[];
  playableIds?: ReadonlySet<string> | undefined;
  onToggleCard?: ((card: CardView) => void) | undefined;
  lowPower: boolean;
  reducedMotion: boolean;
  dealing?: boolean;
  cardMotions?: CardMotionEvent[];
  onCardMotionDone?: (id: string) => void;
  stealVisual?: StealVisualState | undefined;
  effectInteraction?: TableEffectInteraction | undefined;
  onEffectCardSelect?: ((card: CardView, ownerId?: string) => void) | undefined;
  onEffectPlayerSelect?: ((playerId: string) => void) | undefined;
  onGiveCardDrop?: ((card: CardView, playerId: string) => void) | undefined;
  spectatorMode?: "follow" | "free" | undefined;
  freeRoamAvatar?: PlayerView["avatar"] | undefined;
  onExitFreeRoam?: (() => void) | undefined;
}) {
  const viewport = useVisualViewport();
  const mobile = viewport.width < 600;
  const e2eProjectionProbe =
    import.meta.env.DEV &&
    Boolean((window as unknown as { __DAIFUGO_E2E__?: unknown }).__DAIFUGO_E2E__);
  const keyboardOpen = viewport.keyboardInset > 80;
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [contextLost, setContextLost] = useState(false);
  const sceneRoom = useMemo(
    () => (room ? { ...room, players: playersAtTable(room.players) } : undefined),
    [room],
  );
  const [freeRoamInput, setFreeRoamInput] = useState<FreeRoamInput>({
    forward: 0,
    strafe: 0,
    turn: 0,
    jump: 0,
  });
  const freeRoamPointers = useRef(new Map<number, Partial<FreeRoamInput>>());
  const syncFreeRoamPointers = () => {
    let forward = 0;
    let strafe = 0;
    let turn = 0;
    for (const value of freeRoamPointers.current.values()) {
      forward += value.forward ?? 0;
      strafe += value.strafe ?? 0;
      turn += value.turn ?? 0;
    }
    setFreeRoamInput((current) => ({
      ...current,
      forward: MathUtils.clamp(forward, -1, 1),
      strafe: MathUtils.clamp(strafe, -1, 1),
      turn: MathUtils.clamp(turn, -1, 1),
    }));
  };
  const pressFreeRoamControl = (pointerId: number, value: Partial<FreeRoamInput>) => {
    freeRoamPointers.current.set(pointerId, value);
    syncFreeRoamPointers();
  };
  const releaseFreeRoamControl = (pointerId: number) => {
    freeRoamPointers.current.delete(pointerId);
    syncFreeRoamPointers();
  };
  const activeCardMotions = cardMotions;
  const movingToHand = useMemo(
    () =>
      new Set(
        activeCardMotions
          .filter((motion) => motion.to.kind === "hand")
          .map((motion) => motion.card.id),
      ),
    [activeCardMotions],
  );
  const movingToField = useMemo(
    () =>
      new Set(
        activeCardMotions
          .filter((motion) => motion.to.kind === "field")
          .map((motion) => motion.card.id),
      ),
    [activeCardMotions],
  );
  const movingToDiscard = useMemo(
    () =>
      new Set(
        activeCardMotions
          .filter((motion) => motion.to.kind === "discard")
          .map((motion) => motion.card.id),
      ),
    [activeCardMotions],
  );
  const movingToSeats = useMemo(() => {
    const destinations = new Map<string, Set<string>>();
    for (const motion of activeCardMotions) {
      if (motion.to.kind !== "seat") continue;
      const cards = destinations.get(motion.to.playerId) ?? new Set<string>();
      cards.add(motion.card.id);
      destinations.set(motion.to.playerId, cards);
    }
    return destinations;
  }, [activeCardMotions]);
  useEffect(() => {
    const resetFreeRoamMotion = () => {
      freeRoamPointers.current.clear();
      setFreeRoamInput(resetFreeRoamInput);
    };
    const change = () => {
      const visible = document.visibilityState !== "hidden";
      setPageVisible(visible);
      if (!visible) resetFreeRoamMotion();
    };
    document.addEventListener("visibilitychange", change);
    addEventListener("blur", resetFreeRoamMotion);
    return () => {
      document.removeEventListener("visibilitychange", change);
      removeEventListener("blur", resetFreeRoamMotion);
    };
  }, []);
  useEffect(() => {
    if (spectatorMode === "free") return;
    freeRoamPointers.current.clear();
    setFreeRoamInput(resetFreeRoamInput);
  }, [spectatorMode]);
  if (
    import.meta.env.DEV &&
    (window as unknown as { __DAIFUGO_E2E_RENDER_CANVAS__?: boolean })
      .__DAIFUGO_E2E_RENDER_CANVAS__ === false
  ) {
    return <div className="salon-canvas e2e-canvas-suppressed" aria-hidden="true" />;
  }
  return (
    <>
      <Canvas
        className="salon-canvas"
        frameloop="demand"
        dpr={lowPower ? 0.75 : [1, 1.6]}
        shadows={!lowPower}
        gl={{
          antialias: !lowPower,
          powerPreference: lowPower ? "low-power" : "high-performance",
          toneMapping: ACESFilmicToneMapping,
        }}
        camera={{ position: [0, 6.4, 10.8], fov: 45, near: 0.1, far: 60 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            setContextLost(true);
          });
          gl.domElement.addEventListener("webglcontextrestored", () => setContextLost(false));
        }}
      >
        {pageVisible && (
          <FrameScheduler
            fps={spectatorMode === "free" ? (lowPower ? 30 : 60) : lowPower ? 24 : 30}
          />
        )}
        <color attach="background" args={["#06100f"]} />
        <fog attach="fog" args={["#06100f", 14, 28]} />
        <ambientLight intensity={0.8} color="#b6c5b4" />
        <directionalLight
          position={[4, 8, 5]}
          intensity={2.1}
          color="#ffe2ae"
          castShadow={!lowPower}
        />
        <Suspense fallback={null}>
          <SalonRoom lowPower={lowPower} />
          <CircularTable />
          {sceneRoom && <TableDeck />}
          {sceneRoom
            ? seats(
                sceneRoom.players,
                sceneRoom.role === "spectator" && spectatorMode === "follow"
                  ? (sceneRoom.focusedPlayerId ?? sceneRoom.players[0]?.id)
                  : sceneRoom.viewerId,
                sceneRoom.currentPlayerId,
                lowPower,
                mobile,
                e2eProjectionProbe,
                movingToSeats,
                stealVisual?.perspective === "victim" ? undefined : stealVisual?.targetPlayerId,
                sceneRoom.role !== "spectator" || spectatorMode === "follow",
                effectInteraction,
                onEffectCardSelect,
                onEffectPlayerSelect,
              )
            : previewAvatar && (
                <group position={[mobile ? 0 : 3.05, 0.35, mobile ? 1.65 : 2.1]} scale={1.2}>
                  <Avatar3D profile={previewAvatar} lowPower={lowPower} active />
                </group>
              )}
          {!dealing &&
            fieldCards(
              sceneRoom?.fieldPlays ?? (sceneRoom?.field.length ? [sceneRoom.field] : []),
              movingToField,
            )}
          {!dealing &&
            discardStack(
              sceneRoom?.discard ?? [],
              movingToDiscard,
              effectInteraction,
              (card) => onEffectCardSelect(card),
              mobile,
            )}
          {sceneRoom &&
            !dealing &&
            !(sceneRoom.role === "spectator" && spectatorMode === "free") &&
            handCards(
              sceneRoom.hand,
              selectedIds,
              playableIds,
              onToggleCard,
              mobile,
              movingToHand,
              effectInteraction,
              onGiveCardDrop,
              sceneRoom.players,
            )}
          {sceneRoom && dealing && <DealingSequence playerCount={sceneRoom.players.length} />}
          {sceneRoom && (
            <CardMotionLayer
              motions={activeCardMotions}
              room={sceneRoom}
              mobile={mobile}
              onDone={onCardMotionDone}
            />
          )}
          {sceneRoom && <StealVisualLayer state={stealVisual} room={sceneRoom} mobile={mobile} />}
          {!lowPower && (
            <ContactShadows position={[0, 0.08, 0]} opacity={0.5} scale={13} blur={2.8} far={6} />
          )}
          {!lowPower && (
            <Environment resolution={64} environmentIntensity={0.25}>
              <mesh scale={18}>
                <sphereGeometry args={[1, 24, 16]} />
                <meshBasicMaterial color="#203a34" side={BackSide} />
              </mesh>
              <mesh position={[0, 6, 2]}>
                <sphereGeometry args={[2.5, 12, 8]} />
                <meshBasicMaterial color="#ffcf89" />
              </mesh>
            </Environment>
          )}
        </Suspense>
        {sceneRoom?.role === "spectator" && spectatorMode === "free" && freeRoamAvatar ? (
          <FreeRoamAvatar
            mobileInput={freeRoamInput}
            playerCount={sceneRoom.players.length}
            mobile={mobile}
            profile={freeRoamAvatar}
            lowPower={lowPower}
            reducedMotion={reducedMotion}
            onExit={onExitFreeRoam}
          />
        ) : (
          <CameraRig
            spectator={sceneRoom?.role === "spectator"}
            mobile={mobile}
            reducedMotion={reducedMotion}
            focusIndex={Math.max(
              0,
              sceneRoom?.players.findIndex(
                (player) =>
                  player.id === (stealVisual?.targetPlayerId ?? sceneRoom.focusedPlayerId),
              ) ?? 0,
            )}
            playerCount={sceneRoom?.players.length ?? 0}
            keyboardOpen={keyboardOpen}
            effectPerspective={stealVisual?.perspective}
            effectOverview={Boolean(
              effectInteraction && ["steal", "give", "collect"].includes(effectInteraction.kind),
            )}
            actorIndex={Math.max(
              0,
              sceneRoom?.players.findIndex((player) => player.id === stealVisual?.actorId) ?? 0,
            )}
          />
        )}
        {sceneRoom && e2eProjectionProbe && (
          <EffectProjectionProbe
            room={sceneRoom}
            effectInteraction={effectInteraction}
            mobile={mobile}
          />
        )}
      </Canvas>
      {room?.role === "spectator" && spectatorMode === "free" && (
        <div className="free-roam-controls" aria-label="自由観戦の移動操作">
          <p>
            {mobile
              ? "キャラクターを移動・ジャンプ／画面ドラッグで向きを変更"
              : "WASD／矢印で移動・Spaceでジャンプ・ドラッグで向きを変更"}
          </p>
          <div>
            {[
              ["↶", { turn: -1 }, "左を向く"],
              ["↑", { forward: 1 }, "前へ進む"],
              ["↷", { turn: 1 }, "右を向く"],
              ["←", { strafe: -1 }, "左へ移動"],
              ["↓", { forward: -1 }, "後ろへ進む"],
              ["→", { strafe: 1 }, "右へ移動"],
            ].map(([label, value, ariaLabel], index) => {
              const keyboardPointerId = -(index + 1);
              return (
                <button
                  type="button"
                  key={String(ariaLabel)}
                  aria-label={String(ariaLabel)}
                  onPointerDown={(event) => {
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      // Synthetic test pointers are not registered by the browser's native pointer tracker.
                    }
                    pressFreeRoamControl(event.pointerId, value as Partial<FreeRoamInput>);
                  }}
                  onPointerUp={(event) => releaseFreeRoamControl(event.pointerId)}
                  onPointerCancel={(event) => releaseFreeRoamControl(event.pointerId)}
                  onLostPointerCapture={(event) => releaseFreeRoamControl(event.pointerId)}
                  onKeyDown={(event) => {
                    if (!isFreeRoamControlActivationKey(event.code)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    pressFreeRoamControl(keyboardPointerId, value as Partial<FreeRoamInput>);
                  }}
                  onKeyUp={(event) => {
                    if (!isFreeRoamControlActivationKey(event.code)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    releaseFreeRoamControl(keyboardPointerId);
                  }}
                  onBlur={() => releaseFreeRoamControl(keyboardPointerId)}
                >
                  {String(label)}
                </button>
              );
            })}
            <button
              type="button"
              className="free-roam-jump"
              aria-label="ジャンプ"
              onPointerDown={() =>
                setFreeRoamInput((current) => ({ ...current, jump: current.jump + 1 }))
              }
              onKeyDown={(event) => {
                if (!isFreeRoamControlActivationKey(event.code)) return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) {
                  setFreeRoamInput((current) => ({ ...current, jump: current.jump + 1 }));
                }
              }}
            >
              JUMP
            </button>
          </div>
        </div>
      )}
      {contextLost && (
        <p className="webgl-recovery" role="status">
          3D表示を復旧しています。カードは下の操作一覧から選べます。
        </p>
      )}
    </>
  );
}
