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
    };

const exactKeys: Record<CueEvent["type"], string[]> = {
  emote: ["version", "type", "eventId", "emote", "atMs"],
  focus: ["version", "type", "eventId", "focusPlayerId", "atMs"],
  animation: ["version", "type", "eventId", "cue", "atMs"],
};

export function parseCue(value: unknown): CueEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    item.version !== 1 ||
    !["emote", "focus", "animation"].includes(String(item.type)) ||
    typeof item.eventId !== "string" ||
    item.eventId.length > 128 ||
    typeof item.atMs !== "number"
  ) {
    return null;
  }
  const type = item.type as CueEvent["type"];
  if (Object.keys(item).some((key) => !exactKeys[type].includes(key))) return null;
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
