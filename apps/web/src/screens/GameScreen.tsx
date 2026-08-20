import { useEffect, useMemo, useRef, useState } from "react";
import { parsePlay, type Card as RuleCard } from "@daifugo/rules";
import type { CardView, PendingEffectView, Rank, RoomView, Suit } from "../app/model";
import { useUiStore } from "../app/store";
import { AccessibleHand } from "../accessibility/AccessibleHand";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { SalonScene } from "../game-3d/SalonScene";
import { EffectPanel } from "./EffectPanel";
import { feedback, primeFeedback } from "../components/feedback";
import { emoteCue } from "../network/peerCues";
import { usePeerCues } from "../network/usePeerCues";
import { JokerDeclarationPanel } from "./JokerDeclarationPanel";

const suitLabel = {
  spade: "スペード",
  heart: "ハート",
  diamond: "ダイヤ",
  club: "クラブ",
} as const;

function useCountdown(deadline?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

function PlayDialog({
  cards,
  close,
  submit,
  busy,
}: {
  cards: CardView[];
  close: () => void;
  submit: (mimics: { cardId: string; suit: Suit; rank: Rank }[]) => void;
  busy: boolean;
}) {
  const jokers = cards.filter((card) => card.visibility === "face" && Boolean(card.joker));
  const [mimics, setMimics] = useState<Record<string, { suit: Suit; rank: Rank }>>({});
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const ranks: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  const needsDeclaration = cards.length > 1 && jokers.length > 0;
  const ready = !needsDeclaration || jokers.every((card) => mimics[card.id]);
  useEffect(() => {
    document.body.classList.add("modal-open");
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),select:not([disabled])",
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
  }, [close]);
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
        {needsDeclaration && (
          <div>
            {jokers.map((joker, index) => (
              <fieldset key={joker.id}>
                <legend>Joker {index + 1} の擬態</legend>
                <select
                  aria-label={`Joker ${index + 1}のスート`}
                  value={mimics[joker.id]?.suit ?? ""}
                  onChange={(event) =>
                    setMimics((current) => ({
                      ...current,
                      [joker.id]: {
                        suit: event.target.value as Suit,
                        rank: current[joker.id]?.rank ?? "3",
                      },
                    }))
                  }
                >
                  <option value="">スート</option>
                  {Object.entries(suitLabel).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Joker ${index + 1}のランク`}
                  value={mimics[joker.id]?.rank ?? ""}
                  onChange={(event) =>
                    setMimics((current) => ({
                      ...current,
                      [joker.id]: {
                        suit: current[joker.id]?.suit ?? "spade",
                        rank: event.target.value as Rank,
                      },
                    }))
                  }
                >
                  <option value="">ランク</option>
                  {ranks.map((rank) => (
                    <option key={rank}>{rank}</option>
                  ))}
                </select>
              </fieldset>
            ))}
          </div>
        )}
        <footer>
          <button type="button" onClick={close}>
            選び直す
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready || busy}
            onClick={() =>
              submit(Object.entries(mimics).map(([cardId, mimic]) => ({ cardId, ...mimic })))
            }
          >
            {busy ? "提出中…" : "この札を出す"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ChatPanel({ room, sendChat }: { room: RoomView; sendChat: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const [composing, setComposing] = useState(false);
  const [visiblePages, setVisiblePages] = useState(1);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    sendChat(message.trim().slice(0, 120));
    setMessage("");
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
        <button type="submit">送信</button>
      </form>
    </section>
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
  const [playDialog, setPlayDialog] = useState(false);
  const seconds = useCountdown(room.turnDeadlineMs);
  const me = room.players.find((player) => player.id === room.viewerId);
  const peerCues = usePeerCues(
    room.roomId,
    room.viewerId,
    room.players.map((player) => player.id),
  );
  const current = room.players.find((player) => player.id === room.currentPlayerId);
  const selectedCards = room.hand.filter((card) => selectedIds.includes(card.id));
  const selectionHint = useMemo(() => {
    if (!selectedCards.length) return "出す札を選んでください";
    if (selectedCards.some((card) => card.visibility === "hidden"))
      return "ブラインド札は部屋ホストが中身を検証します";
    if (
      selectedCards.some((card) => card.visibility === "face" && card.joker) &&
      selectedCards.length > 1
    )
      return "Jokerの擬態を選ぶと候補を確認できます";
    try {
      parsePlay(
        selectedCards.map((card): RuleCard =>
          card.visibility === "face" && card.joker
            ? { id: card.id, suit: null, rank: "JOKER" }
            : {
                id: card.id,
                suit: card.visibility === "face" ? (card.suit ?? null) : null,
                rank: card.visibility === "face" ? (card.rank ?? "3") : "3",
              },
        ),
      );
      return "選択した組み合わせは出し方の候補です（最終判定は部屋ホスト）";
    } catch {
      return "同ランクの組、または同一スート3枚以上の階段を選んでください";
    }
  }, [selectedCards]);
  const myTurn = room.currentPlayerId === room.viewerId;
  const readOnly = room.role === "spectator" || me?.status !== "active";
  const activeEffect = room.pendingEffects.find(
    (effect) => effect.actorId === room.viewerId && effect.kind !== "clearField",
  );
  const payloadBase = useMemo(
    () => ({ roomId: room.roomId, gameId: room.gameId, expectedRevision: room.revision }),
    [room.gameId, room.revision, room.roomId],
  );
  const openPlay = () => {
    if (!selectedCards.length || !myTurn || readOnly) return;
    setPlayDialog(true);
  };
  const selectCard = (card: CardView) => {
    primeFeedback(muted);
    toggleCard(card);
    feedback("select", muted);
  };
  const previousTurn = useRef(room.currentPlayerId);
  const previousTrick = useRef(room.trickId);
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
  return (
    <main id="main" className={`game-screen ${room.role}`}>
      <div className="game-world">
        <SalonScene
          room={room}
          selectedIds={selectedIds}
          onToggleCard={readOnly ? undefined : selectCard}
          lowPower={lowPower}
          reducedMotion={reducedMotion}
          dealing={dealing}
        />
      </div>
      <header className="game-topbar">
        <div>
          <span className="brand-mark">大富豪</span>
          <button type="button" onClick={leave}>
            退出
          </button>
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
          <strong>観戦中</strong>
          <div>
            {room.players.map((player) => (
              <button
                type="button"
                key={player.id}
                aria-pressed={(room.focusedPlayerId ?? room.players[0]?.id) === player.id}
                onClick={() =>
                  command("changeSpectatorFocus", { ...payloadBase, focusPlayerId: player.id })
                }
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
      {!readOnly && !dealing && (
        <div className="play-controls">
          <p id="play-reason" className="control-reason">
            {!myTurn ? "あなたの手番ではありません" : selectionHint}
          </p>
          <button
            type="button"
            className="primary"
            disabled={!myTurn || !selectedIds.length || busy || Boolean(activeEffect)}
            aria-describedby="play-reason"
            onClick={openPlay}
          >
            選んだ札を出す
          </button>
          <button
            type="button"
            disabled={!myTurn || busy || Boolean(activeEffect)}
            onClick={() => void command("submitPass", payloadBase)}
          >
            パス
          </button>
        </div>
      )}
      {!dealing && (
        <AccessibleHand
          cards={room.hand}
          selectedIds={selectedIds}
          onToggle={readOnly ? () => undefined : selectCard}
          onSubmit={openPlay}
        />
      )}
      {activeEffect && (
        <EffectPanel effect={activeEffect} room={room} busy={busy} resolve={resolveEffect} />
      )}
      {room.pendingJokerMimic && (
        <JokerDeclarationPanel
          pending={room.pendingJokerMimic}
          busy={busy}
          confirm={(mimics) =>
            void command("declareJokerMimic", { ...payloadBase, mimics, blindConfirmed: true })
          }
        />
      )}
      <button
        type="button"
        className="log-toggle"
        aria-expanded={logOpen}
        onClick={() => setSettings({ logOpen: !logOpen })}
      >
        ログ／チャット
      </button>
      {logOpen && (
        <ChatPanel
          room={room}
          sendChat={(message) => void command("sendChat", { ...payloadBase, text: message })}
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
          close={() => setPlayDialog(false)}
          submit={submit}
          busy={busy}
        />
      )}
    </main>
  );
}
