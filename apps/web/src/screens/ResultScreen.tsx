import { useRef, useState } from "react";
import type { RoomView } from "../app/model";
import type { ReplayFrame } from "../app/replay";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ReplayDialog } from "./ReplayDialog";

export function ResultScreen({
  room,
  busy,
  error,
  replayFrames = [],
  lowPower = false,
  reducedMotion = false,
  leave,
  rematch,
}: {
  room: RoomView;
  busy: boolean;
  error?: string | undefined;
  replayFrames?: readonly ReplayFrame[];
  lowPower?: boolean;
  reducedMotion?: boolean;
  leave: () => void;
  rematch: () => void;
}) {
  const [replayOpen, setReplayOpen] = useState(false);
  const replayButton = useRef<HTMLButtonElement>(null);
  const viewerIsPlayer = room.players.some(
    (player) =>
      player.id === room.viewerId && player.present !== false && player.status !== "disqualified",
  );
  const rows = room.rankings
    .map((ranking) => ({
      ...ranking,
      player: room.players.find((player) => player.id === ranking.playerId),
    }))
    .filter((row) => row.player)
    .sort((left, right) => left.place - right.place);
  return (
    <main id="main" className="result-screen">
      <section className="result-card" aria-hidden={replayOpen || undefined} inert={replayOpen}>
        <p className="eyebrow">対局終了</p>
        <h1>対局結果</h1>
        <ol>
          {rows.map((row) => (
            <li key={row.playerId} value={row.place}>
              <span className="place">
                {row.place}
                <small>位</small>
              </span>
              <AvatarPortrait
                profile={row.player!.avatar}
                label={`${row.player!.name}の3Dアバター`}
              />
              <div>
                <strong>{row.player!.name}</strong>
                {row.reason && <span>{row.reason}</span>}
              </div>
            </li>
          ))}
        </ol>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            ref={replayButton}
            type="button"
            disabled={replayFrames.length === 0}
            onClick={() => setReplayOpen(true)}
          >
            リプレイを見る
          </button>
          <button type="button" disabled={busy} onClick={leave}>
            ロビーへ戻る
          </button>
          {viewerIsPlayer && room.hostId === room.viewerId ? (
            <button type="button" className="primary" disabled={busy} onClick={rematch}>
              {busy ? "準備中…" : "同じ部屋で次のゲーム"}
            </button>
          ) : (
            <p>ホストが次のゲームを準備するのを待っています</p>
          )}
        </footer>
      </section>
      {replayOpen && (
        <ReplayDialog
          frames={replayFrames}
          lowPower={lowPower}
          reducedMotion={reducedMotion}
          close={() => {
            setReplayOpen(false);
            window.setTimeout(() => replayButton.current?.focus(), 0);
          }}
        />
      )}
    </main>
  );
}
