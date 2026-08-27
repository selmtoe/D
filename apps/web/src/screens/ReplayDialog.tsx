import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayFrame } from "../app/replay";
import {
  replayElapsedMs,
  replayFrameSummary,
  replayPerspectivePlayerId,
  replayRoomForPerspective,
} from "../app/replay";
import { SalonScene } from "../game-3d/SalonScene";
import { deriveCardMotions, type CardMotionEvent } from "../game-3d/cardMotion";

const SPEEDS = [0.5, 1, 2] as const;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ReplayDialog({
  frames,
  lowPower,
  reducedMotion,
  close,
}: {
  frames: readonly ReplayFrame[];
  lowPower: boolean;
  reducedMotion: boolean;
  close: () => void;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion && frames.length > 1);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [cardMotions, setCardMotions] = useState<CardMotionEvent[]>([]);
  const [perspectivePlayerId, setPerspectivePlayerId] = useState<string>();
  const previousIndex = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const frame = frames[frameIndex] ?? frames[0];
  const elapsed = replayElapsedMs(frames, frameIndex);
  const totalElapsed = replayElapsedMs(frames, Math.max(0, frames.length - 1));
  const resolvedPerspectivePlayerId = frame
    ? replayPerspectivePlayerId(frame, perspectivePlayerId)
    : undefined;
  const replayRoom = useMemo(
    () => (frame ? replayRoomForPerspective(frame, resolvedPerspectivePlayerId) : undefined),
    [frame, resolvedPerspectivePlayerId],
  );

  useEffect(() => {
    playButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!playing || frameIndex >= frames.length - 1) {
      if (frameIndex >= frames.length - 1) setPlaying(false);
      return;
    }
    const currentTime = frames[frameIndex]?.capturedAtMs ?? 0;
    const nextTime = frames[frameIndex + 1]?.capturedAtMs ?? currentTime + 900;
    const delay = Math.min(2_200, Math.max(650, nextTime - currentTime)) / speed;
    const timer = window.setTimeout(() => setFrameIndex((index) => index + 1), delay);
    return () => window.clearTimeout(timer);
  }, [frameIndex, frames, playing, speed]);
  useEffect(() => {
    const previousFrame = frames[previousIndex.current];
    const nextFrame = frames[frameIndex];
    const previous = previousFrame
      ? replayRoomForPerspective(previousFrame, resolvedPerspectivePlayerId)
      : undefined;
    const next = nextFrame
      ? replayRoomForPerspective(nextFrame, resolvedPerspectivePlayerId)
      : undefined;
    const movingForward = frameIndex === previousIndex.current + 1;
    previousIndex.current = frameIndex;
    setCardMotions(previous && next && movingForward ? deriveCardMotions(previous, next) : []);
  }, [frameIndex, frames, resolvedPerspectivePlayerId]);

  const summary = useMemo(() => (frame ? replayFrameSummary(frame) : "記録なし"), [frame]);
  if (!frame || !replayRoom) return null;

  const seek = (index: number) => {
    setFrameIndex(Math.max(0, Math.min(frames.length - 1, index)));
  };

  return (
    <div
      className="replay-backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [
          ...(dialog.current?.querySelectorAll<HTMLElement>("button,input,select") ?? []),
        ].filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <section
        ref={dialog}
        className="replay-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replay-title"
        aria-describedby="replay-description"
      >
        <header>
          <div>
            <p className="eyebrow">対局記録</p>
            <h2 id="replay-title">リプレイ</h2>
          </div>
          <button type="button" onClick={close} aria-label="リプレイを閉じる">
            ×
          </button>
        </header>
        <p id="replay-description" className="replay-description">
          視点を選んで対局を再生できます。他の人の手札は、その人のカードにカーソルを近づけるかタップすると確認できます。記録時に伏せられていた札は後からも公開しません。
        </p>
        <div className="replay-stage" aria-label="3D対局リプレイ">
          <div className="replay-canvas" aria-hidden="true">
            <SalonScene
              room={replayRoom}
              lowPower={lowPower}
              reducedMotion={reducedMotion}
              handReadOnly
              cardMotions={reducedMotion ? [] : cardMotions}
              onCardMotionDone={(id) =>
                setCardMotions((motions) => motions.filter((motion) => motion.id !== id))
              }
            />
          </div>
          <div className="replay-caption" role="status" aria-live="polite">
            <strong>{summary}</strong>
            <span>
              {frameIndex + 1} / {frames.length}
            </span>
          </div>
        </div>
        <div className="replay-timeline">
          <span>{formatElapsed(elapsed)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={frameIndex}
            aria-label="リプレイ位置"
            aria-valuetext={`${frameIndex + 1}手目／${frames.length}手中：${summary}`}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span>{formatElapsed(totalElapsed)}</span>
        </div>
        <footer className="replay-controls">
          <button
            type="button"
            aria-label="1手前"
            disabled={frameIndex === 0}
            onClick={() => {
              setPlaying(false);
              seek(frameIndex - 1);
            }}
          >
            前へ
          </button>
          <button
            ref={playButton}
            type="button"
            className="primary"
            disabled={frames.length <= 1}
            onClick={() => {
              if (frameIndex >= frames.length - 1) seek(0);
              setPlaying((current) => !current || frameIndex >= frames.length - 1);
            }}
          >
            {playing ? "一時停止" : frameIndex >= frames.length - 1 ? "最初から再生" : "再生"}
          </button>
          <button
            type="button"
            aria-label="1手後"
            disabled={frameIndex >= frames.length - 1}
            onClick={() => {
              setPlaying(false);
              seek(frameIndex + 1);
            }}
          >
            次へ
          </button>
          <label>
            視点
            <select
              value={resolvedPerspectivePlayerId ?? ""}
              aria-label="リプレイ視点"
              onChange={(event) => {
                setPlaying(false);
                setPerspectivePlayerId(event.currentTarget.value);
              }}
            >
              {frame.room.players
                .filter((player) => player.present !== false)
                .map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            速度
            <select
              value={speed}
              aria-label="再生速度"
              onChange={(event) => setSpeed(Number(event.currentTarget.value) as typeof speed)}
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}倍
                </option>
              ))}
            </select>
          </label>
        </footer>
      </section>
    </div>
  );
}
