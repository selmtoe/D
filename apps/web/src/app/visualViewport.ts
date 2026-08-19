import { useEffect, useState } from "react";

export interface ViewportMetrics {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  keyboardInset: number;
  orientation: "portrait" | "landscape";
}

type ViewportWindow = Pick<Window, "innerWidth" | "innerHeight" | "visualViewport">;

export function measureViewport(source: ViewportWindow = window): ViewportMetrics {
  const viewport = source.visualViewport;
  const width = viewport?.width ?? source.innerWidth;
  const height = viewport?.height ?? source.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  const offsetLeft = viewport?.offsetLeft ?? 0;
  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    scale: viewport?.scale ?? 1,
    keyboardInset: Math.max(0, source.innerHeight - height - offsetTop),
    orientation: width > height ? "landscape" : "portrait",
  };
}

export function applyViewportCss(
  metrics: ViewportMetrics,
  root: HTMLElement = document.documentElement,
) {
  root.style.setProperty("--visual-viewport-width", `${metrics.width}px`);
  root.style.setProperty("--visual-viewport-height", `${metrics.height}px`);
  root.style.setProperty("--visual-viewport-offset-top", `${metrics.offsetTop}px`);
  root.style.setProperty("--visual-viewport-offset-left", `${metrics.offsetLeft}px`);
  root.style.setProperty("--visual-viewport-scale", String(metrics.scale));
  root.style.setProperty("--keyboard-inset", `${metrics.keyboardInset}px`);
  root.dataset.viewportOrientation = metrics.orientation;
  root.dataset.keyboardOpen = String(metrics.keyboardInset > 80);
}

export function useVisualViewport(): ViewportMetrics {
  const [metrics, setMetrics] = useState(measureViewport);
  useEffect(() => {
    const update = () => {
      const next = measureViewport();
      applyViewportCss(next);
      setMetrics(next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  return metrics;
}
