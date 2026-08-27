import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { CueEvent } from "../network/peerCues";

export type AvatarEmoteCue = Extract<CueEvent, { type: "emote" }>;
export type AvatarEmoteKind = AvatarEmoteCue["emote"];

export interface PlayerEmoteCue {
  cue: AvatarEmoteCue;
  sender: string;
}

export interface AvatarEmotePresentation {
  symbol: string;
  label: string;
  accent: string;
}

export interface ActiveAvatarEmote {
  playerId: string;
  cue: AvatarEmoteCue;
  presentation: AvatarEmotePresentation;
  remainingMs: number;
}

export const AVATAR_EMOTE_DURATION_MS = 2_800;

const presentations: Readonly<Record<AvatarEmoteKind, AvatarEmotePresentation>> = {
  surprise: { symbol: "!", label: "びっくり", accent: "#ffd66b" },
  applause: { symbol: "👏", label: "拍手", accent: "#ff9a65" },
  thinking: { symbol: "🤔", label: "考え中", accent: "#82d7ff" },
};

const bubbleStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(18, 22, 35, 0.94)",
  border: "3px solid var(--avatar-emote-accent)",
  borderRadius: "999px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.42)",
  color: "#ffffff",
  display: "flex",
  fontFamily: "system-ui, sans-serif",
  fontSize: "34px",
  fontWeight: 900,
  height: "58px",
  justifyContent: "center",
  lineHeight: 1,
  minWidth: "58px",
  padding: "0 10px",
  pointerEvents: "none",
  userSelect: "none",
  whiteSpace: "nowrap",
};

export function avatarEmotePresentation(kind: AvatarEmoteKind): AvatarEmotePresentation {
  return presentations[kind];
}

export function avatarEmoteRemainingMs(
  cue: AvatarEmoteCue,
  nowMs: number,
  durationMs = AVATAR_EMOTE_DURATION_MS,
): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const ageMs = Math.max(0, nowMs - cue.atMs);
  return Math.max(0, durationMs - ageMs);
}

/**
 * Selects one current emote per player. Input order does not matter except that a
 * later entry wins when two cues have the same timestamp.
 */
export function latestAvatarEmotesByPlayer(
  emotes: readonly PlayerEmoteCue[],
  nowMs: number,
  durationMs = AVATAR_EMOTE_DURATION_MS,
): ReadonlyMap<string, ActiveAvatarEmote> {
  const latest = new Map<string, PlayerEmoteCue>();
  for (const entry of emotes) {
    if (!entry.sender || !Number.isFinite(entry.cue.atMs)) continue;
    const previous = latest.get(entry.sender);
    if (!previous || entry.cue.atMs >= previous.cue.atMs) latest.set(entry.sender, entry);
  }

  const active = new Map<string, ActiveAvatarEmote>();
  for (const [playerId, entry] of latest) {
    const remainingMs = avatarEmoteRemainingMs(entry.cue, nowMs, durationMs);
    if (remainingMs <= 0) continue;
    active.set(playerId, {
      playerId,
      cue: entry.cue,
      presentation: avatarEmotePresentation(entry.cue.emote),
      remainingMs,
    });
  }
  return active;
}

export function latestAvatarEmoteForPlayer(
  emotes: readonly PlayerEmoteCue[],
  playerId: string,
  nowMs: number,
  durationMs = AVATAR_EMOTE_DURATION_MS,
): ActiveAvatarEmote | undefined {
  return latestAvatarEmotesByPlayer(emotes, nowMs, durationMs).get(playerId);
}

export interface AvatarEmoteProps {
  playerId: string;
  emotes: readonly PlayerEmoteCue[];
  durationMs?: number | undefined;
  /** Useful when replay time, rather than wall-clock time, drives the scene. */
  nowMs?: number | undefined;
  position?: readonly [number, number, number] | undefined;
  distanceFactor?: number | undefined;
}

/** Place inside an avatar group; the default position sits just above its head. */
export function AvatarEmote({
  playerId,
  emotes,
  durationMs = AVATAR_EMOTE_DURATION_MS,
  nowMs,
  position = [0, 3.42, 0],
  distanceFactor = 8.2,
}: AvatarEmoteProps) {
  const [wallClockMs, setWallClockMs] = useState(() => Date.now());
  const effectiveNowMs = nowMs ?? wallClockMs;
  const active = useMemo(
    () => latestAvatarEmoteForPlayer(emotes, playerId, effectiveNowMs, durationMs),
    [durationMs, effectiveNowMs, emotes, playerId],
  );
  const newestCue = useMemo(() => {
    let newest: AvatarEmoteCue | undefined;
    for (const entry of emotes) {
      if (entry.sender === playerId && (!newest || entry.cue.atMs >= newest.atMs)) {
        newest = entry.cue;
      }
    }
    return newest;
  }, [emotes, playerId]);

  useEffect(() => {
    if (nowMs !== undefined) return;
    const currentMs = Date.now();
    setWallClockMs(currentMs);
    if (!newestCue) return;
    const remainingMs = avatarEmoteRemainingMs(newestCue, currentMs, durationMs);
    if (remainingMs <= 0) return;
    const timeout = window.setTimeout(() => setWallClockMs(Date.now()), remainingMs + 1);
    return () => window.clearTimeout(timeout);
  }, [durationMs, newestCue, nowMs]);

  if (!active) return null;

  return (
    <Html
      center
      transform
      sprite
      position={[position[0], position[1], position[2]]}
      distanceFactor={distanceFactor}
      zIndexRange={[6, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div
        role="img"
        aria-label={`${active.presentation.label}のエモート`}
        data-avatar-emote={active.cue.emote}
        data-avatar-emote-event-id={active.cue.eventId}
        data-avatar-emote-player-id={playerId}
        style={
          {
            ...bubbleStyle,
            "--avatar-emote-accent": active.presentation.accent,
          } as CSSProperties
        }
      >
        {active.presentation.symbol}
      </div>
    </Html>
  );
}
