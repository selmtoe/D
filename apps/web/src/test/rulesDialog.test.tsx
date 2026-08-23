import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesDialog } from "../components/RulesDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("rules dialog lifecycle", () => {
  it("keeps one keyboard listener while using the latest close callback", () => {
    const listen = vi.spyOn(window, "addEventListener");
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(<RulesDialog onClose={firstClose} />);

    rerender(<RulesDialog onClose={latestClose} />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(listen.mock.calls.filter(([eventName]) => eventName === "keydown")).toHaveLength(1);
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });
});
