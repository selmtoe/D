import { defaultAvatar, type AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Group } from "three";
import type { RoomView } from "../app/model";
import type { SpectatorPoseCue } from "../network/peerCues";
import { Avatar3D } from "../avatar-3d/Avatar3D";
import { CharacterNameTag } from "./PlayerPresentation";

export interface RemoteSpectatorParticipant {
  id: string;
  name: string;
  avatar: AvatarProfileV1;
  rank?: number;
  disqualified?: boolean;
}

/** A finished player can free-roam too, so pose owners may come from either room list. */
export function remoteSpectatorParticipants(
  room: RoomView,
  poses: ReadonlyMap<string, SpectatorPoseCue>,
): Array<RemoteSpectatorParticipant & { pose: SpectatorPoseCue }> {
  const candidates = new Map<string, RemoteSpectatorParticipant>();
  for (const player of room.players) {
    if (player.present === false) continue;
    candidates.set(player.id, {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      ...(player.rank === undefined ? {} : { rank: player.rank }),
      ...(player.status === "disqualified" ? { disqualified: true } : {}),
    });
  }
  for (const spectator of room.spectators) {
    candidates.set(spectator.id, {
      id: spectator.id,
      name: spectator.name,
      avatar: spectator.avatar ?? defaultAvatar,
    });
  }
  return [...poses].flatMap(([id, pose]) => {
    const participant = id === room.viewerId ? undefined : candidates.get(id);
    return participant && pose.freeSpectating ? [{ ...participant, pose }] : [];
  });
}

function lerpAngle(current: number, target: number, factor: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * factor;
}

function RemoteSpectatorAvatar({
  participant,
  lowPower,
}: {
  participant: RemoteSpectatorParticipant & { pose: SpectatorPoseCue };
  lowPower: boolean;
}) {
  const root = useRef<Group>(null);
  const target = useRef(new Vector3(participant.pose.x, participant.pose.y, participant.pose.z));
  const predicted = useMemo(() => new Vector3(), []);
  const velocity = useRef(new Vector3());
  const receivedAt = useRef(performance.now());
  const previousPose = useRef(participant.pose);
  useEffect(() => {
    const previous = previousPose.current;
    const elapsedSeconds = Math.max(0.016, (participant.pose.atMs - previous.atMs) / 1_000);
    velocity.current
      .set(
        participant.pose.x - previous.x,
        participant.pose.y - previous.y,
        participant.pose.z - previous.z,
      )
      .divideScalar(elapsedSeconds)
      .clampLength(0, 6.5);
    if (!participant.pose.moving) velocity.current.set(0, 0, 0);
    target.current.set(participant.pose.x, participant.pose.y, participant.pose.z);
    previousPose.current = participant.pose;
    receivedAt.current = performance.now();
  }, [participant.pose]);
  useFrame((_, delta) => {
    if (!root.current) return;
    const factor = 1 - Math.exp(-Math.min(delta, 0.1) * 18);
    const extrapolationSeconds = participant.pose.moving
      ? Math.min(0.1, Math.max(0, (performance.now() - receivedAt.current) / 1_000))
      : 0;
    predicted.copy(target.current).addScaledVector(velocity.current, extrapolationSeconds);
    root.current.position.lerp(predicted, factor);
    root.current.rotation.y = lerpAngle(
      root.current.rotation.y,
      participant.pose.yaw + Math.PI,
      factor,
    );
  });
  return (
    <group
      ref={root}
      name={`remote-spectator-${participant.id}`}
      position={[participant.pose.x, participant.pose.y, participant.pose.z]}
      rotation={[0, participant.pose.yaw + Math.PI, 0]}
    >
      <Avatar3D profile={participant.avatar} lowPower={lowPower} active={participant.pose.moving} />
      <CharacterNameTag
        name={participant.name}
        rank={participant.rank}
        disqualified={participant.disqualified}
        kind="spectator"
      />
      <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.66, 0.78, lowPower ? 18 : 32]} />
        <meshBasicMaterial color="#78d8ff" transparent opacity={0.74} />
      </mesh>
    </group>
  );
}

export function RemoteSpectatorAvatars({
  room,
  poses,
  lowPower,
}: {
  room: RoomView;
  poses: ReadonlyMap<string, SpectatorPoseCue>;
  lowPower: boolean;
}) {
  const canvas = useThree((state) => state.gl.domElement);
  const participants = remoteSpectatorParticipants(room, poses);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    canvas.dataset.remoteSpectatorCount = String(participants.length);
    return () => {
      delete canvas.dataset.remoteSpectatorCount;
    };
  }, [canvas, participants.length]);
  return participants.map((participant) => (
    <RemoteSpectatorAvatar key={participant.id} participant={participant} lowPower={lowPower} />
  ));
}
