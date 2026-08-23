import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "../screens/GameScreen";

function Countdown({ deadline }: { deadline?: number }) {
  return <output>{useCountdown(deadline)}</output>;
}

describe("game countdown scheduling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not keep rerendering when the room has no active deadline", () => {
    const schedule = vi.spyOn(window, "setTimeout");
    const { rerender } = render(<Countdown />);
    expect(schedule).not.toHaveBeenCalled();

    rerender(<Countdown deadline={Date.now() + 30_000} />);
    expect(schedule).toHaveBeenCalledTimes(1);

    rerender(<Countdown />);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
