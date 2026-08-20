import type { AvatarProfileV1 } from "@daifugo/avatar-schema";

export type AppPhase =
  | "BOOT"
  | "AUTHENTICATING"
  | "ENTRANCE"
  | "SALON_LOBBY"
  | "ROOM_WAITING"
  | "DEALING"
  | "PLAYING_TURN"
  | "AWAITING_FORCED_EFFECT"
  | "FINISHED";
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "grace" | "offline";
export type Role = "player" | "spectator";
export type Suit = "spade" | "heart" | "diamond" | "club";
export type Rank = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "2";

export type VisibleCard = {
  id: string;
  visibility: "face";
  suit?: Suit;
  rank?: Rank;
  joker?: "monochrome" | "crimson";
  blind: boolean;
  selected?: boolean;
  mimic?: { suit: Suit; rank: Rank };
};

export type HiddenCard = { id: string; visibility: "hidden"; blind: boolean; selected?: boolean };
export type CardView = VisibleCard | HiddenCard;

export interface PlayerView {
  id: string;
  name: string;
  avatar: AvatarProfileV1;
  cardCount: number;
  cards?: CardView[];
  connection: "online" | "grace" | "offline";
  status: "active" | "finished" | "disqualified";
  rank?: number;
  host: boolean;
}

export interface PendingEffectView {
  id: string;
  kind: "steal" | "give" | "discard" | "bomber" | "collect" | "clearField";
  actorId: string;
  requiredCount: number;
  eligibleCardIds?: string[];
  eligiblePlayerIds?: string[];
  message: string;
}

export interface RoomView {
  roomId: string;
  revision: number;
  gameId?: string;
  trickId?: string;
  generation: number;
  phase: "waiting" | "dealing" | "playing" | "effect" | "finished";
  role: Role;
  viewerId: string;
  hostId: string;
  players: PlayerView[];
  spectators: { id: string; name: string }[];
  settings: { mode: "normal" | "blind"; blindCount: number };
  currentPlayerId?: string;
  turnDeadlineMs?: number;
  direction: 1 | -1;
  revolution: boolean;
  jackBack: boolean;
  suitLock: Suit[];
  field: CardView[];
  discard: CardView[];
  hand: CardView[];
  pendingEffects: PendingEffectView[];
  pendingJokerMimic?: {
    cardIds: string[];
    candidates: { cardId: string; suit: Suit; rank: Rank }[][];
    revealedJokerIds: string[];
    revealedCards?: CardView[];
  };
  rankings: { playerId: string; place: number; reason?: string }[];
  log: { id: string; atMs: number; text: string; kind: "play" | "pass" | "effect" | "system" }[];
  chat?: { id: string; uid: string; name: string; role: Role; text: string; atMs: number }[];
  focusedPlayerId?: string;
}

export interface PublicRoom {
  roomId: string;
  hostName: string;
  hostAvatar: AvatarProfileV1;
  playerCount: number;
  spectatorCount: number;
  mode: "normal" | "blind";
  blindCount: number;
  phase: "waiting" | "playing";
  createdAtMs: number;
}

export interface LocalProfile {
  name: string;
  avatar: AvatarProfileV1;
}

export type AppState = {
  phase: AppPhase;
  connection: ConnectionState;
  role?: Role | undefined;
  room?: RoomView | undefined;
  profile?: LocalProfile | undefined;
  error?: string | undefined;
};

export type AppEvent =
  | { type: "BOOT" }
  | { type: "AUTH_OK" }
  | { type: "AUTH_FAILED"; message: string }
  | { type: "ENTER_SALON"; profile: LocalProfile }
  | { type: "ROOM_VIEW"; room: RoomView }
  | { type: "DEALING_DONE" }
  | { type: "LEAVE_ROOM" }
  | { type: "EVICTED"; message: string }
  | { type: "CONNECTION"; connection: ConnectionState }
  | { type: "ERROR"; message: string }
  | { type: "CLEAR_ERROR" };
