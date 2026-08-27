import { defaultAvatar } from "@daifugo/avatar-schema";
import { lazy, Suspense, useMemo, useState } from "react";
import type { RoomView } from "../app/model";
import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";
import { ConnectionBadge } from "../components/ConnectionBadge";

const WaitingPlayground = lazy(() => import("../waiting-3d/WaitingPlayground"));

export function canEditRoomSettings(isHost: boolean, busy: boolean): boolean {
  return isHost && !busy;
}

export function canAddCpu(isHost: boolean, busy: boolean, playerCount: number): boolean {
  return isHost && !busy && playerCount < 6;
}

export function startablePlayerCount(room: RoomView): number {
  return room.players.filter((player) => player.cpu || player.connection === "online").length;
}

export function WaitingRoomScreen({
  room,
  connection,
  busy,
  error,
  leave,
  start,
  addCpu,
  removeCpu,
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
  addCpu: () => void;
  removeCpu: (targetUid: string) => void;
  transferHost: (targetUid: string) => void;
  kick: (targetUid: string) => void;
  updateSettings: (settings: RoomView["settings"]) => void;
  openRules: () => void;
}) {
  const [tab, setTab] = useState<"people" | "settings">("people");
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const me = room.players.find((player) => player.id === room.viewerId);
  const isHost = Boolean(me && room.hostId === room.viewerId);
  const settingsEditable = canEditRoomSettings(isHost, busy);
  const readyPlayerCount = startablePlayerCount(room);
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.roomId}`;
  const playgroundMembers = useMemo(
    () => [
      ...room.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        cpu: player.cpu,
      })),
      ...room.spectators.map((spectator) => ({
        id: spectator.id,
        name: spectator.name,
        avatar: spectator.avatar ?? defaultAvatar,
        spectator: true,
      })),
    ],
    [room.players, room.spectators],
  );
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
        <ConnectionBadge state={connection} localOnly={Boolean(room.localOnly)} />
        <button type="button" disabled={busy} onClick={leave}>
          退出する
        </button>
      </header>
      <section className="waiting-card">
        <header>
          <div>
            <p className="eyebrow">待機中の部屋</p>
            <h1>
              部屋 <span className="room-code">{room.roomId}</span>
            </h1>
          </div>
          <div className="invite-actions">
            <button
              type="button"
              className="waiting-playground-entry"
              aria-haspopup="dialog"
              onClick={() => setPlaygroundOpen(true)}
            >
              3D待機室で遊ぶ
            </button>
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
              <div className="players-heading">
                <h2 id="players-title">
                  プレイヤー <span>{room.players.length}/6</span>
                </h2>
                {isHost && room.players.length < 6 && (
                  <button
                    type="button"
                    className="add-cpu"
                    disabled={!canAddCpu(isHost, busy, room.players.length)}
                    onClick={addCpu}
                  >
                    CPUを追加
                  </button>
                )}
              </div>
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
                        <strong>
                          {player.name}
                          {player.cpu && <span className="cpu-badge">CPU</span>}
                        </strong>
                        <span>
                          {player.cpu
                            ? "CPUプレイヤー · 常時接続"
                            : `${player.host ? "ホスト · " : ""}${
                                player.connection === "online"
                                  ? "接続中"
                                  : player.connection === "grace"
                                    ? "切断猶予中"
                                    : "切断"
                              }`}
                        </span>
                      </div>
                      {player.id === me?.id ? (
                        <em>あなた</em>
                      ) : (
                        isHost && (
                          <div className="host-actions">
                            {!player.cpu && player.connection === "online" && (
                              <button
                                type="button"
                                className="host-transfer"
                                disabled={busy}
                                onClick={() => transferHost(player.id)}
                                aria-label={`${player.name}へホストを移譲`}
                              >
                                ホストにする
                              </button>
                            )}
                            <button
                              type="button"
                              className="host-kick"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    player.cpu
                                      ? `${player.name}を削除しますか？`
                                      : `${player.name}を部屋から退出させますか？`,
                                  )
                                ) {
                                  if (player.cpu) removeCpu(player.id);
                                  else kick(player.id);
                                }
                              }}
                              aria-label={
                                player.cpu
                                  ? `${player.name}のCPU席を削除`
                                  : `${player.name}を部屋から退出させる`
                              }
                            >
                              {player.cpu ? "CPUを削除" : "退出させる"}
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
                          if (window.confirm(`${spectator.name}を部屋から退出させますか？`))
                            kick(spectator.id);
                        }}
                      >
                        退出させる
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
            {readyPlayerCount < 3
              ? `開始には参加プレイヤーがあと${3 - readyPlayerCount}人必要です`
              : `${readyPlayerCount}人で開始できます`}
          </p>
          {isHost ? (
            <button
              type="button"
              className="primary"
              onClick={start}
              disabled={readyPlayerCount < 3 || busy}
            >
              {busy ? "開始処理中…" : "ゲームを始める"}
            </button>
          ) : (
            <p>ホストの開始を待っています</p>
          )}
        </footer>
      </section>
      {playgroundOpen && (
        <Suspense
          fallback={
            <div className="waiting-playground-loading" role="status">
              3D待機室を準備しています…
            </div>
          }
        >
          <WaitingPlayground members={playgroundMembers} onClose={() => setPlaygroundOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}
