import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import "./first-person-touch-controls.css";

export type FirstPersonTouchMovement = {
  forward: number;
  right: number;
};

export function FirstPersonTouchControls({
  onMove,
  onJump,
  label = "移動操作",
}: {
  onMove: (movement: FirstPersonTouchMovement) => void;
  onJump: () => void;
  label?: string;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const activePointer = useRef<number | undefined>(undefined);

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pad.current || activePointer.current !== event.pointerId) return;
    const box = pad.current.getBoundingClientRect();
    const radius = Math.max(1, box.width * 0.34);
    const rawX = event.clientX - (box.left + box.width / 2);
    const rawY = event.clientY - (box.top + box.height / 2);
    const scale = Math.min(1, radius / Math.max(radius, Math.hypot(rawX, rawY)));
    const x = rawX * scale;
    const y = rawY * scale;
    onMove({ right: x / radius, forward: -y / radius });
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`;
    event.stopPropagation();
  };

  const reset = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && activePointer.current !== event.pointerId) return;
    activePointer.current = undefined;
    onMove({ right: 0, forward: 0 });
    if (knob.current) knob.current.style.transform = "translate(0, 0)";
    event?.stopPropagation();
  };

  return (
    <div className="first-person-touch-controls" aria-label={label}>
      <div
        ref={pad}
        className="first-person-movement-pad"
        role="group"
        aria-label="移動パッド"
        onPointerDown={(event) => {
          activePointer.current = event.pointerId;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic test pointers and older webviews may not expose native capture.
          }
          update(event);
        }}
        onPointerMove={update}
        onPointerUp={reset}
        onPointerCancel={reset}
        onLostPointerCapture={reset}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="first-person-pad-arrow up" aria-hidden="true">
          ▲
        </span>
        <span className="first-person-pad-arrow right" aria-hidden="true">
          ▶
        </span>
        <span className="first-person-pad-arrow down" aria-hidden="true">
          ▼
        </span>
        <span className="first-person-pad-arrow left" aria-hidden="true">
          ◀
        </span>
        <span ref={knob} className="first-person-pad-knob" aria-hidden="true" />
      </div>
      <button
        type="button"
        className="first-person-jump-button"
        aria-label="ジャンプ"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onJump();
        }}
      >
        ジャンプ
      </button>
    </div>
  );
}
