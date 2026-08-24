import { useEffect, useState } from "react";
import type { AppPhase } from "./model";

type PwaUpdater = () => Promise<void>;

let updatePending = false;
let updateApplying = false;
let applyUpdate: PwaUpdater | undefined;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function configurePwaUpdater(updater: PwaUpdater): void {
  applyUpdate = updater;
}

export function markPwaUpdatePending(): void {
  updatePending = true;
  notifyListeners();
}

export function canApplyPwaUpdate(phase: AppPhase, busy: boolean, hasActiveRoom: boolean): boolean {
  return phase === "SALON_LOBBY" && !busy && !hasActiveRoom;
}

async function applyPendingPwaUpdate(): Promise<void> {
  if (!updatePending || updateApplying || !applyUpdate) return;
  updatePending = false;
  updateApplying = true;
  notifyListeners();
  try {
    await applyUpdate();
  } finally {
    updateApplying = false;
  }
}

export function useApplyPwaUpdateWhenSafe(safe: boolean): void {
  const [pending, setPending] = useState(updatePending);
  useEffect(() => {
    const listener = () => setPending(updatePending);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (safe && pending) void applyPendingPwaUpdate();
  }, [pending, safe]);
}
