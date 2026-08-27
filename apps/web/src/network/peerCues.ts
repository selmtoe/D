export type SpectatorPoseCue = {
  version: 1;
  type: "spectatorPose";
  eventId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  freeSpectating: boolean;
  atMs: number;
};

export type CueEvent =
  | {
      version: 1;
      type: "emote";
      eventId: string;
      emote: "applause" | "surprise" | "thinking";
      atMs: number;
    }
  | { version: 1; type: "focus"; eventId: string; focusPlayerId: string; atMs: number }
  | {
      version: 1;
      type: "animation";
      eventId: string;
      cue: "play" | "pass" | "flush";
      atMs: number;
    }
  | {
      version: 1;
      type: "animation";
      eventId: string;
      cue: "steal";
      stage: "target" | "point" | "take" | "complete";
      targetPlayerId: string;
      cardCount: number;
      takeCount: number;
      slot?: number;
      pointerX?: number;
      selectedSlots?: number[];
      atMs: number;
    }
  | SpectatorPoseCue;

const SPECTATOR_HORIZONTAL_LIMIT = 16;
const SPECTATOR_Y_MIN = 0;
const SPECTATOR_Y_MAX = 12;
const SPECTATOR_YAW_LIMIT = Math.PI;
const SPECTATOR_FUTURE_CLOCK_SKEW_MS = 30_000;

const exactKeys: Record<CueEvent["type"], string[]> = {
  emote: ["version", "type", "eventId", "emote", "atMs"],
  focus: ["version", "type", "eventId", "focusPlayerId", "atMs"],
  animation: [
    "version",
    "type",
    "eventId",
    "cue",
    "stage",
    "targetPlayerId",
    "cardCount",
    "takeCount",
    "slot",
    "pointerX",
    "selectedSlots",
    "atMs",
  ],
  spectatorPose: [
    "version",
    "type",
    "eventId",
    "x",
    "y",
    "z",
    "yaw",
    "moving",
    "freeSpectating",
    "atMs",
  ],
};

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function parseCue(value: unknown): CueEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    item.version !== 1 ||
    !["emote", "focus", "animation", "spectatorPose"].includes(String(item.type)) ||
    typeof item.eventId !== "string" ||
    item.eventId.length > 128 ||
    typeof item.atMs !== "number"
  ) {
    return null;
  }
  const type = item.type as CueEvent["type"];
  if (Object.keys(item).some((key) => !exactKeys[type].includes(key))) return null;
  if (
    type === "spectatorPose" &&
    Object.keys(item).length === exactKeys.spectatorPose.length &&
    item.eventId.length > 0 &&
    isFiniteInRange(item.x, -SPECTATOR_HORIZONTAL_LIMIT, SPECTATOR_HORIZONTAL_LIMIT) &&
    isFiniteInRange(item.y, SPECTATOR_Y_MIN, SPECTATOR_Y_MAX) &&
    isFiniteInRange(item.z, -SPECTATOR_HORIZONTAL_LIMIT, SPECTATOR_HORIZONTAL_LIMIT) &&
    isFiniteInRange(item.yaw, -SPECTATOR_YAW_LIMIT, SPECTATOR_YAW_LIMIT) &&
    typeof item.moving === "boolean" &&
    typeof item.freeSpectating === "boolean" &&
    (item.freeSpectating || !item.moving) &&
    Number.isSafeInteger(item.atMs) &&
    Number(item.atMs) >= 0 &&
    Number(item.atMs) <= Date.now() + SPECTATOR_FUTURE_CLOCK_SKEW_MS
  ) {
    return item as SpectatorPoseCue;
  }
  if (type === "emote" && ["applause", "surprise", "thinking"].includes(String(item.emote))) {
    return item as CueEvent;
  }
  if (
    type === "focus" &&
    typeof item.focusPlayerId === "string" &&
    item.focusPlayerId.length <= 128
  ) {
    return item as CueEvent;
  }
  if (type === "animation" && ["play", "pass", "flush"].includes(String(item.cue))) {
    if (
      Object.keys(item).some((key) =>
        [
          "stage",
          "targetPlayerId",
          "cardCount",
          "takeCount",
          "slot",
          "pointerX",
          "selectedSlots",
        ].includes(key),
      )
    )
      return null;
    return item as CueEvent;
  }
  if (
    type === "animation" &&
    item.cue === "steal" &&
    ["target", "point", "take", "complete"].includes(String(item.stage)) &&
    typeof item.targetPlayerId === "string" &&
    item.targetPlayerId.length > 0 &&
    item.targetPlayerId.length <= 128 &&
    Number.isInteger(item.cardCount) &&
    Number(item.cardCount) >= 0 &&
    Number(item.cardCount) <= 54 &&
    Number.isInteger(item.takeCount) &&
    Number(item.takeCount) >= 0 &&
    Number(item.takeCount) <= 6 &&
    (item.slot === undefined ||
      (Number.isInteger(item.slot) && Number(item.slot) >= 0 && Number(item.slot) <= 53)) &&
    (item.pointerX === undefined ||
      (typeof item.pointerX === "number" &&
        Number.isFinite(item.pointerX) &&
        item.pointerX >= -1 &&
        item.pointerX <= 1)) &&
    (item.selectedSlots === undefined ||
      (Array.isArray(item.selectedSlots) &&
        item.selectedSlots.length <= 6 &&
        item.selectedSlots.every(
          (slot) => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) <= 53,
        ))) &&
    (["point", "take"].includes(String(item.stage))
      ? typeof item.slot === "number"
      : item.slot === undefined)
  ) {
    return item as CueEvent;
  }
  return null;
}

export function encodeCueWire(cue: CueEvent): { kind: CueEvent["type"]; payload: string } {
  return { kind: cue.type, payload: JSON.stringify(cue) };
}

export function decodeCueWire(value: Record<string, unknown>): CueEvent | null {
  if (typeof value.kind !== "string" || typeof value.payload !== "string") return null;
  try {
    const cue = parseCue(JSON.parse(value.payload));
    return cue?.type === value.kind ? cue : null;
  } catch {
    return null;
  }
}

export function emoteCue(emote: "applause" | "surprise" | "thinking"): CueEvent {
  return { version: 1, type: "emote", eventId: crypto.randomUUID(), emote, atMs: Date.now() };
}

export function spectatorPoseCue(
  pose: Pick<SpectatorPoseCue, "x" | "y" | "z" | "yaw" | "moving" | "freeSpectating">,
  atMs = Date.now(),
): SpectatorPoseCue {
  const cue: SpectatorPoseCue = {
    version: 1,
    type: "spectatorPose",
    eventId: crypto.randomUUID(),
    ...pose,
    atMs,
  };
  if (!parseCue(cue)) throw new RangeError("Invalid spectator pose cue");
  return cue;
}

export function stealAnimationCue(
  stage: "target" | "point" | "take" | "complete",
  targetPlayerId: string,
  detail: {
    cardCount: number;
    takeCount: number;
    slot?: number;
    pointerX?: number;
    selectedSlots?: number[];
  },
): CueEvent {
  return {
    version: 1,
    type: "animation",
    eventId: crypto.randomUUID(),
    cue: "steal",
    stage,
    targetPlayerId,
    cardCount: detail.cardCount,
    takeCount: detail.takeCount,
    ...(detail.slot === undefined ? {} : { slot: detail.slot }),
    ...(detail.pointerX === undefined ? {} : { pointerX: detail.pointerX }),
    ...(detail.selectedSlots === undefined ? {} : { selectedSlots: detail.selectedSlots }),
    atMs: Date.now(),
  };
}
