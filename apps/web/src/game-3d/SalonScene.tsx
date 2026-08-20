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

function CameraRig({
  spectator,
  mobile,
  reducedMotion,
  focusIndex,
  playerCount,
  keyboardOpen,
  effectFocus,
}: {
  spectator: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  focusIndex: number;
  playerCount: number;
  keyboardOpen: boolean;
  effectFocus: boolean;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const target = useMemo(() => {
    const radius = mobile ? (keyboardOpen ? 11.4 : 9.7) : 10.8;
    const angle =
      (spectator || effectFocus) && playerCount > 0
        ? (focusIndex / playerCount) * Math.PI * 2 + Math.PI / 2
        : Math.PI / 2;
    return {
      y: spectator ? 8.2 : effectFocus ? 7.4 : mobile ? (keyboardOpen ? 8.1 : 7.3) : 6.4,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }, [effectFocus, focusIndex, keyboardOpen, mobile, playerCount, spectator]);
  useEffect(() => {
    camera.fov = mobile ? (keyboardOpen ? 58 : 51) : spectator ? 47 : 45;
    camera.updateProjectionMatrix();
  }, [camera, keyboardOpen, mobile, spectator]);
  useFrame((_, delta) => {
    const factor = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
    camera.position.y = MathUtils.lerp(camera.position.y, target.y, factor);
    camera.position.x = MathUtils.lerp(camera.position.x, target.x, factor);
    camera.position.z = MathUtils.lerp(camera.position.z, target.z, factor);
    camera.lookAt(0, 0.3, 0);
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
      <mesh position={[0, 0.035, 0]}>
        <torusGeometry args={[4.67, 0.105, 14, 96]} />
        <meshStandardMaterial color="#c29d53" metalness={0.8} roughness={0.23} />
      </mesh>
      <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.42, 1.48, 64]} />
        <meshStandardMaterial color="#bf9b56" metalness={0.72} />
      </mesh>
      <mesh position={[2.9, 0.08, -1.45]} receiveShadow>
        <boxGeometry args={[1.65, 0.09, 2.18]} />
        <meshStandardMaterial color="#182c27" roughness={0.76} metalness={0.08} />
      </mesh>
      <mesh position={[2.9, 0.135, -1.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.78, 0.84, 4]} />
        <meshStandardMaterial color="#bf9b56" metalness={0.72} roughness={0.24} />
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
) {
  return players.map((player, index) => {
    const angle = (index / players.length) * Math.PI * 2 + Math.PI / 2;
    const radius = 5.45;
    return (
      <group
        key={player.id}
        position={[Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius]}
        rotation={[0, -angle - Math.PI / 2, 0]}
      >
        <Avatar3D
          profile={player.avatar}
          active={player.id === currentPlayerId}
          lowPower={lowPower}
        />
        <mesh position={[0, -0.12, 0]}>
          <cylinderGeometry args={[0.75, 0.75, 0.09, 48]} />
          <meshStandardMaterial
            color={player.id === currentPlayerId ? "#d7b668" : "#24302e"}
            metalness={0.45}
          />
        </mesh>
        {player.id !== viewerId && (
          <group position={[0, 0.28, 0.95]}>
            {(player.cards ?? []).map((card, cardIndex) => {
              const centered = cardIndex - ((player.cards?.length ?? 1) - 1) / 2;
              const spacing = Math.min(0.16, 2.4 / Math.max(player.cards?.length ?? 1, 1));
              return (
                <Card3D
                  key={card.id}
                  card={card}
                  hidden={movingToSeats.get(player.id)?.has(card.id) ?? false}
                  position={[centered * spacing, Math.abs(centered) * 0.002, 0]}
                  scale={0.22}
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
  const spacing = Math.min(mobile ? 0.37 : 0.53, (mobile ? 5.8 : 8) / Math.max(cards.length, 1));
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
        position={[
          centered * spacing,
          1.05 - Math.abs(centered) * 0.015,
          4.15 + Math.abs(centered) * 0.025,
        ]}
        rotation={[-0.42, 0, -centered * 0.035]}
        scale={mobile ? 0.78 : 0.92}
      />
    );
  });
}

function fieldCards(cards: CardView[], movingToField: ReadonlySet<string>) {
  return cards
    .slice(-6)
    .map((card, index) => (
      <Card3D
        key={card.id}
        card={card}
        hidden={movingToField.has(card.id)}
        position={[(index - (Math.min(cards.length, 6) - 1) / 2) * 0.48, 0.22 + index * 0.02, 0]}
        rotation={[-Math.PI / 2, 0, (index - 2) * 0.04]}
        scale={0.72}
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
}) {
  const viewport = useVisualViewport();
  const mobile = viewport.width < 600;
  const keyboardOpen = viewport.keyboardInset > 80;
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [contextLost, setContextLost] = useState(false);
  const activeCardMotions = reducedMotion ? [] : cardMotions;
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
  return (
    <>
      <Canvas
        className="salon-canvas"
        frameloop={pageVisible ? "always" : "never"}
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
            ? seats(room.players, room.viewerId, room.currentPlayerId, lowPower, movingToSeats)
            : previewAvatar && (
                <group position={[mobile ? 0 : 3.05, 0.35, mobile ? 1.65 : 2.1]} scale={1.2}>
                  <Avatar3D profile={previewAvatar} lowPower={lowPower} active />
                </group>
              )}
          {!dealing && fieldCards(room?.field ?? [], movingToField)}
          {room &&
            !dealing &&
            handCards(room.hand, selectedIds, playableIds, onToggleCard, mobile, movingToHand)}
          {room && dealing && <DealingSequence playerCount={room.players.length} />}
          {room && !reducedMotion && (
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
          effectFocus={Boolean(stealVisual)}
        />
      </Canvas>
      {contextLost && (
        <p className="webgl-recovery" role="status">
          3D表示を復旧しています。カードは下の操作一覧から選べます。
        </p>
      )}
    </>
  );
}
