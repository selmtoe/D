import type { PublicRoom, RoomView } from "../app/model";

type E2ERequest = {
  op: "command" | "presence" | "publicRooms" | "roomBase" | "roomView";
  name?: string;
  payload?: Record<string, unknown>;
  roomId?: string;
  uid?: string;
};

type E2EBridge = {
  uid: string;
  call: (request: E2ERequest) => Promise<unknown>;
};

declare global {
  interface Window {
    __DAIFUGO_E2E__?: E2EBridge;
  }
}

function bridge(): E2EBridge | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  return window.__DAIFUGO_E2E__;
}

export function isE2ETransport(): boolean {
  return bridge() !== undefined;
}

export function e2eViewerUid(): string | undefined {
  return bridge()?.uid;
}

export async function e2eCall<T>(request: E2ERequest): Promise<T> {
  const current = bridge();
  if (!current) throw new Error("E2E transport is not installed");
  return (await current.call(request)) as T;
}

function poll<T>(
  request: E2ERequest,
  version: (value: T) => string,
  onValue: (value: T) => void,
  onError: (error: Error) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = "";
  const tick = async () => {
    try {
      const value = await e2eCall<T>(request);
      if (stopped) return;
      const next = version(value);
      if (next !== previous) {
        previous = next;
        onValue(value);
      }
      timer = setTimeout(tick, 75);
    } catch (cause) {
      if (!stopped) onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function subscribeE2ERoomView(
  roomId: string,
  uid: string,
  onView: (view: RoomView) => void,
  onError: (error: Error) => void,
): () => void {
  return poll<RoomView>(
    { op: "roomView", roomId, uid },
    (view) => `${view.revision}:${view.focusedPlayerId ?? ""}`,
    onView,
    onError,
  );
}

export function subscribeE2EPublicRooms(
  onRooms: (rooms: PublicRoom[]) => void,
  onError: (error: Error) => void,
): () => void {
  return poll<PublicRoom[]>(
    { op: "publicRooms" },
    (rooms) => JSON.stringify(rooms),
    onRooms,
    onError,
  );
}
