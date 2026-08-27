import { useEffect, useRef } from "react";
import type { PersonalSettings } from "../app/browserStorage";

export function PersonalSettingsDialog({
  settings,
  close,
  change,
}: {
  settings: PersonalSettings;
  close: () => void;
  change: (settings: PersonalSettings) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(close);
  closeRef.current = close;

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
      const first = nodes[0];
      const last = nodes.at(-1);
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, []);

  const update = (next: Partial<PersonalSettings>) => change({ ...settings, ...next });

  return (
    <div
      className="modal-backdrop personal-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        className="personal-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-settings-title"
        aria-describedby="personal-settings-description"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">この端末の設定</p>
            <h2 id="personal-settings-title">個人設定</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="個人設定を閉じる"
          >
            ×
          </button>
        </header>
        <p id="personal-settings-description" className="personal-settings-description">
          この端末にだけ保存されます。部屋のルールやほかのプレイヤーには影響しません。
        </p>

        <div className="personal-settings-list">
          <label className="personal-setting-row">
            <span>
              <strong>出せる札がない時に自動パス</strong>
              <small>自分の手番で、合法手が1枚もない場合だけ動作します。</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoPass}
              onChange={(event) => update({ autoPass: event.target.checked })}
            />
          </label>

          <fieldset className="personal-setting-delay" disabled={!settings.autoPass}>
            <legend>自動パスまでの時間</legend>
            <label>
              <input
                type="radio"
                name="auto-pass-delay"
                value="instant"
                checked={settings.autoPassDelay === "instant"}
                onChange={() => update({ autoPassDelay: "instant" })}
              />
              <span>
                <strong>すぐにパス</strong>
                <small>待ち時間なし</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="auto-pass-delay"
                value="random"
                checked={settings.autoPassDelay === "random"}
                onChange={() => update({ autoPassDelay: "random" })}
              />
              <span>
                <strong>ランダムに待つ</strong>
                <small>毎回0〜5秒</small>
              </span>
            </label>
          </fieldset>

          <label className="personal-setting-row">
            <span>
              <strong>出せないカードを暗くする</strong>
              <small>オフでも、出せない組み合わせは場に出せません。</small>
            </span>
            <input
              type="checkbox"
              checked={settings.dimUnplayableCards}
              onChange={(event) => update({ dimUnplayableCards: event.target.checked })}
            />
          </label>

          <label className="personal-setting-row">
            <span>
              <strong>手札を自動整列</strong>
              <small>弱い札から強い札へ並べます。オフでは配られた順を保ちます。</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoSortHand}
              onChange={(event) => update({ autoSortHand: event.target.checked })}
            />
          </label>
        </div>

        <footer>
          <button type="button" className="primary" onClick={close}>
            完了
          </button>
        </footer>
      </section>
    </div>
  );
}
