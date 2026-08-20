import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommentDanmaku } from "../screens/CommentDanmaku";

const message = {
  id: "chat-1",
  uid: "viewer-2",
  name: "観戦者",
  role: "spectator" as const,
  text: "ナイスプレイ！",
  atMs: 100,
};

describe("comment danmaku accessibility", () => {
  it("keeps moving text visual-only and announces a new comment once", () => {
    const { rerender, container } = render(
      <CommentDanmaku comments={[]} lowPower={false} reducedMotion={false} />,
    );
    rerender(<CommentDanmaku comments={[message]} lowPower={false} reducedMotion={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("観戦者: ナイスプレイ！");
    const visual = container.querySelector(".danmaku-comment");
    expect(visual?.parentElement).toHaveAttribute("aria-hidden", "true");
    if (visual) fireEvent.animationEnd(visual);
    expect(container.querySelector(".danmaku-comment")).toBeNull();
  });

  it("uses a static low-power lane when motion is reduced", () => {
    const { rerender, container } = render(<CommentDanmaku comments={[]} lowPower reducedMotion />);
    rerender(<CommentDanmaku comments={[message]} lowPower reducedMotion />);
    expect(container.querySelector(".comment-danmaku")).toHaveClass("static", "low-power");
  });
});
