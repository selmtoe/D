import { Object3D } from "three";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WebXrSessionButton,
  detectImmersiveVrSupport,
  webXrErrorMessage,
  xrActionFromObject,
} from "../game-3d/WebXrControls";

const secureContextDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const navigatorXrDescriptor = Object.getOwnPropertyDescriptor(navigator, "xr");

afterEach(() => {
  vi.restoreAllMocks();
  if (secureContextDescriptor) {
    Object.defineProperty(window, "isSecureContext", secureContextDescriptor);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }
  if (navigatorXrDescriptor) {
    Object.defineProperty(navigator, "xr", navigatorXrDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "xr");
  }
});

describe("WebXR controls", () => {
  it("only reports immersive VR support in a secure context", async () => {
    const isSessionSupported = vi.fn(async () => true);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    await expect(detectImmersiveVrSupport({ isSessionSupported })).resolves.toBe(false);
    expect(isSessionSupported).not.toHaveBeenCalled();

    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    await expect(detectImmersiveVrSupport({ isSessionSupported })).resolves.toBe(true);
    expect(isSessionSupported).toHaveBeenCalledWith("immersive-vr");
  });

  it("finds the nearest XR action declared by an ancestor", () => {
    const action = vi.fn();
    const card = new Object3D();
    const hitArea = new Object3D();
    const pip = new Object3D();
    card.userData.xrAction = action;
    card.add(hitArea);
    hitArea.add(pip);

    expect(xrActionFromObject(pip)).toBe(action);
    xrActionFromObject(pip)?.();
    expect(action).toHaveBeenCalledOnce();
    expect(xrActionFromObject(new Object3D())).toBeUndefined();
  });

  it("translates permission and device failures into Japanese guidance", () => {
    expect(webXrErrorMessage(new DOMException("denied", "NotAllowedError"))).toContain("権限");
    expect(webXrErrorMessage(new DOMException("missing", "NotSupportedError"))).toContain(
      "この端末",
    );
    expect(webXrErrorMessage(new Error("unknown"))).toContain("ヘッドセット");
  });

  it("enters and exits a supported immersive session from the visible button", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    let endListener: (() => void) | undefined;
    const session = {
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === "end") endListener = listener;
      }),
      end: vi.fn(async () => endListener?.()),
    };
    Object.defineProperty(navigator, "xr", {
      configurable: true,
      value: {
        isSessionSupported: vi.fn(async () => true),
        requestSession: vi.fn(async () => session),
      },
    });
    const xr = {
      enabled: false,
      setReferenceSpaceType: vi.fn(),
      setFramebufferScaleFactor: vi.fn(),
      setSession: vi.fn(async () => undefined),
      setFoveation: vi.fn(),
    };
    const onPresentingChange = vi.fn();
    render(
      createElement(WebXrSessionButton, {
        renderer: { xr } as unknown as WebGLRenderer,
        onPresentingChange,
      }),
    );

    const enter = await screen.findByRole("button", { name: "VRで遊ぶ" });
    fireEvent.click(enter);
    await waitFor(() => expect(screen.getByRole("button", { name: "VRを終了" })).toBeEnabled());
    expect(xr.setReferenceSpaceType).toHaveBeenCalledWith("local-floor");
    expect(xr.setSession).toHaveBeenCalledWith(session);
    expect(onPresentingChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "VRを終了" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "VRで遊ぶ" })).toBeEnabled());
    expect(onPresentingChange).toHaveBeenLastCalledWith(false);
  });
});
