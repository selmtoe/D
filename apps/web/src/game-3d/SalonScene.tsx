import { ContactShadows, Environment } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  BackSide,
  MathUtils,
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
  actorIndex,
}: {
  spectator: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  focusIndex: number;
  playerCount: number;
  keyboardOpen: boolean;
  effectPerspective?: StealVisualState["perspective"] | undefined;
  actorIndex: number;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const target = useMemo(() => {
    const radius = mobile ? (keyboardOpen ? 11.4 : 9.7) : 10.8;
    const targetAngle = (focusIndex / Math.max(1, playerCount)) * Math.PI * 2 + Math.PI / 2;
    const actorAngle = (actorIndex / Math.max(1, playerCount)) * Math.PI * 2 + Math.PI / 2;
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
      y: mobile ? (keyboardOpen ? 8.1 : 7.3) : 6.4,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      lookX: 0,
      lookY: 0.3,
      lookZ: 0,
    };
  }, [actorIndex, effectPerspective, focusIndex, keyboardOpen, mobile, playerCount, spectator]);
  useEffect(() => {
    camera.fov = mobile ? (keyboardOpen ? 58 : 51) : 45;
    camera.updateProjectionMatrix();
  }, [camera, keyboardOpen, mobile, spectator]);
  useFrame((_, delta) => {
    const factor = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
    camera.position.y = MathUtils.lerp(camera.position.y, target.y, factor);
    camera.position.x = MathUtils.lerp(camera.position.x, target.x, factor);
    camera.position.z = MathUtils.lerp(camera.position.z, target.z, factor);
    camera.lookAt(target.lookX, target.lookY, target.lookZ);
  });
  return null;
}

type FreeRoamInput = { forward: number; strafe: number; turn: number };

function FreeRoamCamera({
  mobileInput,
  playerCount,
  mobile,
}: {
  mobileInput: FreeRoamInput;
  playerCount: number;
  mobile: boolean;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(-0.08);
  const dragging = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const cameraHeight = mobile ? 2.85 : 2.45;

  useEffect(() => {
    camera.position.set(0, cameraHeight, mobile ? 8.85 : 8.05);
    camera.fov = 68;
    camera.updateProjectionMatrix();
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button") || target?.isContentEditable) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
      keys.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const canvas = gl.domElement;
    const pointerDown = (event: PointerEvent) => {
      dragging.current = true;
      pointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= (event.clientX - pointer.current.x) * 0.004;
      pitch.current = MathUtils.clamp(
        pitch.current - (event.clientY - pointer.current.y) * 0.003,
        -0.9,
        0.72,
      );
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      dragging.current = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      keys.current.clear();
    };
  }, [camera, cameraHeight, gl, mobile]);

  useFrame((_, delta) => {
    const forward =
      (keys.current.has("KeyW") || keys.current.has("ArrowUp") ? 1 : 0) -
      (keys.current.has("KeyS") || keys.current.has("ArrowDown") ? 1 : 0) +
      mobileInput.forward;
    const strafe =
      (keys.current.has("KeyD") || keys.current.has("ArrowRight") ? 1 : 0) -
      (keys.current.has("KeyA") || keys.current.has("ArrowLeft") ? 1 : 0) +
      mobileInput.strafe;
    yaw.current += mobileInput.turn * delta * 1.65;
    const speed = (keys.current.has("ShiftLeft") ? 5.2 : 2.8) * Math.min(delta, 0.05);
    let nextX =
      camera.position.x +
      (Math.sin(yaw.current) * forward + Math.cos(yaw.current) * strafe) * speed;
    let nextZ =
      camera.position.z +
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
      const clearance = mobile ? 3.4 : 2.65;
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
    camera.position.set(nextX, cameraHeight, nextZ);
    const horizontal = Math.cos(pitch.current);
    camera.lookAt(
      nextX + Math.sin(yaw.current) * horizontal,
      cameraHeight + Math.sin(pitch.current),
      nextZ - Math.cos(yaw.current) * horizontal,
    );
  });
  return null;
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
          <mesh position={[-3.5, 5.2, 1]}>
            <cylinderGeometry args={[0.75, 0.35, 0.55, 24]} />
            <meshStandardMaterial color="#b69552" metalness={0.8} />
          </mesh>
          <mesh position={[3.5, 5.2, 1]}>
            <cylinderGeometry args={[0.75, 0.35, 0.55, 24]} />
            <meshStandardMaterial color="#b69552" metalness={0.8} />
          </mesh>
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
  movingToSeats = new Map<string, ReadonlySet<string>>(),
  hiddenCardPlayerId?: string,
  hideViewerAvatar = true,
  effectInteraction?: TableEffectInteraction,
  onEffectCardSelect: (card: CardView, ownerId: string) => void = () => undefined,
  onEffectPlayerSelect: (playerId: string) => void = () => undefined,
) {
  return players.map((player, index) => {
    const angle = (index / players.length) * Math.PI * 2 + Math.PI / 2;
    const radius = 5.45;
    const giveTarget =
      effectInteraction?.kind === "give" &&
      Boolean(effectInteraction.pendingGiveCardId) &&
      effectInteraction.targetPlayerIds.has(player.id);
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
          <group position={[0, 0.28, 0.95]}>
            {(player.cards ?? []).map((card, cardIndex) => {
              const centered = cardIndex - ((player.cards?.length ?? 1) - 1) / 2;
              const spacing = Math.min(0.16, 2.4 / Math.max(player.cards?.length ?? 1, 1));
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
                    ? { onSelect: () => onEffectCardSelect(card, player.id) }
                    : {})}
                  position={[
                    centered * (effectInteraction?.kind === "steal" ? 0.31 : spacing),
                    Math.abs(centered) * 0.002,
                    0,
                  ]}
                  scale={effectInteraction?.kind === "steal" ? 0.38 : 0.22}
                  selectedLift={0.42}
                />
              );
            })}
          </group>
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
) {
  const spacing = Math.min(mobile ? 0.44 : 0.62, (mobile ? 6.8 : 8.8) / Math.max(cards.length, 1));
  return cards.map((card, index) => {
    const centered = index - (cards.length - 1) / 2;
    return (
      <Card3D
        key={card.id}
        card={card}
        selected={selectedIds.includes(card.id)}
        dimmed={Boolean(playableIds && !playableIds.has(card.id))}
        hidden={movingToHand.has(card.id)}
        onSelect={() => toggle(card)}
        position={[centered * spacing, 1.05 - Math.abs(centered) * 0.015, 4.08 + index * 0.035]}
        rotation={[-0.42, 0, -centered * 0.035]}
        scale={mobile ? 0.78 : 0.92}
        renderOrder={selectedIds.includes(card.id) ? 1_000 + index : 100 + index}
        selectedLift={mobile ? 0.48 : 0.56}
      />
    );
  });
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
) {
  const collecting = effectInteraction?.kind === "collect";
  const visibleStack = collecting
    ? cards.filter((card) => !movingToDiscard.has(card.id))
    : cards.filter((card) => !movingToDiscard.has(card.id)).slice(-12);
  const spacing = Math.min(0.54, 7.2 / Math.max(visibleStack.length, 1));
  return visibleStack.map((card, index) => (
    <Card3D
      key={card.id}
      card={card}
      selected={Boolean(effectInteraction?.selectedIds.has(card.id))}
      dimmed={collecting && !effectInteraction.selectableIds.has(card.id)}
      {...(collecting && effectInteraction.selectableIds.has(card.id)
        ? { onSelect: () => onEffectCardSelect(card) }
        : {})}
      position={
        collecting
          ? [(index - (visibleStack.length - 1) / 2) * spacing, 0.34 + index * 0.004, 2.15]
          : [2.9, 0.15 + index * 0.012, -1.45]
      }
      rotation={
        collecting
          ? [-Math.PI / 2, 0, (index - (visibleStack.length - 1) / 2) * 0.014]
          : [-Math.PI / 2, 0, ((index % 5) - 2) * 0.018]
      }
      scale={collecting ? 0.68 : 0.62}
      renderOrder={(collecting ? 700 : 500) + index}
      selectedLift={0.5}
    />
  ));
}

const DEAL_CARD: CardView = { id: "deal-card", visibility: "hidden", blind: false };

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
      MathUtils.lerp(0, targetX, eased),
      0.24 + Math.sin(progress * Math.PI) * 2.15 + round * 0.008,
      MathUtils.lerp(0, targetZ, eased),
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
      {Array.from({ length: 5 }, (_, index) => (
        <Card3D
          key={`deck-${index}`}
          card={{ ...DEAL_CARD, id: `deck-${index}` }}
          position={[0, 0.18 + index * 0.012, 0]}
          rotation={[-Math.PI / 2, 0, index * 0.018]}
          scale={0.46}
        />
      ))}
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
  spectatorMode = "follow",
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
  spectatorMode?: "follow" | "free" | undefined;
}) {
  const viewport = useVisualViewport();
  const mobile = viewport.width < 600;
  const keyboardOpen = viewport.keyboardInset > 80;
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [contextLost, setContextLost] = useState(false);
  const [freeRoamInput, setFreeRoamInput] = useState<FreeRoamInput>({
    forward: 0,
    strafe: 0,
    turn: 0,
  });
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
    const change = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
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
        {pageVisible && <FrameScheduler fps={lowPower ? 24 : 30} />}
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
          {room
            ? seats(
                room.players,
                room.role === "spectator" && spectatorMode === "follow"
                  ? (room.focusedPlayerId ?? room.players[0]?.id)
                  : room.viewerId,
                room.currentPlayerId,
                lowPower,
                movingToSeats,
                stealVisual?.perspective === "victim" ? undefined : stealVisual?.targetPlayerId,
                room.role !== "spectator" || spectatorMode === "follow",
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
            fieldCards(room?.fieldPlays ?? (room?.field.length ? [room.field] : []), movingToField)}
          {!dealing &&
            discardStack(room?.discard ?? [], movingToDiscard, effectInteraction, (card) =>
              onEffectCardSelect(card),
            )}
          {room &&
            !dealing &&
            !(room.role === "spectator" && spectatorMode === "free") &&
            handCards(room.hand, selectedIds, playableIds, onToggleCard, mobile, movingToHand)}
          {room && dealing && <DealingSequence playerCount={room.players.length} />}
          {room && (
            <CardMotionLayer
              motions={activeCardMotions}
              room={room}
              mobile={mobile}
              onDone={onCardMotionDone}
            />
          )}
          {room && <StealVisualLayer state={stealVisual} room={room} mobile={mobile} />}
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
        {room?.role === "spectator" && spectatorMode === "free" ? (
          <FreeRoamCamera
            mobileInput={freeRoamInput}
            playerCount={room.players.length}
            mobile={mobile}
          />
        ) : (
          <CameraRig
            spectator={room?.role === "spectator"}
            mobile={mobile}
            reducedMotion={reducedMotion}
            focusIndex={Math.max(
              0,
              room?.players.findIndex(
                (player) => player.id === (stealVisual?.targetPlayerId ?? room.focusedPlayerId),
              ) ?? 0,
            )}
            playerCount={room?.players.length ?? 0}
            keyboardOpen={keyboardOpen}
            effectPerspective={stealVisual?.perspective}
            actorIndex={Math.max(
              0,
              room?.players.findIndex((player) => player.id === stealVisual?.actorId) ?? 0,
            )}
          />
        )}
      </Canvas>
      {room?.role === "spectator" && spectatorMode === "free" && (
        <div className="free-roam-controls" aria-label="自由観戦の移動操作">
          <p>{mobile ? "ボタンで移動・画面ドラッグで視点" : "WASD／矢印で移動・ドラッグで視点"}</p>
          <div>
            {[
              ["↶", { turn: -1 }, "左を向く"],
              ["↑", { forward: 1 }, "前へ進む"],
              ["↷", { turn: 1 }, "右を向く"],
              ["←", { strafe: -1 }, "左へ移動"],
              ["↓", { forward: -1 }, "後ろへ進む"],
              ["→", { strafe: 1 }, "右へ移動"],
            ].map(([label, value, ariaLabel]) => (
              <button
                type="button"
                key={String(ariaLabel)}
                aria-label={String(ariaLabel)}
                onPointerDown={() =>
                  setFreeRoamInput((current) => ({ ...current, ...(value as object) }))
                }
                onPointerUp={() => setFreeRoamInput({ forward: 0, strafe: 0, turn: 0 })}
                onPointerCancel={() => setFreeRoamInput({ forward: 0, strafe: 0, turn: 0 })}
                onPointerLeave={() => setFreeRoamInput({ forward: 0, strafe: 0, turn: 0 })}
              >
                {String(label)}
              </button>
            ))}
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
