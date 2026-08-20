import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../app/model";

export interface DanmakuSchedule {
  lane: number;
  startsAt: number;
  durationMs: number;
  laneReadyAt: number;
}

export function allocateDanmakuLane(
  laneReadyAt: readonly number[],
  now: number,
  textLength: number,
  viewportWidth: number,
): DanmakuSchedule {
  const earliest = Math.min(...laneReadyAt);
  const lane = Math.max(0, laneReadyAt.indexOf(earliest));
  const startsAt = Math.max(now, earliest);
  const durationMs = Math.max(6_500, Math.min(12_000, viewportWidth * 9 + textLength * 95));
  // The next comment waits until the current one's tail has cleared the right edge.
  const launchGap = Math.max(850, Math.min(3_000, textLength * 72));
  return { lane, startsAt, durationMs, laneReadyAt: startsAt + launchGap };
}

interface FlyingComment {
  key: string;
  text: string;
  label: string;
  lane: number;
  delayMs: number;
  durationMs: number;
}

export function CommentDanmaku({
  comments,
  lowPower,
  reducedMotion,
}: {
  comments: NonNullable<RoomView["chat"]>;
  lowPower: boolean;
  reducedMotion: boolean;
}) {
  const [active, setActive] = useState<FlyingComment[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const laneReadyAt = useRef<number[]>([]);
  const laneCount = reducedMotion ? 1 : lowPower ? 2 : 5;
  useEffect(() => {
    if (!initialized.current) {
      comments.forEach((comment) => seen.current.add(comment.id));
      laneReadyAt.current = Array.from({ length: laneCount }, () => 0);
      initialized.current = true;
      return;
    }
    if (laneReadyAt.current.length !== laneCount)
      laneReadyAt.current = Array.from({ length: laneCount }, () => 0);
    const incoming = comments.filter((comment) => !seen.current.has(comment.id));
    if (!incoming.length) return;
    const now = Date.now();
    const width = window.visualViewport?.width ?? window.innerWidth;
    const scheduled = incoming.map((comment) => {
      seen.current.add(comment.id);
      const plan = allocateDanmakuLane(
        laneReadyAt.current,
        now,
        Array.from(comment.text).length,
        width,
      );
      laneReadyAt.current[plan.lane] = plan.laneReadyAt;
      return {
        key: `${comment.id}-${now}`,
        text: comment.text,
        label: comment.name,
        lane: plan.lane,
        delayMs: Math.max(0, plan.startsAt - now),
        durationMs: plan.durationMs,
      };
    });
    setActive((current) => [...current, ...scheduled].slice(-24));
    const latest = incoming.at(-1);
    if (latest) setAnnouncement(`${latest.name}: ${latest.text}`);
  }, [comments, laneCount]);
  return (
    <aside
      className={`comment-danmaku ${reducedMotion ? "static" : ""} ${lowPower ? "low-power" : ""}`}
      aria-label="流れるコメント"
    >
      <div aria-hidden="true">
        {active.map((comment) => (
          <span
            key={comment.key}
            className="danmaku-comment"
            style={
              {
                "--danmaku-lane": comment.lane,
                "--danmaku-delay": `${comment.delayMs}ms`,
                "--danmaku-duration": `${comment.durationMs}ms`,
              } as React.CSSProperties
            }
            onAnimationEnd={() =>
              setActive((current) => current.filter((item) => item.key !== comment.key))
            }
          >
            <strong>{comment.label}</strong> {comment.text}
          </span>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </aside>
  );
}
