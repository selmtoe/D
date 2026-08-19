import type { GameState, JokerMimic } from "@daifugo/rules";
import type { Timestamp } from "firebase-admin/firestore";

export type RoomStatus = "waiting" | "playing" | "finished" | "frozen";
export type MemberRole = "player" | "spectator";
export type ConnectionStatus = "connected" | "grace" | "left";

export interface RoomSettings {
  mode: "normal" | "blind";
  blindCount: number;
}

export interface RoomMember {
  uid: string;
  name: string;
  role: MemberRole;
  connectionStatus: ConnectionStatus;
  joinedAt: Timestamp;
  joinedOrder: number;
  avatar: unknown;
  focusPlayerId: string | null;
  reconnectTokenHash: string;
  disconnectDeadlineAt: Timestamp | null;
  reconnectExpired: boolean;
  timeoutWarnings: number;
  lastChatAt: Timestamp | null;
}

export interface PublicChatEntry {
  id: string;
  uid: string;
  name: string;
  role: MemberRole;
  text: string;
  createdAt: Timestamp;
}

export interface PublicEventEntry {
  id: string;
  type: string;
  actorUid: string | null;
  createdAt: Timestamp;
  revision: number;
}

export interface RoomDocument {
  schemaVersion: 2;
  roomId: string;
  status: RoomStatus;
  visibility: "public" | "private";
  revision: number;
  gameId: string | null;
  rematchGeneration: number;
  hostUid: string;
  settings: RoomSettings;
  members: Record<string, RoomMember>;
  game: GameState | null;
  cardTokens: Record<string, string>;
  pendingMimic: {
    actorUid: string;
    cardIds: string[];
    candidates: JokerMimic[][];
    committedActionId: string;
    createdAt: Timestamp;
  } | null;
  publicChat: PublicChatEntry[];
  publicEvents: PublicEventEntry[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActivityAt: Timestamp;
  expiresAt: Timestamp;
  turnDeadlineAt: Timestamp | null;
  nextDeadlineAt: Timestamp | null;
  nextDeadlineKind: "turn" | "disconnect" | null;
  frozenReason: string | null;
}

export interface StoredActionResult {
  schemaVersion: 2;
  uid: string;
  command: string;
  roomId: string;
  clientActionId: string;
  response: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface AuditEvent {
  schemaVersion: 2;
  roomId: string;
  gameId: string | null;
  actorUid: string | null;
  command: string;
  actionId: string;
  revision: number;
  createdAt: Timestamp;
  source: "callable" | "presence" | "scheduler";
  summary: Record<string, string | number | boolean | null>;
}
