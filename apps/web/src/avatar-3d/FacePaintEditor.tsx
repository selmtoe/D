import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FACE_PAINT_LIMITS,
  type FacePaintLayer,
  type FacePaintStroke,
} from "@daifugo/avatar-schema";
import {
  appendFacePaintStroke,
  canAddFacePaintPoint,
  drawFacePaintLayer,
  normalizedFacePaintPoint,
  undoFacePaintStroke,
} from "./facePaint";

const PAINT_COLORS = ["#bc2942", "#f1bb41", "#197f77", "#3568bd", "#7d3aa8", "#f7f2df"];
const CANVAS_SIZE = 512;

export function FacePaintEditor({
  layer,
  skinColor,
  onChange,
}: {
  layer: FacePaintLayer | undefined;
  skinColor: string;
  onChange: (layer: FacePaintLayer | undefined) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<FacePaintStroke | null>(null);
  const [color, setColor] = useState(PAINT_COLORS[0]!);
  const [width, setWidth] = useState(0.035);
  const [eraser, setEraser] = useState(false);
  const [status, setStatus] = useState("顔の上を指またはマウスで描けます");

  const render = (active?: FacePaintStroke) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawFacePaintLayer(
      context,
      layer,
      { x: 0, y: 0, width: canvas.width, height: canvas.height },
      active,
    );
  };

  useEffect(() => render(), [layer]);

  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return normalizedFacePaintPoint(
      bounds.width ? (event.clientX - bounds.left) / bounds.width : 0.5,
      bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5,
    );
  };

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if ((layer?.strokes.length ?? 0) >= FACE_PAINT_LIMITS.maxStrokes) {
      setStatus(`線は${FACE_PAINT_LIMITS.maxStrokes}本までです。取り消してから描いてください`);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStroke.current = {
      mode: eraser ? "erase" : "paint",
      color,
      width,
      points: [pointFor(event)],
    };
    render(activeStroke.current);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current;
    if (!stroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (!canAddFacePaintPoint(layer, stroke.points.length)) return;
    const next = pointFor(event);
    const previous = stroke.points.at(-1)!;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.006) return;
    stroke.points.push(next);
    render(stroke);
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current;
    if (!stroke) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    activeStroke.current = null;
    try {
      const next = appendFacePaintStroke(layer, stroke);
      onChange(next);
      setStatus(
        `${eraser ? "消去" : "描画"}を1本追加しました（${next.strokes.length}/${FACE_PAINT_LIMITS.maxStrokes}）`,
      );
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "描画を保存できませんでした");
      render();
    }
  };

  return (
    <section className="face-paint-editor" aria-labelledby="face-paint-title">
      <div className="face-paint-heading">
        <div>
          <h3 id="face-paint-title">フェイスペイント</h3>
          <p>顔の正面へ描画します。1本ごとに安全な座標列として保存されます。</p>
        </div>
        <output aria-live="polite">
          {layer?.strokes.length ?? 0}/{FACE_PAINT_LIMITS.maxStrokes} 本
        </output>
      </div>
      <div className="face-paint-surface" style={{ "--paint-skin": skinColor } as CSSProperties}>
        <span className="face-paint-guide" aria-hidden="true">
          ••⌒
        </span>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          aria-label="顔へペイントする描画領域"
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
      <div className="face-paint-tools">
        <div className="face-paint-colors" role="listbox" aria-label="ペイント色">
          {PAINT_COLORS.map((paintColor, index) => (
            <button
              key={paintColor}
              type="button"
              role="option"
              aria-label={`ペイント色 ${index + 1}`}
              aria-selected={!eraser && color === paintColor}
              style={{ backgroundColor: paintColor }}
              onClick={() => {
                setColor(paintColor);
                setEraser(false);
              }}
            />
          ))}
          <label className="face-paint-custom-color">
            <span>自由色</span>
            <input
              type="color"
              aria-label="フェイスペイントの自由色"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
                setEraser(false);
              }}
            />
          </label>
        </div>
        <label className="face-paint-width">
          <span>太さ {Math.round(width * 1000)}</span>
          <input
            type="range"
            aria-label="フェイスペイントの太さ"
            min={FACE_PAINT_LIMITS.minWidth * 1000}
            max={FACE_PAINT_LIMITS.maxWidth * 1000}
            step="2"
            value={width * 1000}
            onChange={(event) => setWidth(Number(event.target.value) / 1000)}
          />
        </label>
        <div className="face-paint-actions">
          <button type="button" aria-pressed={eraser} onClick={() => setEraser((value) => !value)}>
            {eraser ? "消しゴム中" : "消しゴム"}
          </button>
          <button
            type="button"
            disabled={!layer?.strokes.length}
            onClick={() => {
              onChange(undoFacePaintStroke(layer));
              setStatus("最後の1本を取り消しました");
            }}
          >
            1本戻す
          </button>
          <button
            type="button"
            disabled={!layer?.strokes.length}
            onClick={() => {
              onChange(undefined);
              setStatus("フェイスペイントをすべて消しました");
            }}
          >
            すべて消す
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
