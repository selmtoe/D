export const SUITS = ["spade", "heart", "diamond", "club"] as const;
export type Suit = (typeof SUITS)[number];

/** Domain identifiers are named explicitly even though their wire form is a string. */
export type CardId = string;
export type PlayerId = string;
export type RoomId = string;

export const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
export type Rank = (typeof RANKS)[number];
export type PhysicalRank = Rank | "JOKER";

export interface Card {
  readonly id: CardId;
  readonly suit: Suit | null;
  readonly rank: PhysicalRank;
}

export interface HandCard {
  card: Card;
  blind: boolean;
}

export interface JokerMimic {
  cardId: CardId;
  suit: Suit;
  rank: Rank;
}

export interface EffectiveCard {
  card: Card;
  suit: Suit | null;
  rank: PhysicalRank;
  mimic: JokerMimic | null;
}

export type PlayKind = "group" | "straight";

export interface PlayedGroup {
  id: string;
  playerId: PlayerId;
  kind: PlayKind;
  cards: EffectiveCard[];
}

export type PlayerStatus = "active" | "finished" | "disqualified";

export interface PlayerState {
  id: PlayerId;
  seat: number;
  hand: HandCard[];
  status: PlayerStatus;
  rank: number | null;
  finishReason: "played" | "effect" | "last-standing" | "disqualified" | null;
  timeoutWarnings: number;
}

export type GameMode = "normal" | "blind";
export type GamePhase = "playing" | "finished";

export interface RecoverEffect {
  id: string;
  type: "recover";
  actorId: PlayerId;
  count: number;
}

export interface StealEffect {
  id: string;
  type: "steal";
  actorId: PlayerId;
  count: number;
}

export interface GiveEffect {
  id: string;
  type: "give";
  actorId: PlayerId;
  count: number;
}

export interface DiscardEffect {
  id: string;
  type: "discard";
  actorId: PlayerId;
  count: number;
}

export interface BombEffect {
  id: string;
  type: "bomb";
  actorId: PlayerId;
  count: number;
}

export type PendingEffect = RecoverEffect | StealEffect | GiveEffect | DiscardEffect | BombEffect;

export type AutomaticEffect =
  | { id: string; type: "toggle-jack-back" }
  | { id: string; type: "toggle-revolution" }
  | { id: string; type: "reverse" }
  | { id: string; type: "skip"; count: number }
  | { id: string; type: "flush"; reason: FlushReason };

export type QueuedEffect = PendingEffect | AutomaticEffect;
export type FlushReason =
  "eight-cut" | "spade-three" | "joker-pair" | "rokurokubi" | "ambulance" | "skip-cycle" | "passes";

export interface EffectBatch {
  actorId: PlayerId;
  playId: string;
  effects: QueuedEffect[];
  nextEffectIndex: number;
  skipCount: number;
  flushReason: FlushReason | null;
}

export interface GameLogEntry {
  id: string;
  type: string;
  playerIds: PlayerId[];
  detail: string;
}

export interface GameState {
  id: string;
  version: number;
  phase: GamePhase;
  mode: GameMode;
  blindCount: number;
  players: PlayerState[];
  deck: Card[];
  turnPlayerId: PlayerId | null;
  direction: 1 | -1;
  revolution: boolean;
  jackBack: boolean;
  binding: Suit[];
  pile: PlayedGroup | null;
  trickHistory: PlayedGroup[];
  discard: Card[];
  lastPlayerId: PlayerId | null;
  passedSincePlay: PlayerId[];
  firstPlay: boolean;
  pendingEffect: PendingEffect | null;
  effectBatch: EffectBatch | null;
  nextFinishRank: number;
  appliedActionIds: string[];
  log: GameLogEntry[];
}

export interface CreateGameOptions {
  mode?: GameMode;
  blindCount?: number;
  rng?: () => number;
  gameId?: string;
}

interface CommandBase {
  actionId: string;
  expectedVersion: number;
  playerId: PlayerId;
}

export interface PlayCommand extends CommandBase {
  type: "play";
  cardIds: CardId[];
  jokerMimics?: JokerMimic[];
  blindConfirmed?: boolean;
}

export interface PassCommand extends CommandBase {
  type: "pass";
}

export interface CardTransferSelection {
  playerId: PlayerId;
  cardIds: CardId[];
}

export type EffectSelection =
  | { type: "recover"; cardIds: CardId[] }
  | { type: "steal"; transfers: CardTransferSelection[] }
  | { type: "give"; transfers: CardTransferSelection[] }
  | { type: "discard"; cardIds: CardId[] }
  | { type: "bomb"; ranks: PhysicalRank[] };

export interface ResolveEffectCommand extends CommandBase {
  type: "resolve-effect";
  effectId: string;
  selection: EffectSelection;
}

export interface DisqualifyCommand extends CommandBase {
  type: "disqualify";
  reason: "blind-failure" | "disconnect" | "exit" | "moderation";
}

export interface TimeoutCommand extends CommandBase {
  type: "timeout";
}

export type GameCommand =
  PlayCommand | PassCommand | ResolveEffectCommand | DisqualifyCommand | TimeoutCommand;

export interface RuleError {
  code:
    | "BAD_VERSION"
    | "DUPLICATE_CARD"
    | "EFFECT_PENDING"
    | "FORBIDDEN_FINISH"
    | "INVALID_EFFECT"
    | "INVALID_PLAY"
    | "INVALID_SELECTION"
    | "NOT_ACTIVE"
    | "NOT_YOUR_TURN"
    | "PASS_NOT_ALLOWED"
    | "UNKNOWN_CARD"
    | "UNKNOWN_PLAYER";
  message: string;
}

export type GameEvent =
  | { type: "played"; playerId: PlayerId; play: PlayedGroup }
  | { type: "passed"; playerId: PlayerId }
  | { type: "effect-pending"; effect: PendingEffect }
  | { type: "trick-flushed"; reason: FlushReason }
  | { type: "finished"; playerIds: PlayerId[]; rank: number }
  | { type: "disqualified"; playerId: PlayerId; rank: number }
  | { type: "game-finished" };

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; error: RuleError };

export interface Viewer {
  playerId?: PlayerId;
  spectator?: boolean;
}

export interface ProjectedHandCard {
  id: CardId;
  blind: boolean;
  position: number;
  face?: { suit: Suit | null; rank: PhysicalRank };
}

export interface ProjectedPlayer extends Omit<PlayerState, "hand"> {
  hand: ProjectedHandCard[];
}

export interface ProjectedGameState extends Omit<
  GameState,
  "players" | "deck" | "effectBatch" | "appliedActionIds"
> {
  players: ProjectedPlayer[];
  deckCount: number;
}
