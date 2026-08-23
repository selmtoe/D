import { useState } from "react";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { SalonScene } from "../game-3d/SalonScene";
import { ConnectionBadge } from "../components/ConnectionBadge";
import type { AppState } from "../app/model";

export function EntranceScreen({
  app,
  avatar,
  setAvatar,
  lowPower,
  setLowPower,
  muted,
  setMuted,
  openEditor,
  openRules,
  enter,
  reconnecting = false,
}: {
  app: AppState;
  avatar: AvatarProfileV1;
  setAvatar: (avatar: AvatarProfileV1) => void;
  lowPower: boolean;
  setLowPower: (value: boolean) => void;
  muted: boolean;
  setMuted: (value: boolean) => void;
  openEditor: () => void;
  openRules: () => void;
  enter: (name: string, avatar: AvatarProfileV1) => void;
  reconnecting?: boolean | undefined;
}) {
  const [name, setName] = useState(() => localStorage.getItem("daifugo-player-name") ?? "");
  const [nameError, setNameError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (reconnecting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("プレイヤー名を入力してください");
      return;
    }
    setNameError("");
    localStorage.setItem("daifugo-player-name", trimmed);
    setAvatar(avatar);
    enter(trimmed, avatar);
  };
  return (
    <main id="main" className="entrance-screen">
      <div className="entrance-visual" aria-hidden="true">
        <SalonScene
          previewAvatar={avatar}
          lowPower={lowPower}
          reducedMotion={app.connection !== "connected"}
        />
      </div>
      <section className="entrance-card">
        <h1>大富豪</h1>
        <form onSubmit={submit} noValidate>
          <label>
            <span>プレイヤー名</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value.slice(0, 12));
                setNameError("");
              }}
              maxLength={12}
              autoComplete="nickname"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "name-error" : undefined}
              placeholder="12文字以内"
            />
          </label>
          {nameError && (
            <p id="name-error" className="inline-error">
              {nameError}
            </p>
          )}
          <button
            className="primary entrance-submit"
            type="submit"
            disabled={app.phase === "AUTHENTICATING" || reconnecting}
          >
            {app.phase === "AUTHENTICATING"
              ? "認証中…"
              : reconnecting
                ? "部屋へ再接続中…"
                : "サロンへ入る"}
          </button>
        </form>
        <button type="button" className="secondary" disabled={reconnecting} onClick={openEditor}>
          アバターを仕立てる
        </button>
        {app.error && (
          <p className="inline-error" role="alert">
            {app.error}
          </p>
        )}
        <div className="quiet-settings">
          <ConnectionBadge state={app.connection} />
          <label>
            <input
              type="checkbox"
              checked={lowPower}
              onChange={(event) => setLowPower(event.target.checked)}
            />
            低負荷
          </label>
          <label>
            <input
              type="checkbox"
              checked={muted}
              onChange={(event) => setMuted(event.target.checked)}
            />
            消音
          </label>
          <button type="button" className="quiet-link" onClick={openRules}>
            利用規約・ルール
          </button>
        </div>
      </section>
    </main>
  );
}
