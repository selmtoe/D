import { useMemo, useState } from "react";
import type { LocalProfile, PublicRoom, Role } from "../app/model";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";

function elapsed(atMs: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - atMs) / 60000));
  return minutes < 1
    ? "たった今"
    : minutes < 60
      ? `${minutes}分前`
      : `${Math.floor(minutes / 60)}時間前`;
}

function RoomRow({
  room,
  busy,
  join,
}: {
  room: PublicRoom;
  busy: boolean;
  join: (id: string, role: Role) => void;
}) {
  return (
    <article className="room-row">
      <AvatarPortrait profile={room.hostAvatar} label={`${room.hostName}の3Dアバター`} />
      <div className="room-owner">
        <strong>{room.hostName}</strong>
        <span>部屋 {room.roomId}</span>
      </div>
      <dl>
        <div>
          <dt>人数</dt>
          <dd>{room.playerCount}/6</dd>
        </div>
        <div>
          <dt>観戦</dt>
          <dd>{room.spectatorCount}</dd>
        </div>
        <div>
          <dt>形式</dt>
          <dd>{room.mode === "blind" ? `ブラインド ${room.blindCount}枚` : "通常"}</dd>
        </div>
        <div>
          <dt>状態</dt>
          <dd>{room.phase === "waiting" ? "待機中" : "対局中"}</dd>
        </div>
      </dl>
      <time>{elapsed(room.createdAtMs)}</time>
      <div className="room-actions">
        {room.phase === "waiting" && (
          <button
            type="button"
            disabled={busy || room.playerCount >= 6}
            onClick={() => join(room.roomId, "player")}
            aria-label={`${room.hostName}の部屋 ${room.roomId} にプレイヤー参加`}
          >
            {room.playerCount >= 6 ? "満席" : "参加"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => join(room.roomId, "spectator")}
          aria-label={`${room.hostName}の部屋 ${room.roomId} を観戦`}
        >
          観戦
        </button>
      </div>
    </article>
  );
}

export function LobbyScreen({
  profile,
  rooms,
  connection,
  error,
  busy,
  create,
  join,
}: {
  profile: LocalProfile;
  rooms: PublicRoom[];
  connection: "connecting" | "connected" | "reconnecting" | "grace" | "offline";
  error?: string | undefined;
  busy: boolean;
  create: () => void;
  join: (id: string, role: Role) => void;
}) {
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase().slice(0, 5) ?? "",
  );
  const [localError, setLocalError] = useState("");
  const normalized = useMemo(() => roomId.replace(/[^A-Z0-9]/g, "").slice(0, 5), [roomId]);
  const submitJoin = (role: Role) => {
    if (normalized.length !== 5) {
      setLocalError("部屋IDを5文字で入力してください");
      return;
    }
    setLocalError("");
    join(normalized, role);
  };
  return (
    <main id="main" className="lobby-screen">
      <header className="topbar">
        <div>
          <span className="brand-mark">大富豪</span>
          <p>サロンロビー</p>
        </div>
        <ConnectionBadge state={connection} />
        <div className="profile-chip">
          <AvatarPortrait profile={profile.avatar} label={`${profile.name}のアバター`} />
          <span>{profile.name}</span>
        </div>
      </header>
      <section className="lobby-actions" aria-labelledby="lobby-actions-title">
        <div>
          <p className="eyebrow">CHOOSE YOUR TABLE</p>
          <h1 id="lobby-actions-title">今夜の円卓を選ぶ</h1>
        </div>
        <button type="button" className="primary create-room" disabled={busy} onClick={create}>
          {busy ? "接続中…" : "新しい部屋を作る"}
        </button>
        <div className="room-id-entry">
          <label htmlFor="room-id">5文字の部屋ID</label>
          <input
            id="room-id"
            inputMode="text"
            autoCapitalize="characters"
            value={normalized}
            onChange={(event) => {
              setRoomId(event.target.value.toUpperCase());
              setLocalError("");
            }}
            maxLength={5}
            aria-invalid={Boolean(localError)}
          />
          <button type="button" disabled={busy} onClick={() => submitJoin("player")}>
            プレイヤー参加
          </button>
          <button type="button" disabled={busy} onClick={() => submitJoin("spectator")}>
            観戦参加
          </button>
        </div>
        {(localError || error) && (
          <p className="inline-error" role="alert">
            {localError || error}
          </p>
        )}
      </section>
      <section className="public-rooms" aria-labelledby="public-title">
        <header>
          <div>
            <p className="eyebrow">OPEN TABLES</p>
            <h2 id="public-title">公開中の部屋</h2>
          </div>
          <span>{rooms.length}室</span>
        </header>
        <div className="room-list">
          {rooms.length ? (
            rooms.map((room) => <RoomRow key={room.roomId} room={room} busy={busy} join={join} />)
          ) : (
            <p className="empty-state">
              現在参加できる公開部屋はありません。新しい部屋を開いてお待ちください。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
