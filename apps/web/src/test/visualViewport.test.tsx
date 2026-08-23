import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyViewportCss,
  measureViewport,
  useVisualViewport,
  type ViewportMetrics,
} from "../app/visualViewport";

class FakeVisualViewport extends EventTarget {
  width = 390;
  height = 500;
  offsetTop = 18;
  offsetLeft = 2;
  scale = 1;
}

const originalViewport = window.visualViewport;

afterEach(() => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: originalViewport,
  });
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.keyboardOpen;
  delete document.documentElement.dataset.viewportOrientation;
});

describe("visual viewport", () => {
  it("measures offsets, orientation and software keyboard inset", () => {
    const metrics = measureViewport({
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: {
        width: 390,
        height: 500,
        offsetTop: 18,
        offsetLeft: 2,
        scale: 1,
      } as VisualViewport,
    });
    expect(metrics).toEqual({
      width: 390,
      height: 500,
      offsetTop: 18,
      offsetLeft: 2,
      scale: 1,
      keyboardInset: 326,
      orientation: "portrait",
    });
  });

  it("publishes all metrics as CSS state", () => {
    const metrics: ViewportMetrics = {
      width: 812,
      height: 375,
      offsetTop: 4,
      offsetLeft: 7,
      scale: 1.25,
      keyboardInset: 90,
      orientation: "landscape",
    };
    applyViewportCss(metrics);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--visual-viewport-width")).toBe("812px");
    expect(style.getPropertyValue("--visual-viewport-height")).toBe("375px");
    expect(style.getPropertyValue("--visual-viewport-offset-top")).toBe("4px");
    expect(style.getPropertyValue("--visual-viewport-offset-left")).toBe("7px");
    expect(style.getPropertyValue("--visual-viewport-scale")).toBe("1.25");
    expect(style.getPropertyValue("--keyboard-inset")).toBe("90px");
    expect(document.documentElement.dataset.keyboardOpen).toBe("true");
    expect(document.documentElement.dataset.viewportOrientation).toBe("landscape");
  });

  it("reacts to visual viewport resize and scroll", () => {
    const viewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const { result } = renderHook(() => useVisualViewport());
    act(() => {
      viewport.height = 420;
      viewport.offsetTop = 31;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current.height).toBe(420);
    expect(result.current.offsetTop).toBe(31);
    expect(document.documentElement.style.getPropertyValue("--visual-viewport-height")).toBe(
      "420px",
    );
    act(() => {
      viewport.offsetLeft = 11;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.offsetLeft).toBe(11);
    act(() => {
      viewport.width = 760;
      viewport.height = 360;
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(result.current.orientation).toBe("landscape");
    expect(document.documentElement.dataset.viewportOrientation).toBe("landscape");
  });

  it("retains state identity for duplicate browser viewport notifications", () => {
    const viewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const { result } = renderHook(() => useVisualViewport());
    const measured = result.current;

    act(() => viewport.dispatchEvent(new Event("resize")));

    expect(result.current).toBe(measured);
  });
});
