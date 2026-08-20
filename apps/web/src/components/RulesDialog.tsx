import { useEffect, useRef } from "react";

export function RulesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    document.body.classList.add("modal-open");
    dialog.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])",
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
    addEventListener("keydown", handler);
    return () => {
      document.body.classList.remove("modal-open");
      removeEventListener("keydown", handler);
      previousFocus.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        className="rules-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        tabIndex={-1}
        ref={dialog}
      >
        <header>
          <h2 id="rules-title">ルールブック要約</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="ルールブックを閉じる"
          >
            ×
          </button>
        </header>
        <div className="rules-content">
          <p>3〜6人、Joker 2枚を含む54枚で遊びます。最初は実物のダイヤ3を含めて出します。</p>
          <h3>強さと出し方</h3>
          <p>
            通常は3から2、最後に素のJoker。革命とJバックはXORで反転します。組は同ランク、階段は同一スートの3枚以上です。
          </p>
          <h3>主な効果</h3>
          <p>
            A奪い、4リバース、5スキップ、6ろくろ首、7渡し、8切り、9救急車、10捨て、Jバック、Qボンバー、K回収があります。階段ではK回収を最初、8切りを最後に解決します。
          </p>
          <h3>ブラインド</h3>
          <p>
            自分のブラインド札だけ中身が見えません。失敗すると即失格です。移動したブラインド札は表向き通常札になります。
          </p>
          <h3>上がり</h3>
          <p>全効果解決後に判定します。非階段で2またはJokerだけを最後に出すと禁止上がりです。</p>
          <h3>利用について</h3>
          <p>
            表示名とアバター、対局・チャット内容をオンライン対局の提供に利用します。身内向けP2P版のため、改造クライアントへの不正防止は保証しません。チャットへ個人情報を書かないでください。
          </p>
          <p>
            部屋ホストのブラウザはリポジトリの <code>docs/DAIFUGO_RULEBOOK.md</code>
            を正本として判定します。
          </p>
        </div>
        <footer>
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}
