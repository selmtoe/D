import { useState } from "react";
import type { RoomView } from "../app/model";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";

export function canEditRoomSettings(isHost: boolean, busy: boolean): boolean {
  return isHost && !busy;
}

export function WaitingRoomScreen({
  room,
  connection,
  busy,
  error,
  leave,
  start,
  transferHost,
  kick,
  updateSettings,
  openRules,
}: {
  room: RoomView;
  connection: "connecting" | "connected" | "reconnecting" | "grace" | "offline";
  busy: boolean;
  error?: string | undefined;
  leave: () => void;
  start: () => void;
  transferHost: (targetUid: string) => void;
  kick: (targetUid: string) => void;
  updateSettings: (settings: RoomView["settings"]) => void;
  openRules: () => void;
}) {
  const [tab, setTab] = useState<"people" | "settings">("people");
  const me = room.players.find((player) => player.id === room.viewerId);
  const isHost = room.hostId === room.viewerId;
  const settingsEditable = canEditRoomSettings(isHost, busy);
  const connectedCount = room.players.filter((player) => player.connection === "online").length;
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.roomId}`;
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard access is optional and can be denied by browser policy.
    }
  };
  const copy = () => void copyText(room.roomId);
  const share = () => {
    if (!navigator.share) {
      void copyText(inviteUrl);
      return;
    }
    void navigator
      .share({
        title: "大富豪への招待",
        text: `部屋 ${room.roomId} で待っています`,
        url: inviteUrl,
      })
      .catch(() => undefined);
  };
  return (
    <main id="main" className="waiting-screen">
      <header className="topbar">
        <span className="brand-mark">大富豪</span>
        <ConnectionBadge state={connection} />
        <button type="button" onClick={leave}>
          退出する
        </button>
      </header>
      <section className="waiting-card">
        <header>
          <div>
            <p className="eyebrow">PRIVATE ROOM</p>
            <h1>
              部屋 <span className="room-code">{room.roomId}</span>
            </h1>
          </div>
          <div className="invite-actions">
            <button type="button" onClick={copy}>
              IDをコピー
            </button>
            <button type="button" onClick={share}>
              招待する
            </button>
          </div>
        </header>
        <nav className="waiting-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "people"}
            onClick={() => setTab("people")}
          >
            参加者
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            onClick={() => setTab("settings")}
          >
            設定
          </button>
        </nav>
        {tab === "people" ? (
          <div className="waiting-people">
            <section aria-labelledby="players-title">
              <h2 id="players-title">
                プレイヤー <span>{room.players.length}/6</span>
              </h2>
              <div className="player-slots">
                {Array.from({ length: 6 }, (_, index) => {
                  const player = room.players[index];
                  return player ? (
                    <article className="player-slot" key={player.id}>
                      <AvatarPortrait
                        profile={player.avatar}
                        label={`${player.name}の3Dアバター`}
                      />
                      <div>
                        <strong>{player.name}</strong>
                        <span>
                          {player.host ? "ホスト · " : ""}
                          {player.connection === "online"
                            ? "接続中"
                            : player.connection === "grace"
                              ? "切断猶予中"
                              : "切断"}
                        </span>
                      </div>
                      {player.id === me?.id ? (
                        <em>あなた</em>
                      ) : (
                        isHost && (
                          <div className="host-actions">
                            {player.connection === "online" && (
                              <button
                                type="button"
                                className="host-transfer"
                                disabled={busy}
                                onClick={() => transferHost(player.id)}
                                aria-label={`${player.name}へホストを移譲`}
                              >
                                ホスト移譲
                              </button>
                            )}
                            <button
                              type="button"
                              className="host-kick"
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`${player.name}を部屋からキックしますか？`))
                                  kick(player.id);
                              }}
                              aria-label={`${player.name}を部屋からキック`}
                            >
                              キック
                            </button>
                          </div>
                        )
                      )}
                    </article>
                  ) : (
                    <article className="player-slot empty" key={index}>
                      <span aria-hidden="true">{index + 1}</span>
                      <p>空席</p>
                    </article>
                  );
                })}
              </div>
            </section>
            <aside>
              <h2>
                観戦者 <span>{room.spectators.length}</span>
              </h2>
              <ul>
                {room.spectators.map((spectator) => (
                  <li key={spectator.id}>
                    {spectator.name}
                    {isHost && spectator.id !== room.viewerId && (
                      <button
                        type="button"
                        className="host-kick"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`${spectator.name}を部屋からキックしますか？`))
                            kick(spectator.id);
                        }}
                      >
                        キック
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!room.spectators.length && <p>まだいません</p>}
            </aside>
          </div>
        ) : (
          <div className="room-settings">
            <fieldset disabled={!isHost || busy}>
              <legend>ゲーム形式</legend>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={room.settings.mode === "normal"}
                  disabled={!settingsEditable}
                  onChange={() => updateSettings({ mode: "normal", blindCount: 0 })}
                />
                通常大富豪
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={room.settings.mode === "blind"}
                  disabled={!settingsEditable}
                  onChange={() =>
                    updateSettings({
                      mode: "blind",
                      blindCount: Math.max(1, room.settings.blindCount),
                    })
                  }
                />
                ブラインド大富豪
              </label>
              <label>
                ブラインド枚数{" "}
                <select
                  value={room.settings.blindCount || 1}
                  disabled={room.settings.mode !== "blind" || !settingsEditable}
                  onChange={(event) =>
                    updateSettings({ ...room.settings, blindCount: Number(event.target.value) })
                  }
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      {index + 1}枚
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {!isHost && <p>設定はホストのみ変更できます。</p>}
            <button type="button" onClick={openRules}>
              ルールブックを読む
            </button>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <p>
            {connectedCount < 3
              ? `開始には接続中プレイヤーがあと${3 - connectedCount}人必要です`
              : `${connectedCount}人で開始できます`}
          </p>
          {isHost ? (
            <button
              type="button"
              className="primary"
              onClick={start}
              disabled={connectedCount < 3 || busy}
            >
              {busy ? "開始処理中…" : "ゲームを始める"}
            </button>
          ) : (
            <p>ホストの開始を待っています</p>
          )}
        </footer>
      </section>
    </main>
  );
}
