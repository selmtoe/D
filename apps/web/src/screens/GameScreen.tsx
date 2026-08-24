import { useEffect, useMemo, useRef, useState } from "react";
import type { CardView, PendingEffectView, Rank, RoomView, Suit } from "../app/model";
import { useUiStore } from "../app/store";
import { AccessibleHand } from "../accessibility/AccessibleHand";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { playersAtTable, SalonScene } from "../game-3d/SalonScene";
import { EffectPanel } from "./EffectPanel";
import { feedback, primeFeedback } from "../components/feedback";
import { emoteCue } from "../network/peerCues";
import { usePeerCues } from "../network/usePeerCues";
import { JokerDeclarationPanel } from "./JokerDeclarationPanel";
import {
  analyzeCardSelection,
  compactCardLabel,
  selectableCardIds,
  sortHandWeakToStrong,
} from "../gameplay/cardPresentation";
import { CommentDanmaku } from "./CommentDanmaku";
import { deriveCardMotions, type CardMotionEvent } from "../game-3d/cardMotion";

const suitLabel = {
  spade: "スペード",
  heart: "ハート",
  diamond: "ダイヤ",
  club: "クラブ",
} as const;
const noPlayableCards = new Set<string>();

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
        closeRef.current();
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
          <button type="button" onClick={close}>
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

export function GameScreen({
  room,
  connection,
  lowPower,
  reducedMotion,
  busy,
  error,
  dealing,
  skipDeal,
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
  leave: () => void;
  command: (name: string, payload?: Record<string, unknown>) => Promise<boolean>;
}) {
  const selectedIds = useUiStore((state) => state.selectedCardIds);
  const toggleCard = useUiStore((state) => state.toggleCard);
  const clearSelection = useUiStore((state) => state.clearSelection);
  const logOpen = useUiStore((state) => state.logOpen);
  const setSettings = useUiStore((state) => state.setSettings);
  const muted = useUiStore((state) => state.soundMuted);
  const localAvatar = useUiStore((state) => state.app.profile?.avatar);
  const [playDialog, setPlayDialog] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [cardMotions, setCardMotions] = useState<CardMotionEvent[]>([]);
  const [effectCardIds, setEffectCardIds] = useState<string[]>([]);
  const [effectTargets, setEffectTargets] = useState<Record<string, string>>({});
  const [pendingGiveCardId, setPendingGiveCardId] = useState<string>();
  const [spectatorMode, setSpectatorMode] = useState<"follow" | "free">("follow");
  const autoJokerDeclaration = useRef<string | undefined>(undefined);
  const previousRoom = useRef<RoomView | undefined>(undefined);
  const seconds = useCountdown(room.turnDeadlineMs);
  const me = room.players.find((player) => player.id === room.viewerId);
  const presentPlayers = useMemo(() => playersAtTable(room.players), [room.players]);
  const peerCues = usePeerCues(
    room.roomId,
    room.viewerId,
    presentPlayers.map((player) => player.id),
  );
  const current = room.players.find((player) => player.id === room.currentPlayerId);
  const myTurn = room.currentPlayerId === room.viewerId;
  const readOnly = room.role === "spectator" || me?.status !== "active";
  const sortedHand = useMemo(() => sortHandWeakToStrong(room.hand), [room.hand]);
  const spectatorFocusId =
    room.players.find((player) => player.id === room.focusedPlayerId && player.status === "active")
      ?.id ?? room.players.find((player) => player.status === "active")?.id;
  const selectedCards = sortedHand.filter((card) => selectedIds.includes(card.id));
  const selection = useMemo(() => analyzeCardSelection(room, selectedIds), [room, selectedIds]);
  const playableIds = useMemo(
    () => (!readOnly ? selectableCardIds(room, selectedIds) : undefined),
    [readOnly, room, selectedIds],
  );
  const displayRoom = useMemo(() => {
    const viewpointId = room.role === "spectator" ? spectatorFocusId : room.viewerId;
    const viewerIndex = room.players.findIndex((player) => player.id === viewpointId);
    const players =
      viewerIndex > 0
        ? [...room.players.slice(viewerIndex), ...room.players.slice(0, viewerIndex)]
        : room.players;
    return {
      ...room,
      players,
      hand: sortedHand,
      ...(room.role === "spectator" && spectatorFocusId
        ? { focusedPlayerId: spectatorFocusId }
        : {}),
    };
  }, [room, sortedHand, spectatorFocusId]);
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
  const playBlocked = Boolean(activeEffect || room.pendingJokerMimic);
  const effectCardEligibility = directEffect?.eligibleCardIds?.join("\0") ?? "";
  const effectPlayerEligibility = directEffect?.eligiblePlayerIds?.join("\0") ?? "";
  const effectHasPlayerEligibility = directEffect?.eligiblePlayerIds !== undefined;
  const directEffectKind = directEffect?.kind;
  const directEffectRequiredCount = directEffect?.requiredCount ?? 0;
  const effectSelectableIds = useMemo(
    () => new Set(effectCardEligibility ? effectCardEligibility.split("\0") : []),
    [effectCardEligibility],
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
        ? room.discard
        : directEffect.kind === "steal"
          ? room.players
              .filter((player) => player.id !== room.viewerId)
              .flatMap((player) => player.cards ?? [])
          : room.hand;
    return source.filter((card) => effectSelectableIds.has(card.id));
  }, [directEffect, effectSelectableIds, room.discard, room.hand, room.players, room.viewerId]);
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
    if (!canOpenPlayConfirmation(selection.complete, myTurn, readOnly, playBlocked)) return;
    setPlayDialog(true);
  };
  const selectCard = (card: CardView) => {
    primeFeedback(muted);
    toggleCard(card);
    feedback("select", muted);
  };
  const toggleEffectCard = (card: CardView, ownerId?: string) => {
    if (!directEffect || !effectSelectableIds.has(card.id)) return;
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
    if (directEffect?.kind !== "give" || !pendingGiveCardId || !effectTargetPlayerIds.has(playerId))
      return;
    setEffectTargets((targets) => ({ ...targets, [pendingGiveCardId]: playerId }));
    setPendingGiveCardId(undefined);
    feedback("select", muted);
  };
  const dropGiveCard = (card: CardView, playerId: string) => {
    if (
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
  const previousTurn = useRef(room.currentPlayerId);
  const previousTrick = useRef(room.trickId);
  useEffect(() => {
    const previous = previousRoom.current;
    previousRoom.current = room;
    if (!previous) return;
    const next = deriveCardMotions(previous, room);
    if (next.length)
      setCardMotions((currentMotions) => {
        const known = new Set(currentMotions.map((motion) => motion.id));
        return [...currentMotions, ...next.filter((motion) => !known.has(motion.id))];
      });
  }, [room]);
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
  };
  const pass = async () => {
    if (await command("submitPass", payloadBase)) clearSelection();
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
  const confirmDirectEffect = () => {
    if (
      !directEffect ||
      effectCardIds.length !== directEffect.requiredCount ||
      effectCardIds.some((cardId) => !effectSelectableIds.has(cardId)) ||
      (["steal", "give"].includes(directEffect.kind) &&
        effectCardIds.some((cardId) => !effectTargetPlayerIds.has(effectTargets[cardId] ?? "")))
    )
      return;
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
  const focusedSpectator = room.players.find((player) => player.id === spectatorFocusId);
  return (
    <main id="main" className={`game-screen ${room.role}`}>
      <div className="game-world">
        <SalonScene
          room={displayRoom}
          selectedIds={directEffect ? effectCardIds : selectedIds}
          playableIds={
            directEffect ? effectSelectableIds : playBlocked ? noPlayableCards : playableIds
          }
          onToggleCard={
            readOnly ? undefined : directEffect ? (card) => toggleEffectCard(card) : selectCard
          }
          lowPower={lowPower}
          reducedMotion={reducedMotion}
          dealing={dealing}
          cardMotions={cardMotions}
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
          freeRoamAvatar={localAvatar ?? me?.avatar ?? room.players[0]?.avatar}
          onExitFreeRoam={() => setSpectatorMode("follow")}
        />
      </div>
      <header className="game-topbar">
        <div>
          <span className="brand-mark">大富豪</span>
          <button type="button" onClick={leave}>
            退出
          </button>
          {room.hostId === room.viewerId && (
            <button
              type="button"
              aria-expanded={moderationOpen}
              onClick={() => setModerationOpen((open) => !open)}
            >
              卓管理
            </button>
          )}
        </div>
        <div className="turn-status" role="timer" aria-live="polite">
          <strong>{current ? `${current.name}の手番` : "進行待ち"}</strong>
          {room.turnDeadlineMs && (
            <span className={seconds <= 10 ? "urgent" : ""}>残り {seconds}秒</span>
          )}
          <ConnectionBadge state={connection} />
        </div>
        {me && (
          <div className="profile-chip">
            <AvatarPortrait profile={me.avatar} label={`${me.name}の3Dアバター`} />
            <span>{me.name}</span>
          </div>
        )}
      </header>
      {moderationOpen && room.hostId === room.viewerId && (
        <section className="moderation-panel" aria-label="ホストの卓管理">
          <header>
            <strong>卓管理</strong>
            <button
              type="button"
              onClick={() => setModerationOpen(false)}
              aria-label="卓管理を閉じる"
            >
              ×
            </button>
          </header>
          <p>キックされた対局者は失格となり、再接続できません。</p>
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
                      if (window.confirm(`${player.name}を部屋からキックしますか？`)) {
                        void command("kickMember", { ...payloadBase, targetUid: player.id });
                      }
                    }}
                  >
                    キック
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
                    キック
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
            <span>{spectatorMode === "follow" ? "プレイヤー視点" : "自由観戦"}</span>
            {spectatorMode === "follow" && focusedSpectator && (
              <small>{focusedSpectator.name}を観戦中</small>
            )}
          </strong>
          <div className="spectator-modes">
            <button
              type="button"
              aria-pressed={spectatorMode === "follow"}
              onClick={() => setSpectatorMode("follow")}
            >
              憑依
            </button>
            <button
              type="button"
              aria-pressed={spectatorMode === "free"}
              onClick={(event) => {
                setSpectatorMode("free");
                event.currentTarget.blur();
              }}
            >
              キャラ移動
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
      <section className="emote-controls" aria-label="エモート">
        <span>
          {peerCues.mode === "webrtc"
            ? "低遅延"
            : peerCues.mode === "firebase"
              ? "Firebase"
              : peerCues.mode === "offline"
                ? "エモート停止"
                : "接続中"}
        </span>
        <button
          type="button"
          onClick={() => void peerCues.send(emoteCue("applause"))}
          aria-label="拍手を送る"
        >
          👏
        </button>
        <button
          type="button"
          onClick={() => void peerCues.send(emoteCue("surprise"))}
          aria-label="驚きを送る"
        >
          !
        </button>
        <button
          type="button"
          onClick={() => void peerCues.send(emoteCue("thinking"))}
          aria-label="思案を送る"
        >
          …
        </button>
      </section>
      <CommentDanmaku
        comments={room.chat ?? []}
        lowPower={lowPower}
        reducedMotion={reducedMotion}
      />
      {dealing && (
        <section className="dealing-overlay" aria-live="polite">
          <p className="eyebrow">DEALING</p>
          <h2>カードを配っています</h2>
          <p>中央のデックから各席へ順番に配札中。権威状態は確定済みです。</p>
          <button type="button" onClick={skipDeal}>
            配札演出をスキップ
          </button>
        </section>
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
          cards={sortedHand}
          selectedIds={selectedIds}
          playableIds={playBlocked ? noPlayableCards : playableIds}
          onToggle={readOnly ? () => undefined : selectCard}
          onSubmit={openPlay}
          readOnly={readOnly}
          label={
            room.role === "spectator"
              ? `${focusedSpectator?.name ?? "プレイヤー"}を観戦中の手札 ${sortedHand.length}枚`
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
            const owner =
              directEffect.kind === "steal"
                ? room.players.find((player) => player.cards?.some((item) => item.id === card.id))
                    ?.id
                : undefined;
            toggleEffectCard(card, owner);
          }}
          onSubmit={confirmDirectEffect}
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
    </main>
  );
}
