import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardView, EffectNotice, PendingEffectView, Rank, RoomView, Suit } from "../app/model";
import {
  loadPersonalSettings,
  savePersonalSettings,
  type AutoPassDelayMode,
  type PersonalSettings,
} from "../app/browserStorage";
import { useUiStore } from "../app/store";
import { AccessibleHand } from "../accessibility/AccessibleHand";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { PersonalSettingsDialog } from "../components/PersonalSettingsDialog";
import { playersAtTable, SalonScene, type FreeRoamPose } from "../game-3d/SalonScene";
import type { VrPanelModel } from "../game-3d/WebXrControls";
import { EffectPanel } from "./EffectPanel";
import { feedback, primeFeedback } from "../components/feedback";
import { emoteCue, spectatorPoseCue } from "../network/peerCues";
import { usePeerCues } from "../network/usePeerCues";
import { JokerDeclarationPanel } from "./JokerDeclarationPanel";
import {
  analyzeCardSelection,
  compactCardLabel,
  selectableCardIds,
  sortHandWeakToStrong,
} from "../gameplay/cardPresentation";
import { CommentDanmaku } from "./CommentDanmaku";
import {
  cardMotionPerspectiveChanged,
  deriveCardMotions,
  sortCardsForCollectRack,
  type CardMotionEvent,
} from "../game-3d/cardMotion";
import {
  canonicalPoseMapToView,
  tablePerspectiveRotation,
  viewPoseToCanonical,
} from "../game-3d/spectatorCoordinates";

const suitLabel = {
  spade: "スペード",
  heart: "ハート",
  diamond: "ダイヤ",
  club: "クラブ",
} as const;
const noPlayableCards = new Set<string>();
const vrBomberRanks: Rank[] = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
  "Joker" as Rank,
];

export function formatEffectNotice(
  notice: EffectNotice,
  viewerId: string,
  players: RoomView["players"],
): string {
  const name = (playerId: string) =>
    players.find((player) => player.id === playerId)?.name ?? "プレイヤー";
  const actorName = name(notice.actorId);
  switch (notice.kind) {
    case "steal":
      if (notice.actorId === viewerId)
        return `A奪い！ ${name(notice.targetId)}からカードを${notice.cardCount}枚奪った！`;
      if (notice.targetId === viewerId)
        return `A奪いで${actorName}にカードを${notice.cardCount}枚奪われた！`;
      return `${actorName}が${name(notice.targetId)}からカードを${notice.cardCount}枚奪った！`;
    case "give":
      if (notice.targetId === viewerId)
        return `7渡し！ ${actorName}からカードを${notice.cardCount}枚受け取った！`;
      if (notice.actorId === viewerId)
        return `7渡し！ ${name(notice.targetId)}にカードを${notice.cardCount}枚渡した！`;
      return `${name(notice.targetId)}が${actorName}からカードを${notice.cardCount}枚受け取った！`;
    case "discard":
      return `${notice.actorId === viewerId ? "10捨て！" : `${actorName}の10捨て！`} カードを${notice.cardCount}枚捨てた！${notice.cardLabels?.length ? `（${notice.cardLabels.join("・")}）` : ""}`;
    case "collect":
      return `${notice.actorId === viewerId ? "K回収！" : `${actorName}のK回収！`} カードを${notice.cardCount}枚回収した！${notice.cardLabels?.length ? `（${notice.cardLabels.join("・")}）` : ""}`;
    case "bomber": {
      const viewerLoss = notice.losses?.find((loss) => loss.playerId === viewerId)?.cardCount;
      const lossDetail = viewerLoss
        ? ` あなたは${viewerLoss}枚失った！`
        : notice.losses?.length
          ? `（${notice.losses.map((loss) => `${name(loss.playerId)} ${loss.cardCount}枚`).join("、")}）`
          : "";
      return `${notice.actorId === viewerId ? "Qボンバー！" : `${actorName}のQボンバー！`} ${notice.ranks.join("・")}を${notice.cardCount}枚捨てた！${lossDetail}`;
    }
  }
}

const emotePresentation = {
  applause: { symbol: "👏", label: "拍手" },
  surprise: { symbol: "！", label: "びっくり" },
  thinking: { symbol: "…", label: "考え中" },
} as const;

function jokerCandidateKey(candidate: { cardId: string; suit: Suit; rank: Rank }[]): string {
  return [...candidate]
    .sort((left, right) => left.cardId.localeCompare(right.cardId))
    .map(({ cardId, suit, rank }) => `${cardId}:${suit}:${rank}`)
    .join("|");
}

export function useCountdown(deadline?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    let timer: number | undefined;
    const update = () => {
      const current = Date.now();
      setNow(current);
      const remaining = deadline - current;
      if (remaining <= 0) return;

      const untilNextDisplayedSecond = remaining % 1000 || 1000;
      timer = window.setTimeout(update, Math.min(1000, untilNextDisplayedSecond + 16));
    };
    update();
    return () => window.clearTimeout(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

export function canOpenPlayConfirmation(
  selectionComplete: boolean,
  myTurn: boolean,
  readOnly: boolean,
  hasActiveEffect: boolean,
): boolean {
  return selectionComplete && myTurn && !readOnly && !hasActiveEffect;
}

export function canShowPlayControls(
  readOnly: boolean,
  dealing: boolean,
  hasDirectEffect: boolean,
  logOpen: boolean,
): boolean {
  return !readOnly && !dealing && !hasDirectEffect && !logOpen;
}

export function canRequestSpectatorFocus(
  busy: boolean,
  currentPlayerId: string | undefined,
  targetPlayerId: string,
): boolean {
  return !busy && currentPlayerId !== targetPlayerId;
}

export function canShowLogControls(hasBlockingEffect: boolean): boolean {
  return !hasBlockingEffect;
}

export function autoPassDelayMs(
  mode: AutoPassDelayMode,
  random: () => number = Math.random,
): number {
  if (mode === "instant") return 0;
  return Math.min(5000, Math.floor(Math.max(0, random()) * 5001));
}

export function canAutoPass({
  enabled,
  myTurn,
  readOnly,
  busy,
  dealing,
  playBlocked,
  connected,
  roomPhase,
  handCount,
  playableCardCount,
}: {
  enabled: boolean;
  myTurn: boolean;
  readOnly: boolean;
  busy: boolean;
  dealing: boolean;
  playBlocked: boolean;
  connected: boolean;
  roomPhase: RoomView["phase"];
  handCount: number;
  playableCardCount: number;
}): boolean {
  return (
    enabled &&
    myTurn &&
    !readOnly &&
    !busy &&
    !dealing &&
    !playBlocked &&
    connected &&
    roomPhase === "playing" &&
    handCount > 0 &&
    playableCardCount === 0
  );
}

export function useAutoPass({
  eligible,
  turnKey,
  delayMode,
  submitPass,
  random = Math.random,
}: {
  eligible: boolean;
  turnKey: string | undefined;
  delayMode: AutoPassDelayMode;
  submitPass: () => Promise<boolean>;
  random?: () => number;
}): {
  schedule: { turnKey: string; dueAt: number } | undefined;
  markHandled: () => void;
} {
  const submitRef = useRef(submitPass);
  submitRef.current = submitPass;
  const randomRef = useRef(random);
  randomRef.current = random;
  const activeTurnRef = useRef(turnKey);
  activeTurnRef.current = turnKey;
  const attemptedTurn = useRef<string | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const [schedule, setSchedule] = useState<{ turnKey: string; dueAt: number }>();

  const markHandled = () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (activeTurnRef.current) attemptedTurn.current = activeTurnRef.current;
    setSchedule(undefined);
  };

  useEffect(() => {
    if (!eligible || !turnKey || attemptedTurn.current === turnKey) {
      setSchedule(undefined);
      return;
    }

    const delay = autoPassDelayMs(delayMode, randomRef.current);
    if (delay === 0) {
      attemptedTurn.current = turnKey;
      setSchedule(undefined);
      void submitRef.current();
      return;
    }

    const dueAt = Date.now() + delay;
    setSchedule({ turnKey, dueAt });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      if (activeTurnRef.current !== turnKey) return;
      attemptedTurn.current = turnKey;
      setSchedule((current) => (current?.turnKey === turnKey ? undefined : current));
      void submitRef.current();
    }, delay);

    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [delayMode, eligible, turnKey]);

  return { schedule, markHandled };
}

export function playersForDisplay(
  players: RoomView["players"],
  role: RoomView["role"],
  viewerId: string,
): RoomView["players"] {
  // Player projections stay seat-relative. Spectators keep the authority seat
  // order so changing focus moves the camera around the table instead of
  // teleporting every seated player into a newly rotated array.
  if (role !== "player") return players;
  const viewerIndex = players.findIndex((player) => player.id === viewerId);
  return viewerIndex > 0
    ? [...players.slice(viewerIndex), ...players.slice(0, viewerIndex)]
    : players;
}

export function PlayDialog({
  cards,
  candidates,
  close,
  submit,
  busy,
}: {
  cards: CardView[];
  candidates: { cardId: string; suit: Suit; rank: Rank }[][];
  close: () => void;
  submit: (mimics: { cardId: string; suit: Suit; rank: Rank }[]) => void;
  busy: boolean;
}) {
  const jokers = cards.filter((card) => card.visibility === "face" && Boolean(card.joker));
  const [candidateKey, setCandidateKey] = useState(() =>
    candidates[0] ? jokerCandidateKey(candidates[0]) : "",
  );
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const needsDeclaration = candidates.some((candidate) => candidate.length > 0);
  const needsDeclarationChoice = needsDeclaration && candidates.length > 1;
  const chosenCandidate = needsDeclaration
    ? (candidates.find((candidate) => jokerCandidateKey(candidate) === candidateKey) ??
      candidates[0])
    : [];
  const jokerName = (cardId: string, jokerIndex: number) => {
    const joker = jokers.find((card) => card.id === cardId);
    return joker?.visibility === "face" && joker.joker === "crimson"
      ? "JOKERⅡ"
      : joker?.visibility === "face" && joker.joker === "monochrome"
        ? "JOKERⅠ"
        : `Joker ${jokerIndex + 1}`;
  };
  const ready = !needsDeclaration || Boolean(chosenCandidate);
  useEffect(() => {
    document.body.classList.add("modal-open");
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        ),
      ];
      const first = nodes[0],
        last = nodes.at(-1);
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", keydown);
    return () => {
      document.body.classList.remove("modal-open");
      removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="play-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-title"
      >
        <h2 id="play-title">
          {cards.some((card) => card.visibility === "hidden")
            ? "ブラインド札を出しますか？"
            : "選んだ札を出しますか？"}
        </h2>
        {cards.some((card) => card.visibility === "hidden") && (
          <p className="danger-note">中身が場に対して不正なら即失格になります。</p>
        )}
        {needsDeclarationChoice && (
          <fieldset className="joker-direct-choice">
            <legend>Jokerの擬態（合法候補のみ）</legend>
            <div className="joker-candidate-buttons" role="radiogroup" aria-label="Jokerの擬態">
              {candidates.map((candidate) => (
                <label key={jokerCandidateKey(candidate)}>
                  <input
                    type="radio"
                    name="play-joker-candidate"
                    disabled={busy}
                    checked={
                      jokerCandidateKey(chosenCandidate ?? []) === jokerCandidateKey(candidate)
                    }
                    onChange={() => setCandidateKey(jokerCandidateKey(candidate))}
                  />
                  <span>
                    {candidate
                      .map(
                        (declaration, jokerIndex) =>
                          `${jokerName(declaration.cardId, jokerIndex)}: ${suitLabel[declaration.suit]} ${declaration.rank}`,
                      )
                      .join(" / ")}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            選び直す
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready || busy}
            onClick={() => submit(chosenCandidate ?? [])}
          >
            {busy ? "提出中…" : "この札を出す"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ChatPanel({
  room,
  sendChat,
}: {
  room: RoomView;
  sendChat: (message: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [visiblePages, setVisiblePages] = useState(1);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim() || sending) return;
    const draft = message;
    setSending(true);
    try {
      if (await sendChat(draft.trim().slice(0, 120))) {
        setMessage((current) => (current === draft ? "" : current));
      }
    } finally {
      setSending(false);
    }
  };
  const allEntries = [
    ...room.log.map((item) => ({ ...item, label: "対局" })),
    ...(room.chat ?? []).map((item) => ({
      id: item.id,
      atMs: item.atMs,
      text: item.text,
      kind: "system" as const,
      label: `${item.name}（${item.role === "spectator" ? "観戦" : "参加"}）`,
    })),
  ].sort((left, right) => left.atMs - right.atMs);
  const entries = allEntries.slice(-60 * visiblePages);
  return (
    <section className="chat-panel" aria-labelledby="log-title">
      <h2 id="log-title">ログ／チャット</h2>
      {entries.length < allEntries.length && (
        <button type="button" onClick={() => setVisiblePages((pages) => pages + 1)}>
          古いログをさらに60件表示
        </button>
      )}
      <ol>
        {entries.map((item) => (
          <li key={`${item.label}-${item.id}`}>
            <time>
              {new Date(item.atMs).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <strong>{item.label}</strong> {item.text}
          </li>
        ))}
      </ol>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-message">
          チャット
        </label>
        <input
          id="chat-message"
          maxLength={120}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && composing) event.preventDefault();
          }}
          placeholder="メッセージ"
        />
        <button type="submit" disabled={sending || !message.trim()}>
          {sending ? "送信中…" : "送信"}
        </button>
      </form>
    </section>
  );
}

export function DirectEffectControls({
  effect,
  room,
  selectedIds,
  targets,
  pendingGiveCardId,
  busy,
  chooseTarget,
  clear,
  confirm,
}: {
  effect: PendingEffectView;
  room: RoomView;
  selectedIds: string[];
  targets: Record<string, string>;
  pendingGiveCardId?: string | undefined;
  busy: boolean;
  chooseTarget: (playerId: string) => void;
  clear: () => void;
  confirm: () => void;
}) {
  const title = {
    steal: "A奪い",
    give: "7渡し",
    discard: "10捨て",
    collect: "K回収",
    bomber: "Qボンバー",
    clearField: "場流し",
  }[effect.kind];
  const targetPlayerIds = eligibleEffectTargetPlayerIds(room, effect.eligiblePlayerIds);
  const targetPlayers = room.players.filter((player) => targetPlayerIds.has(player.id));
  const assigned = selectedIds.every((cardId) => targetPlayerIds.has(targets[cardId] ?? ""));
  const cardsStillEligible = selectedIds.every(
    (cardId) => !effect.eligibleCardIds || effect.eligibleCardIds.includes(cardId),
  );
  const ready =
    selectedIds.length === effect.requiredCount &&
    cardsStillEligible &&
    (!effect.kind.match(/^(steal|give)$/) || assigned);
  const guidance =
    effect.kind === "steal"
      ? "相手の席にある裏向きのカードを直接タップ"
      : effect.kind === "collect"
        ? "空中に並んだ回収札を直接タップ"
        : effect.kind === "discard"
          ? "捨てる手札を直接タップ"
          : pendingGiveCardId
            ? "選んだカードを相手のキャラクターまでドラッグ"
            : "渡すカードを相手のキャラクターまでドラッグ";
  return (
    <section className="direct-effect-controls" aria-labelledby="direct-effect-title">
      <div>
        <strong id="direct-effect-title">{title}</strong>
        <span>{guidance}</span>
        <output>
          {selectedIds.length}/{effect.requiredCount}枚
        </output>
      </div>
      {effect.kind === "give" && pendingGiveCardId && (
        <div className="direct-effect-targets" aria-label="渡す相手">
          {targetPlayers.map((player) => (
            <button type="button" key={player.id} onClick={() => chooseTarget(player.id)}>
              {player.name}へ
            </button>
          ))}
        </div>
      )}
      {effect.kind === "give" && Object.keys(targets).length > 0 && (
        <div className="direct-effect-assignments" aria-label="7渡しの割り当て">
          {selectedIds.flatMap((cardId) => {
            const target = room.players.find((player) => player.id === targets[cardId]);
            const card = room.hand.find((item) => item.id === cardId);
            return target && card
              ? [
                  <span key={cardId}>
                    {compactCardLabel(card)} → {target.name}
                  </span>,
                ]
              : [];
          })}
        </div>
      )}
      <footer>
        <button type="button" disabled={!selectedIds.length || busy} onClick={clear}>
          選び直す
        </button>
        <button type="button" className="primary" disabled={!ready || busy} onClick={confirm}>
          {busy ? "確定中…" : `${title}を確定`}
        </button>
      </footer>
    </section>
  );
}

export function eligibleEffectTargetPlayerIds(
  room: RoomView,
  eligiblePlayerIds?: readonly string[],
): Set<string> {
  const explicitlyEligible = eligiblePlayerIds ? new Set(eligiblePlayerIds) : undefined;
  return new Set(
    room.players
      .filter(
        (player) =>
          player.id !== room.viewerId &&
          player.status === "active" &&
          (!explicitlyEligible || explicitlyEligible.has(player.id)),
      )
      .map((player) => player.id),
  );
}

export function selectableEffectCardIds(
  eligibleCardIds: readonly string[] | undefined,
  effectKind: PendingEffectView["kind"] | undefined,
  movingToDiscard: ReadonlySet<string>,
): Set<string> {
  return new Set(
    (eligibleCardIds ?? []).filter(
      (cardId) => effectKind !== "collect" || !movingToDiscard.has(cardId),
    ),
  );
}

export function shouldKeepOwnHandBright(
  effectKind: PendingEffectView["kind"] | undefined,
): boolean {
  return effectKind === "bomber" || effectKind === "collect";
}

export function GameScreen({
  room,
  connection,
  lowPower,
  reducedMotion,
  busy,
  error,
  dealing,
  skipDeal,
  finishing = false,
  finishPresentation = () => undefined,
  leave,
  command,
}: {
  room: RoomView;
  connection: "connecting" | "connected" | "reconnecting" | "grace" | "offline";
  lowPower: boolean;
  reducedMotion: boolean;
  busy: boolean;
  error?: string | undefined;
  dealing: boolean;
  skipDeal: () => void;
  finishing?: boolean;
  finishPresentation?: () => void;
  leave: () => void;
  command: (name: string, payload?: Record<string, unknown>) => Promise<boolean>;
}) {
  const selectedIds = useUiStore((state) => state.selectedCardIds);
  const toggleCard = useUiStore((state) => state.toggleCard);
  const clearSelection = useUiStore((state) => state.clearSelection);
  const logOpen = useUiStore((state) => state.logOpen);
  const setSettings = useUiStore((state) => state.setSettings);
  const muted = useUiStore((state) => state.soundMuted);
  const [playDialog, setPlayDialog] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [cardMotions, setCardMotions] = useState<CardMotionEvent[]>([]);
  const [effectCardIds, setEffectCardIds] = useState<string[]>([]);
  const [effectTargets, setEffectTargets] = useState<Record<string, string>>({});
  const [pendingGiveCardId, setPendingGiveCardId] = useState<string>();
  const [vrSelectedBomberRanks, setVrSelectedBomberRanks] = useState<Rank[]>([]);
  const [vrJokerCandidateIndex, setVrJokerCandidateIndex] = useState(0);
  const [spectatorMode, setSpectatorMode] = useState<"follow" | "free">("follow");
  const [personalSettings, setPersonalSettings] = useState(loadPersonalSettings);
  const [personalSettingsOpen, setPersonalSettingsOpen] = useState(false);
  const [reactionControlsOpen, setReactionControlsOpen] = useState(false);
  const [effectNoticeQueue, setEffectNoticeQueue] = useState<
    Array<{ id: string; message: string }>
  >([]);
  const [reactionNoticeQueue, setReactionNoticeQueue] = useState<
    Array<{ id: string; symbol: string; message: string }>
  >([]);
  const knownEffectNoticeIds = useRef(
    new Set(room.log.filter((entry) => entry.notice).map((entry) => entry.id)),
  );
  const knownReactionIds = useRef(new Set<string>());
  const effectNoticeProcessedRevision = useRef(room.revision);
  const autoJokerDeclaration = useRef<string | undefined>(undefined);
  const playSubmissionPending = useRef(false);
  const passSubmissionPending = useRef(false);
  const previousRoom = useRef<RoomView | undefined>(undefined);
  const cardMotionProcessedRevision = useRef(room.revision);
  const finishPresentationStartedAt = useRef<number | undefined>(undefined);
  const finishPresentationDone = useRef(false);
  const finishPresentationCallback = useRef(finishPresentation);
  finishPresentationCallback.current = finishPresentation;
  const seconds = useCountdown(room.turnDeadlineMs);
  const me = room.players.find((player) => player.id === room.viewerId);
  const presentPlayers = useMemo(() => playersAtTable(room.players), [room.players]);
  const spectatorFocusId =
    room.players.find((player) => player.id === room.focusedPlayerId && player.status === "active")
      ?.id ?? room.players.find((player) => player.status === "active")?.id;
  const peerIds = useMemo(
    () => [
      ...new Set([
        ...presentPlayers.map((player) => player.id),
        ...room.spectators.map((spectator) => spectator.id),
      ]),
    ],
    [presentPlayers, room.spectators],
  );
  const peerCues = usePeerCues(room.roomId, room.viewerId, peerIds);
  useEffect(() => {
    effectNoticeProcessedRevision.current = room.revision;
    const fresh = room.log.filter(
      (entry) => entry.notice && !knownEffectNoticeIds.current.has(entry.id),
    );
    if (!fresh.length) return;
    fresh.forEach((entry) => knownEffectNoticeIds.current.add(entry.id));
    setEffectNoticeQueue((currentQueue) => [
      ...currentQueue,
      ...fresh.map((entry) => ({
        id: entry.id,
        message: formatEffectNotice(entry.notice!, room.viewerId, room.players),
      })),
    ]);
  }, [room.log, room.players, room.revision, room.viewerId]);
  useEffect(() => {
    if (!effectNoticeQueue.length) return;
    const timer = window.setTimeout(
      () => setEffectNoticeQueue((currentQueue) => currentQueue.slice(1)),
      3800,
    );
    return () => window.clearTimeout(timer);
  }, [effectNoticeQueue]);
  useEffect(() => {
    const fresh = peerCues.recentEmotes.filter(
      ({ cue }) => !knownReactionIds.current.has(cue.eventId),
    );
    if (!fresh.length) return;
    fresh.forEach(({ cue }) => knownReactionIds.current.add(cue.eventId));
    setReactionNoticeQueue((currentQueue) =>
      [
        ...currentQueue,
        ...fresh.map(({ cue, sender }) => {
          const presentation = emotePresentation[cue.emote];
          const senderName =
            room.players.find((player) => player.id === sender)?.name ??
            room.spectators.find((spectator) => spectator.id === sender)?.name ??
            "観戦者";
          return {
            id: cue.eventId,
            symbol: presentation.symbol,
            message: `${senderName}: ${presentation.label}`,
          };
        }),
      ].slice(-3),
    );
  }, [peerCues.recentEmotes, room.players, room.spectators]);
  useEffect(() => {
    if (!reactionNoticeQueue.length) return;
    const timer = window.setTimeout(
      () => setReactionNoticeQueue((currentQueue) => currentQueue.slice(1)),
      2600,
    );
    return () => window.clearTimeout(timer);
  }, [reactionNoticeQueue]);
  const tableViewRotation = useMemo(
    () => tablePerspectiveRotation(room.players, room.role, room.viewerId),
    [room.players, room.role, room.viewerId],
  );
  const remoteSpectatorPoses = useMemo(
    () => canonicalPoseMapToView(peerCues.spectatorPoses, tableViewRotation),
    [peerCues.spectatorPoses, tableViewRotation],
  );
  const lastFreeRoamPose = useRef<FreeRoamPose | undefined>(undefined);
  const publishFreeRoamPose = useCallback(
    (pose: FreeRoamPose) => {
      const canonicalPose = viewPoseToCanonical(pose, tableViewRotation);
      lastFreeRoamPose.current = canonicalPose;
      void peerCues.send(spectatorPoseCue({ ...canonicalPose, freeSpectating: true }));
    },
    [peerCues.send, tableViewRotation],
  );
  useEffect(() => {
    if (room.role !== "spectator" || spectatorMode !== "free") return;
    return () => {
      const pose = lastFreeRoamPose.current;
      if (!pose) return;
      void peerCues.send(spectatorPoseCue({ ...pose, moving: false, freeSpectating: false }));
    };
  }, [peerCues.send, room.role, spectatorMode]);
  const current = room.players.find((player) => player.id === room.currentPlayerId);
  const myTurn = room.currentPlayerId === room.viewerId;
  const readOnly = finishing || room.role === "spectator" || me?.status !== "active";
  const canManageTable = Boolean(
    !finishing && me && me.status !== "disqualified" && room.hostId === room.viewerId,
  );
  const orderedHand = useMemo(
    () => (personalSettings.autoSortHand ? sortHandWeakToStrong(room.hand) : room.hand),
    [personalSettings.autoSortHand, room.hand],
  );
  const selectedCards = orderedHand.filter((card) => selectedIds.includes(card.id));
  const selection = useMemo(() => analyzeCardSelection(room, selectedIds), [room, selectedIds]);
  const playableIds = useMemo(
    () => (!readOnly ? selectableCardIds(room, selectedIds) : undefined),
    [readOnly, room, selectedIds],
  );
  const initiallyPlayableIds = useMemo(
    () => (!readOnly ? selectableCardIds(room, []) : undefined),
    [readOnly, room],
  );
  const autoPassTurn = useRef({ currentPlayerId: room.currentPlayerId, sequence: 0 });
  if (autoPassTurn.current.currentPlayerId !== room.currentPlayerId) {
    autoPassTurn.current = {
      currentPlayerId: room.currentPlayerId,
      sequence: autoPassTurn.current.sequence + 1,
    };
  }
  const autoPassTurnKey = myTurn
    ? `${room.gameId ?? room.generation}:${autoPassTurn.current.sequence}:${room.trickId ?? "field"}`
    : undefined;
  const displayRoom = useMemo(() => {
    const players = playersForDisplay(room.players, room.role, room.viewerId);
    return {
      ...room,
      players,
      hand: orderedHand,
      ...(room.role === "spectator" && spectatorMode === "follow" && spectatorFocusId
        ? { focusedPlayerId: spectatorFocusId }
        : {}),
    };
  }, [orderedHand, room, spectatorFocusId, spectatorMode]);
  const selectionHint = useMemo(() => {
    if (!selectedCards.length) return "出す札を選んでください";
    if (!selection.completable) return "この組み合わせでは出せません。札を選び直してください";
    if (!selection.complete)
      return "成立する同ランク組または同一スートの階段になる札を続けて選んでください";
    if (selectedCards.some((card) => card.visibility === "hidden"))
      return "ブラインド札は部屋ホストが中身を検証します";
    if (
      selectedCards.some((card) => card.visibility === "face" && card.joker) &&
      selection.jokerCandidates.length > 1
    )
      return "確認画面で、場の条件に合うJokerのスートとランクを選べます";
    return "この組み合わせで出せます";
  }, [selectedCards, selection]);
  const activeEffect = room.pendingEffects.find(
    (effect) => effect.actorId === room.viewerId && effect.kind !== "clearField",
  );
  const logBlocked = Boolean(
    room.pendingEffects.some((effect) => effect.kind !== "clearField") || room.pendingJokerMimic,
  );
  const directEffect =
    activeEffect && ["steal", "give", "discard", "collect"].includes(activeEffect.kind)
      ? (activeEffect as PendingEffectView & {
          kind: "steal" | "give" | "discard" | "collect";
        })
      : undefined;
  useEffect(() => {
    setVrSelectedBomberRanks([]);
  }, [activeEffect?.id]);
  const playBlocked = Boolean(activeEffect || room.pendingJokerMimic);
  const effectCardEligibility = directEffect?.eligibleCardIds?.join("\0") ?? "";
  const effectPlayerEligibility = directEffect?.eligiblePlayerIds?.join("\0") ?? "";
  const effectHasPlayerEligibility = directEffect?.eligiblePlayerIds !== undefined;
  const directEffectKind = directEffect?.kind;
  const directEffectRequiredCount = directEffect?.requiredCount ?? 0;
  const movingToDiscardIds = useMemo(
    () =>
      new Set(
        cardMotions
          .filter((motion) => motion.to.kind === "discard")
          .map((motion) => motion.card.id),
      ),
    [cardMotions],
  );
  const effectSelectableIds = useMemo(
    () =>
      selectableEffectCardIds(
        effectCardEligibility ? effectCardEligibility.split("\0") : [],
        directEffectKind,
        movingToDiscardIds,
      ),
    [directEffectKind, effectCardEligibility, movingToDiscardIds],
  );
  const effectTargetPlayerIds = useMemo(
    () =>
      eligibleEffectTargetPlayerIds(
        room,
        effectHasPlayerEligibility
          ? effectPlayerEligibility
            ? effectPlayerEligibility.split("\0")
            : []
          : undefined,
      ),
    [effectHasPlayerEligibility, effectPlayerEligibility, room.players, room.viewerId],
  );
  const effectEligibleCards = useMemo(() => {
    if (!directEffect) return [];
    const source =
      directEffect.kind === "collect"
        ? sortCardsForCollectRack(room.discard)
        : directEffect.kind === "steal"
          ? room.players
              .filter((player) => player.id !== room.viewerId)
              .flatMap((player) => player.cards ?? [])
          : orderedHand;
    return source.filter((card) => effectSelectableIds.has(card.id));
  }, [directEffect, effectSelectableIds, orderedHand, room.discard, room.players, room.viewerId]);
  const payloadBase = useMemo(
    () => ({ roomId: room.roomId, gameId: room.gameId, expectedRevision: room.revision }),
    [room.gameId, room.revision, room.roomId],
  );
  useEffect(() => {
    setEffectCardIds([]);
    setEffectTargets({});
    setPendingGiveCardId(undefined);
    if (directEffect) clearSelection();
  }, [clearSelection, directEffect?.id]);
  useEffect(() => {
    if (playDialog && !canOpenPlayConfirmation(selection.complete, myTurn, readOnly, playBlocked)) {
      setPlayDialog(false);
    }
  }, [myTurn, playBlocked, playDialog, readOnly, selection.complete]);
  useEffect(() => {
    if (logBlocked && logOpen) setSettings({ logOpen: false });
  }, [logBlocked, logOpen, setSettings]);
  useEffect(() => {
    if (!directEffectKind) return;
    setEffectCardIds((ids) => {
      const next = ids
        .filter((id) => effectSelectableIds.has(id))
        .slice(0, directEffectRequiredCount);
      return next.length === ids.length && next.every((id, index) => id === ids[index])
        ? ids
        : next;
    });
    setEffectTargets((targets) => {
      const next = Object.fromEntries(
        Object.entries(targets).filter(
          ([cardId, playerId]) =>
            effectSelectableIds.has(cardId) &&
            (!directEffectKind.match(/^(steal|give)$/) || effectTargetPlayerIds.has(playerId)),
        ),
      );
      return Object.keys(next).length === Object.keys(targets).length ? targets : next;
    });
    setPendingGiveCardId((cardId) =>
      cardId && effectSelectableIds.has(cardId) ? cardId : undefined,
    );
  }, [directEffectKind, directEffectRequiredCount, effectSelectableIds, effectTargetPlayerIds]);
  useEffect(() => {
    const pending = room.pendingJokerMimic;
    if (!pending || pending.candidates.length !== 1 || busy) return;
    const key = `${room.revision}:${pending.cardIds.join(",")}`;
    if (autoJokerDeclaration.current === key) return;
    autoJokerDeclaration.current = key;
    void (async () => {
      const accepted = await command("declareJokerMimic", {
        ...payloadBase,
        mimics: pending.candidates[0],
        blindConfirmed: true,
      });
      if (!accepted && autoJokerDeclaration.current === key) {
        autoJokerDeclaration.current = undefined;
      }
    })();
  }, [busy, command, payloadBase, room.pendingJokerMimic, room.revision]);
  const openPlay = () => {
    if (busy || !canOpenPlayConfirmation(selection.complete, myTurn, readOnly, playBlocked)) return;
    setPlayDialog(true);
  };
  const selectCard = (card: CardView) => {
    if (busy) return;
    if (!selectedIds.includes(card.id) && playableIds && !playableIds.has(card.id)) return;
    primeFeedback(muted);
    toggleCard(card);
    feedback("select", muted);
  };
  const toggleEffectCard = (card: CardView, ownerId?: string) => {
    if (busy || !directEffect || !effectSelectableIds.has(card.id)) return;
    primeFeedback(muted);
    if (effectCardIds.includes(card.id)) {
      setEffectCardIds((ids) => ids.filter((id) => id !== card.id));
      setEffectTargets((targets) => {
        const next = { ...targets };
        delete next[card.id];
        return next;
      });
      if (pendingGiveCardId === card.id) setPendingGiveCardId(undefined);
    } else if (effectCardIds.length < directEffect.requiredCount) {
      setEffectCardIds((ids) => [...ids, card.id]);
      if (directEffect.kind === "steal" && ownerId) {
        setEffectTargets((targets) => ({ ...targets, [card.id]: ownerId }));
      }
      if (directEffect.kind === "give") setPendingGiveCardId(card.id);
    }
    feedback("select", muted);
  };
  const chooseEffectTarget = (playerId: string) => {
    if (
      busy ||
      directEffect?.kind !== "give" ||
      !pendingGiveCardId ||
      !effectTargetPlayerIds.has(playerId)
    )
      return;
    setEffectTargets((targets) => ({ ...targets, [pendingGiveCardId]: playerId }));
    setPendingGiveCardId(undefined);
    feedback("select", muted);
  };
  const dropGiveCard = (card: CardView, playerId: string) => {
    if (
      busy ||
      directEffect?.kind !== "give" ||
      !effectSelectableIds.has(card.id) ||
      !effectTargetPlayerIds.has(playerId) ||
      (!effectCardIds.includes(card.id) && effectCardIds.length >= directEffect.requiredCount)
    )
      return;
    setEffectCardIds((ids) => (ids.includes(card.id) ? ids : [...ids, card.id]));
    setEffectTargets((targets) => ({ ...targets, [card.id]: playerId }));
    setPendingGiveCardId(undefined);
    feedback("select", muted);
  };
  const returnGiveCard = (card: CardView) => {
    if (busy || directEffect?.kind !== "give" || !effectTargets[card.id]) return;
    setEffectCardIds((ids) => ids.filter((id) => id !== card.id));
    setEffectTargets((targets) => {
      const next = { ...targets };
      delete next[card.id];
      return next;
    });
    if (pendingGiveCardId === card.id) setPendingGiveCardId(undefined);
    feedback("select", muted);
  };
  const previousTurn = useRef(room.currentPlayerId);
  const previousTrick = useRef(room.trickId);
  useEffect(() => {
    const previous = previousRoom.current;
    previousRoom.current = room;
    cardMotionProcessedRevision.current = room.revision;
    if (!previous) return;
    if (cardMotionPerspectiveChanged(previous, room)) {
      setCardMotions([]);
      return;
    }
    setCardMotions((currentMotions) => {
      const movingToDiscard = new Set(
        currentMotions
          .filter((motion) => motion.to.kind === "discard")
          .map((motion) => motion.card.id),
      );
      const next = deriveCardMotions(previous, room, movingToDiscard);
      if (next.length) {
        const known = new Set(currentMotions.map((motion) => motion.id));
        return [...currentMotions, ...next.filter((motion) => !known.has(motion.id))];
      }
      return currentMotions;
    });
  }, [room]);
  useEffect(() => {
    if (dealing || (room.role === "spectator" && spectatorMode === "free")) {
      setCardMotions([]);
    }
  }, [dealing, room.role, spectatorMode]);
  useEffect(() => {
    if (!finishing) {
      finishPresentationStartedAt.current = undefined;
      finishPresentationDone.current = false;
      return;
    }
    finishPresentationStartedAt.current ??= Date.now();
    const elapsed = Date.now() - finishPresentationStartedAt.current;
    const finishingRevisionIngested =
      cardMotionProcessedRevision.current === room.revision &&
      effectNoticeProcessedRevision.current === room.revision;
    const presentationComplete =
      finishingRevisionIngested && cardMotions.length === 0 && effectNoticeQueue.length === 0;
    const settleMs = lowPower || reducedMotion ? 120 : 650;
    const hardTimeoutMs = 20_000;
    const remaining = Math.max(0, hardTimeoutMs - elapsed);
    const delay = presentationComplete ? Math.min(settleMs, remaining) : remaining;
    const timer = window.setTimeout(() => {
      if (finishPresentationDone.current) return;
      finishPresentationDone.current = true;
      finishPresentationCallback.current();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    cardMotions.length,
    effectNoticeQueue.length,
    finishing,
    lowPower,
    reducedMotion,
    room.revision,
  ]);
  useEffect(() => {
    if (previousTurn.current !== room.currentPlayerId) {
      feedback("turn", muted);
      previousTurn.current = room.currentPlayerId;
    }
    if (previousTrick.current && previousTrick.current !== room.trickId) {
      feedback("flush", muted);
      previousTrick.current = room.trickId;
    }
  }, [muted, room.currentPlayerId, room.trickId]);
  useEffect(() => {
    const cancelSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !playDialog && selectedIds.length > 0) clearSelection();
    };
    window.addEventListener("keydown", cancelSelection);
    return () => window.removeEventListener("keydown", cancelSelection);
  }, [clearSelection, playDialog, selectedIds.length]);
  const submit = async (mimics: { cardId: string; suit: Suit; rank: Rank }[]) => {
    if (busy || playSubmissionPending.current) return;
    playSubmissionPending.current = true;
    try {
      if (
        await command("submitPlay", {
          ...payloadBase,
          cardIds: selectedIds,
          mimics,
          blindConfirmed: selectedCards.some((card) => card.visibility === "hidden"),
        })
      ) {
        setPlayDialog(false);
        clearSelection();
      }
    } finally {
      playSubmissionPending.current = false;
    }
  };
  const submitPass = async () => {
    if (busy || passSubmissionPending.current) return false;
    passSubmissionPending.current = true;
    try {
      const accepted = await command("submitPass", payloadBase);
      if (accepted) clearSelection();
      return accepted;
    } finally {
      passSubmissionPending.current = false;
    }
  };
  const autoPass = useAutoPass({
    eligible: canAutoPass({
      enabled: personalSettings.autoPass && room.field.length > 0,
      myTurn,
      readOnly,
      busy,
      dealing,
      playBlocked,
      connected: connection === "connected",
      roomPhase: room.phase,
      handCount: room.hand.length,
      playableCardCount: initiallyPlayableIds?.size ?? room.hand.length,
    }),
    turnKey: autoPassTurnKey,
    delayMode: personalSettings.autoPassDelay,
    submitPass,
  });
  const autoPassSeconds = useCountdown(autoPass.schedule?.dueAt);
  const pass = () => {
    autoPass.markHandled();
    return submitPass();
  };
  const changePersonalSettings = (settings: PersonalSettings) => {
    setPersonalSettings(settings);
    savePersonalSettings(settings);
  };
  const resolveEffect = (effect: PendingEffectView, payload: Record<string, unknown>) => {
    if (effect.kind === "clearField") return Promise.resolve(false);
    return command(
      (
        {
          steal: "resolveSteal",
          give: "resolveGive",
          discard: "resolveDiscard",
          bomber: "resolveBomber",
          collect: "resolveCollect",
        } as const
      )[effect.kind],
      { ...payloadBase, ...payload },
    );
  };
  const toggleVrBomberRank = (rank: Rank) => {
    if (busy || activeEffect?.kind !== "bomber") return;
    setVrSelectedBomberRanks((items) =>
      items.includes(rank)
        ? items.filter((item) => item !== rank)
        : items.length < activeEffect.requiredCount
          ? [...items, rank]
          : items,
    );
  };
  const confirmVrBomber = () => {
    if (
      activeEffect?.kind !== "bomber" ||
      vrSelectedBomberRanks.length !== activeEffect.requiredCount
    )
      return;
    void resolveEffect(activeEffect, { ranks: vrSelectedBomberRanks });
  };
  const directEffectReady = Boolean(
    directEffect &&
    effectCardIds.length === directEffect.requiredCount &&
    effectCardIds.every((cardId) => effectSelectableIds.has(cardId)) &&
    (!["steal", "give"].includes(directEffect.kind) ||
      effectCardIds.every((cardId) => effectTargetPlayerIds.has(effectTargets[cardId] ?? ""))),
  );
  const confirmDirectEffect = () => {
    if (!directEffect || !directEffectReady) return;
    const payload =
      directEffect.kind === "steal"
        ? {
            selections: effectCardIds.map((cardId) => ({
              targetUid: effectTargets[cardId],
              cardId,
            })),
          }
        : directEffect.kind === "give"
          ? {
              transfers: effectCardIds.map((cardId) => ({
                targetUid: effectTargets[cardId],
                cardId,
              })),
            }
          : { cardIds: effectCardIds };
    void resolveEffect(directEffect, payload);
  };
  const vrPlayCandidates = selection.jokerCandidates.length ? selection.jokerCandidates : [[]];
  const vrCandidateSignature = JSON.stringify([
    room.pendingJokerMimic?.candidates,
    selection.jokerCandidates,
  ]);
  useEffect(() => setVrJokerCandidateIndex(0), [vrCandidateSignature]);
  const vrMimicLabel = (candidate: { cardId: string; suit: Suit; rank: Rank }[], index: number) =>
    candidate.length
      ? candidate.map((item) => `${suitLabel[item.suit]} ${item.rank}`).join(" / ")
      : `候補 ${index + 1}`;
  const focusedSpectator = room.players.find((player) => player.id === spectatorFocusId);
  const activeSpectatorPlayers = room.players.filter((player) => player.status === "active");
  const changeVrSpectatorFocus = (offset: number) => {
    if (busy || activeSpectatorPlayers.length < 2) return;
    const currentIndex = Math.max(
      0,
      activeSpectatorPlayers.findIndex((player) => player.id === spectatorFocusId),
    );
    const target =
      activeSpectatorPlayers[
        (currentIndex + offset + activeSpectatorPlayers.length) % activeSpectatorPlayers.length
      ];
    if (!target || target.id === spectatorFocusId) return;
    setSpectatorMode("follow");
    void command("changeSpectatorFocus", { ...payloadBase, focusPlayerId: target.id });
  };
  const vrPanel: VrPanelModel = (() => {
    if (activeEffect?.kind === "bomber") {
      return {
        title: "Qボンバー",
        status: `${vrSelectedBomberRanks.length}/${activeEffect.requiredCount}ランク選択`,
        options: vrBomberRanks.map((rank) => ({
          id: `bomber-${rank}`,
          label: rank,
          enabled: !busy,
          selected: vrSelectedBomberRanks.includes(rank),
          activate: () => toggleVrBomberRank(rank),
        })),
        actions: [
          {
            id: "bomber-clear",
            label: "選択解除",
            enabled: !busy && vrSelectedBomberRanks.length > 0,
            activate: () => setVrSelectedBomberRanks([]),
          },
          {
            id: "bomber-confirm",
            label: "効果を確定",
            enabled: !busy && vrSelectedBomberRanks.length === activeEffect.requiredCount,
            tone: "primary",
            activate: confirmVrBomber,
          },
        ],
      };
    }
    const pendingJoker = room.pendingJokerMimic;
    if (pendingJoker) {
      const candidateIndex = Math.min(vrJokerCandidateIndex, pendingJoker.candidates.length - 1);
      return {
        title: "Jokerの擬態を宣言",
        status: "合法な候補から一つ選択",
        options: pendingJoker.candidates.map((candidate, index) => ({
          id: `pending-joker-${index}`,
          label: vrMimicLabel(candidate, index),
          enabled: !busy,
          selected: index === candidateIndex,
          activate: () => setVrJokerCandidateIndex(index),
        })),
        actions: [
          {
            id: "pending-joker-confirm",
            label: "擬態を確定",
            enabled: !busy && candidateIndex >= 0,
            tone: "primary",
            activate: () => {
              const candidate = pendingJoker.candidates[candidateIndex];
              if (candidate)
                void command("declareJokerMimic", {
                  ...payloadBase,
                  mimics: candidate,
                  blindConfirmed: true,
                });
            },
          },
        ],
      };
    }
    if (directEffect) {
      const effectName = {
        steal: "A奪い",
        give: "7渡し",
        discard: "10捨て",
        collect: "K回収",
      }[directEffect.kind];
      return {
        title: effectName,
        status:
          directEffect.kind === "give" && effectCardIds.some((cardId) => !effectTargets[cardId])
            ? "札を選び、渡す相手を引いて指定"
            : `${effectCardIds.length}/${directEffect.requiredCount}枚選択`,
        actions: [
          {
            id: "effect-clear",
            label: "選択解除",
            enabled: !busy && effectCardIds.length > 0,
            activate: () => {
              setEffectCardIds([]);
              setEffectTargets({});
              setPendingGiveCardId(undefined);
            },
          },
          {
            id: "effect-confirm",
            label: "効果を確定",
            enabled: !busy && directEffectReady,
            tone: "primary",
            activate: confirmDirectEffect,
          },
        ],
      };
    }
    if (room.role === "spectator") {
      return {
        title: `${focusedSpectator?.name ?? "プレイヤー"}を観戦中`,
        status: "首を動かすか、引き金で視点を切替",
        actions: [
          {
            id: "spectator-previous",
            label: "前の視点",
            enabled: !busy && activeSpectatorPlayers.length > 1,
            activate: () => changeVrSpectatorFocus(-1),
          },
          {
            id: "spectator-next",
            label: "次の視点",
            enabled: !busy && activeSpectatorPlayers.length > 1,
            activate: () => changeVrSpectatorFocus(1),
          },
        ],
      };
    }
    const playCandidateIndex = Math.min(vrJokerCandidateIndex, vrPlayCandidates.length - 1);
    return {
      title: myTurn ? "あなたの手番" : `${current?.name ?? "プレイヤー"}の手番`,
      status: myTurn ? selectionHint : "手番を待っています",
      resetKey: `${room.revision}:${selectedIds.join(",")}:${playCandidateIndex}`,
      options:
        selection.complete && vrPlayCandidates.length > 1
          ? vrPlayCandidates.map((candidate, index) => ({
              id: `play-joker-${index}`,
              label: vrMimicLabel(candidate, index),
              enabled: !busy,
              selected: index === playCandidateIndex,
              activate: () => setVrJokerCandidateIndex(index),
            }))
          : undefined,
      actions: [
        {
          id: "play",
          label: selectedCards.some((card) => card.visibility === "hidden")
            ? "ブラインド札を出す"
            : "選んだ札を出す",
          enabled: myTurn && selection.complete && !busy && !playBlocked,
          confirm: true,
          tone: selectedCards.some((card) => card.visibility === "hidden") ? "danger" : "primary",
          activate: () => {
            const candidate = vrPlayCandidates[playCandidateIndex] ?? vrPlayCandidates[0] ?? [];
            void submit(candidate);
          },
        },
        {
          id: "pass",
          label: "パス",
          enabled: myTurn && !busy && !playBlocked,
          activate: () => void pass(),
        },
      ],
    };
  })();
  const cueConnectionLabel =
    peerCues.mode === "webrtc"
      ? "直接接続中"
      : peerCues.mode === "firebase"
        ? "中継接続中"
        : peerCues.mode === "offline"
          ? "送信できません"
          : "接続中";
  const emoteControls = (
    <section
      className={`emote-controls${reactionControlsOpen ? " open" : ""}`}
      aria-label="全員にエモートを送る"
      title={`エモートの通信状態: ${cueConnectionLabel}`}
    >
      <div className="emote-toggle-wrap">
        <button
          type="button"
          className="emote-toggle"
          aria-expanded={reactionControlsOpen}
          aria-label={reactionControlsOpen ? "エモートを閉じる" : "エモートを開く"}
          onClick={() => setReactionControlsOpen((open) => !open)}
        >
          ☺
        </button>
        <small className={`cue-mode ${peerCues.mode}`}>{cueConnectionLabel}</small>
      </div>
      <div className="emote-actions">
        <strong>
          エモート
          <small>押すと全員の画面に表示</small>
        </strong>
        {(
          [
            ["applause", "👏", "拍手を送る"],
            ["surprise", "!", "驚きを送る"],
            ["thinking", "…", "思案を送る"],
          ] as const
        ).map(([emote, symbol, label]) => (
          <button
            type="button"
            key={emote}
            onClick={() => {
              void peerCues.send(emoteCue(emote));
              setReactionControlsOpen(false);
            }}
            aria-label={label}
          >
            {symbol}
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <main
      id="main"
      className={`game-screen ${room.role}${room.role === "spectator" && spectatorMode === "free" ? " free-roam" : ""}${logOpen ? " log-open" : ""}${personalSettings.dimUnplayableCards ? "" : " undim-unplayable"}`}
    >
      <div className="game-world">
        <SalonScene
          room={displayRoom}
          selectedIds={directEffect ? effectCardIds : selectedIds}
          playableIds={
            directEffect
              ? effectSelectableIds
              : shouldKeepOwnHandBright(activeEffect?.kind)
                ? undefined
                : personalSettings.dimUnplayableCards
                  ? playBlocked
                    ? noPlayableCards
                    : playableIds
                  : undefined
          }
          handReadOnly={readOnly || busy}
          onToggleCard={
            readOnly ? undefined : directEffect ? (card) => toggleEffectCard(card) : selectCard
          }
          lowPower={lowPower}
          reducedMotion={reducedMotion}
          dealing={dealing}
          cardMotions={
            dealing || (room.role === "spectator" && spectatorMode === "free") ? [] : cardMotions
          }
          onCardMotionDone={(id) =>
            setCardMotions((motions) => motions.filter((motion) => motion.id !== id))
          }
          spectatorMode={spectatorMode}
          effectInteraction={
            directEffect
              ? {
                  kind: directEffect.kind,
                  selectedIds: new Set(effectCardIds),
                  selectableIds: effectSelectableIds,
                  targetPlayerIds: effectTargetPlayerIds,
                  pendingGiveCardId,
                  giveTargets: effectTargets,
                  giveCards: room.hand,
                }
              : undefined
          }
          onEffectCardSelect={toggleEffectCard}
          onEffectPlayerSelect={chooseEffectTarget}
          onGiveCardDrop={dropGiveCard}
          onGiveCardReturn={returnGiveCard}
          remoteSpectatorPoses={remoteSpectatorPoses}
          avatarEmotes={peerCues.recentEmotes}
          freeRoamControlsPaused={logOpen || personalSettingsOpen}
          onFreeRoamPose={publishFreeRoamPose}
          onExitFreeRoam={() => setSpectatorMode("follow")}
          vrPanel={vrPanel}
        />
      </div>
      <header className="game-topbar">
        <div>
          <span className="brand-mark">大富豪</span>
          <button type="button" disabled={busy} onClick={leave}>
            退出
          </button>
          <button
            type="button"
            aria-label="個人設定"
            aria-haspopup="dialog"
            aria-expanded={personalSettingsOpen}
            onClick={() => setPersonalSettingsOpen(true)}
          >
            設定
          </button>
          {canManageTable && (
            <button
              type="button"
              aria-label="参加者管理"
              aria-expanded={moderationOpen}
              onClick={() => setModerationOpen((open) => !open)}
            >
              管理
            </button>
          )}
        </div>
        <div className="turn-status" role="timer" aria-live="polite">
          <strong>
            {finishing
              ? "最後のカード演出を再生中"
              : current
                ? `${current.name}の手番`
                : "進行待ち"}
          </strong>
          {!finishing && room.turnDeadlineMs && (
            <span className={seconds <= 10 ? "urgent" : ""}>残り {seconds}秒</span>
          )}
          <ConnectionBadge state={connection} localOnly={Boolean(room.localOnly)} />
        </div>
        {me && (
          <div className="profile-chip">
            <AvatarPortrait profile={me.avatar} label={`${me.name}の3Dアバター`} />
            <span>{me.name}</span>
          </div>
        )}
      </header>
      {moderationOpen && canManageTable && (
        <section className="moderation-panel" aria-label="ホストの参加者管理">
          <header>
            <strong>参加者管理</strong>
            <button
              type="button"
              onClick={() => setModerationOpen(false)}
              aria-label="参加者管理を閉じる"
            >
              ×
            </button>
          </header>
          <p>退出させられた対局者は失格となり、再接続できません。</p>
          <ul>
            {presentPlayers
              .filter((player) => player.id !== room.viewerId)
              .map((player) => (
                <li key={player.id}>
                  <span>
                    {player.name}
                    <small>{player.connection === "online" ? "接続中" : "切断中"}</small>
                  </span>
                  <button
                    type="button"
                    className="host-kick"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`${player.name}を部屋から退出させますか？`)) {
                        void command("kickMember", { ...payloadBase, targetUid: player.id });
                      }
                    }}
                  >
                    退出させる
                  </button>
                </li>
              ))}
            {room.spectators
              .filter((spectator) => spectator.id !== room.viewerId)
              .map((spectator) => (
                <li key={spectator.id}>
                  <span>
                    {spectator.name}
                    <small>観戦者</small>
                  </span>
                  <button
                    type="button"
                    className="host-kick"
                    disabled={busy}
                    onClick={() =>
                      void command("kickMember", { ...payloadBase, targetUid: spectator.id })
                    }
                  >
                    退出させる
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      <aside className="status-stack" aria-label="場の状態">
        <span className={room.revolution ? "active" : ""}>
          革命 {room.revolution ? "中" : "なし"}
        </span>
        <span className={room.jackBack ? "active" : ""}>
          Jバック {room.jackBack ? "中" : "なし"}
        </span>
        <span>方向 {room.direction === 1 ? "時計回り" : "反時計回り"}</span>
        <span>
          縛り{" "}
          {room.suitLock.length ? room.suitLock.map((suit) => suitLabel[suit]).join("・") : "なし"}
        </span>
      </aside>
      {room.role === "spectator" && (
        <section className="spectator-controls" aria-label="観戦するプレイヤー">
          <strong>
            <span>{spectatorMode === "follow" ? "プレイヤー視点" : "自由に移動中"}</span>
            {spectatorMode === "follow" && focusedSpectator && (
              <small>
                <span>{focusedSpectator.name}を観戦中</span>
                <span>ほかの手札はカーソルを重ねて確認</span>
              </small>
            )}
          </strong>
          <div className="spectator-modes">
            <button
              type="button"
              aria-pressed={spectatorMode === "follow"}
              onClick={() => setSpectatorMode("follow")}
            >
              プレイヤー視点
            </button>
            <button
              type="button"
              aria-pressed={spectatorMode === "free"}
              onClick={(event) => {
                setSpectatorMode("free");
                event.currentTarget.blur();
              }}
            >
              自由に移動
            </button>
          </div>
          <div className={spectatorMode === "free" ? "spectator-focus hidden" : "spectator-focus"}>
            {room.players
              .filter((player) => player.status === "active")
              .map((player) => (
                <button
                  type="button"
                  key={player.id}
                  aria-pressed={spectatorFocusId === player.id}
                  disabled={!canRequestSpectatorFocus(busy, spectatorFocusId, player.id)}
                  onClick={() => {
                    if (!canRequestSpectatorFocus(busy, spectatorFocusId, player.id)) return;
                    void command("changeSpectatorFocus", {
                      ...payloadBase,
                      focusPlayerId: player.id,
                    });
                  }}
                >
                  {player.name}
                </button>
              ))}
          </div>
        </section>
      )}
      {emoteControls}
      <CommentDanmaku
        comments={room.chat ?? []}
        lowPower={lowPower}
        reducedMotion={reducedMotion}
      />
      {effectNoticeQueue[0] && (
        <aside className="effect-notification" role="status" aria-live="assertive">
          <span aria-hidden="true">効果</span>
          <strong>{effectNoticeQueue[0].message}</strong>
        </aside>
      )}
      {reactionNoticeQueue[0] && (
        <aside className="reaction-notification" role="status" aria-live="polite">
          <b aria-hidden="true">{reactionNoticeQueue[0].symbol}</b>
          <span>{reactionNoticeQueue[0].message}</span>
        </aside>
      )}
      {finishing && (
        <p className="finishing-status" role="status" aria-live="polite">
          カードの移動と効果演出が終わってから結果を表示します
        </p>
      )}
      {dealing && !(room.role === "spectator" && spectatorMode === "free") && (
        <section className="dealing-overlay" aria-live="polite">
          <p className="eyebrow">配札中</p>
          <h2>カードを配っています</h2>
          <p>中央の山札から各席へ順番に配っています。カードの内容はすでに決まっています。</p>
          <button type="button" onClick={skipDeal}>
            配札演出をスキップ
          </button>
        </section>
      )}
      {autoPass.schedule && (
        <p className="auto-pass-status" role="status">
          出せる札がないため、{autoPassSeconds}秒後に自動パスします
        </p>
      )}
      {canShowPlayControls(readOnly, dealing, Boolean(directEffect), logOpen) && (
        <div className="play-controls">
          <p id="play-reason" className="control-reason">
            {!myTurn
              ? "あなたの手番ではありません"
              : room.pendingJokerMimic
                ? "Jokerの擬態を先に確定してください"
                : activeEffect
                  ? "強制効果を先に確定してください"
                  : selectionHint}
          </p>
          <button
            type="button"
            className="primary"
            disabled={!myTurn || !selection.complete || busy || playBlocked}
            aria-describedby="play-reason"
            onClick={openPlay}
          >
            選んだ札を出す
          </button>
          <button
            type="button"
            disabled={!myTurn || busy || playBlocked}
            onClick={() => void pass()}
          >
            パス
          </button>
        </div>
      )}
      {!dealing && !directEffect && !(room.role === "spectator" && spectatorMode === "free") && (
        <AccessibleHand
          cards={orderedHand}
          selectedIds={selectedIds}
          playableIds={
            shouldKeepOwnHandBright(activeEffect?.kind)
              ? undefined
              : playBlocked
                ? noPlayableCards
                : playableIds
          }
          onToggle={readOnly || busy ? () => undefined : selectCard}
          onSubmit={openPlay}
          readOnly={readOnly || busy}
          label={
            room.role === "spectator"
              ? `${focusedSpectator?.name ?? "プレイヤー"}を観戦中の手札 ${orderedHand.length}枚`
              : undefined
          }
        />
      )}
      {!dealing && directEffect && (
        <AccessibleHand
          cards={effectEligibleCards}
          selectedIds={effectCardIds}
          playableIds={effectSelectableIds}
          onToggle={(card) => {
            if (busy) return;
            const owner =
              directEffect.kind === "steal"
                ? room.players.find((player) => player.cards?.some((item) => item.id === card.id))
                    ?.id
                : undefined;
            toggleEffectCard(card, owner);
          }}
          onSubmit={confirmDirectEffect}
          readOnly={busy}
        />
      )}
      {directEffect && (
        <DirectEffectControls
          effect={directEffect}
          room={room}
          selectedIds={effectCardIds}
          targets={effectTargets}
          pendingGiveCardId={pendingGiveCardId}
          busy={busy}
          chooseTarget={chooseEffectTarget}
          clear={() => {
            setEffectCardIds([]);
            setEffectTargets({});
            setPendingGiveCardId(undefined);
          }}
          confirm={confirmDirectEffect}
        />
      )}
      {activeEffect?.kind === "bomber" && (
        <EffectPanel
          key={activeEffect.id}
          effect={activeEffect}
          room={room}
          busy={busy}
          resolve={resolveEffect}
          selectedBomberRanks={vrSelectedBomberRanks}
          toggleBomberRank={toggleVrBomberRank}
          confirmBomber={confirmVrBomber}
        />
      )}
      {room.pendingEffects[0] && room.pendingEffects[0].actorId !== room.viewerId && (
        <p className="effect-observer-status" role="status">
          {room.players.find((player) => player.id === room.pendingEffects[0]?.actorId)?.name ??
            "プレイヤー"}
          が効果を処理しています
        </p>
      )}
      {room.pendingJokerMimic && room.pendingJokerMimic.candidates.length > 1 && (
        <JokerDeclarationPanel
          pending={room.pendingJokerMimic}
          busy={busy}
          confirm={(mimics) =>
            void command("declareJokerMimic", { ...payloadBase, mimics, blindConfirmed: true })
          }
        />
      )}
      {canShowLogControls(logBlocked) && (
        <button
          type="button"
          className="log-toggle"
          aria-expanded={logOpen}
          onClick={() => setSettings({ logOpen: !logOpen })}
        >
          ログ／チャット
        </button>
      )}
      {canShowLogControls(logBlocked) && logOpen && (
        <ChatPanel
          room={room}
          sendChat={(message) => command("sendChat", { ...payloadBase, text: message })}
        />
      )}
      {error && (
        <p className="game-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="sr-only" aria-live="assertive">
        {current ? `${current.name}の手番、残り${seconds}秒` : ""}
        {peerCues.lastCue?.cue.type === "emote"
          ? `エモートを受信: ${peerCues.lastCue.cue.emote}`
          : ""}
      </div>
      {playDialog && (
        <PlayDialog
          cards={selectedCards}
          candidates={selection.jokerCandidates}
          close={() => setPlayDialog(false)}
          submit={submit}
          busy={busy}
        />
      )}
      {personalSettingsOpen && (
        <PersonalSettingsDialog
          settings={personalSettings}
          close={() => setPersonalSettingsOpen(false)}
          change={changePersonalSettings}
        />
      )}
    </main>
  );
}
