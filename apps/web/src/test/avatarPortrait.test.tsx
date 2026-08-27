import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { canvasCameraProps } = vi.hoisted(() => ({ canvasCameraProps: [] as unknown[] }));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ camera }: { camera: unknown }) => {
    canvasCameraProps.push(camera);
    return <div data-testid="portrait-canvas" />;
  },
}));
vi.mock("../avatar-3d/Avatar3D", () => ({
  Avatar3D: () => null,
}));

import { AvatarPortrait } from "../avatar-3d/AvatarPortrait";

afterEach(() => {
  cleanup();
  canvasCameraProps.length = 0;
});

describe("avatar portrait framing", () => {
  it("aims straight through the head instead of letting R3F tilt the camera at the origin", async () => {
    render(<AvatarPortrait profile={defaultAvatar} label="テストのアバター" />);

    expect(await screen.findByTestId("portrait-canvas")).toBeVisible();
    expect(canvasCameraProps.at(-1)).toMatchObject({
      position: [0, 1.78, 4.2],
      rotation: [0, 0, 0],
      fov: 34,
    });
  });
});
