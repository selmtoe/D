import type { RoomView } from "../app/model";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";

export function ResultScreen({
  room,
  busy,
  error,
  leave,
  rematch,
}: {
  room: RoomView;
  busy: boolean;
  error?: string | undefined;
  leave: () => void;
  rematch: () => void;
}) {
  const rows = room.rankings
    .map((ranking) => ({
      ...ranking,
      player: room.players.find((player) => player.id === ranking.playerId),
    }))
    .filter((row) => row.player)
    .sort((left, right) => left.place - right.place);
  return (
    <main id="main" className="result-screen">
      <section className="result-card">
        <p className="eyebrow">RESULT</p>
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
          <button type="button" onClick={leave}>
            サロンロビーへ
          </button>
          {room.hostId === room.viewerId ? (
            <button type="button" className="primary" disabled={busy} onClick={rematch}>
              {busy ? "準備中…" : "同じ部屋で次のゲーム"}
            </button>
          ) : (
            <p>ホストが次のゲームを準備するのを待っています</p>
          )}
        </footer>
      </section>
    </main>
  );
}
