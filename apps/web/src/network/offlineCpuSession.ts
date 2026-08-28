import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import type { RoomView } from "../app/model";
import type { CueEvent } from "./peerCues";
import { SparkAuthority, type SparkMember } from "./sparkAuthority";

const CPU_TICK_MS = 900;
const DEFAULT_CPU_COUNT = 3;

function localRoomId(): string {
  const suffix = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .padStart(2, "0")
    .toUpperCase();
  return `CPU${suffix}`;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * An in-memory room authority for one browser. It exposes the same surface as
 * SparkP2PSession so every waiting/game/result screen stays on the production
 * RoomView and command paths while Firebase and WebRTC remain completely idle.
 */
export class OfflineCpuSession {
  readonly localOnly = true;
  readonly roomId: string;
  readonly uid: string;
  private readonly authority: SparkAuthority;
  private readonly viewListeners = new Set<(view: RoomView) => void>();
  private readonly cueListeners = new Set<(cue: CueEvent, senderUid: string) => void>();
  private readonly evictionListeners = new Set<(reason: "kick" | "room-closed") => void>();
  private readonly modeListeners = new Set<(mode: "webrtc" | "firebase" | "offline") => void>();
  private lastView: RoomView;
  private stopped = false;
  private commandQueue: Promise<unknown> = Promise.resolve();
  private readonly cpuInterval: ReturnType<typeof setInterval>;

  private constructor(profile: { name: string; avatar: AvatarProfileV1 }, cpuCount: number) {
    this.roomId = localRoomId();
    this.uid = `local-player-${crypto.randomUUID()}`;
    const peerId = `local-peer-${crypto.randomUUID()}`;
    this.authority = SparkAuthority.create(this.roomId, this.uid, peerId, profile);
    for (let index = 0; index < cpuCount; index += 1) {
      this.authority.handleCommand(this.uid, "addCpu", {
        clientActionId: `local-cpu-${index}-${crypto.randomUUID()}`,
      });
    }
    this.lastView = this.project();
    this.cpuInterval = setInterval(() => void this.tick(), CPU_TICK_MS);
  }

  static create(
    profile: { name: string; avatar: AvatarProfileV1 },
    cpuCount = DEFAULT_CPU_COUNT,
  ): OfflineCpuSession {
    return new OfflineCpuSession(profile, Math.min(5, Math.max(2, Math.trunc(cpuCount))));
  }

  private project(): RoomView {
    return { ...this.authority.project(this.uid), localOnly: true };
  }

  private publishView(): void {
    this.lastView = this.project();
    this.viewListeners.forEach((listener) => listener(copy(this.lastView)));
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const queued = this.commandQueue.then(operation, operation);
    this.commandQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    await this.enqueue(() => {
      if (this.stopped) return;
      const now = Date.now();
      if (this.authority.advanceCpu(now)) {
        this.publishView();
        return;
      }
      const snapshot = this.authority.exportSnapshot();
      if (
        snapshot.turnDeadlineMs &&
        snapshot.turnDeadlineMs <= now &&
        this.authority.timeoutCurrent(now)
      ) {
        this.publishView();
      }
    });
  }

  async sendCommand(
    name: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.enqueue(() => {
      if (this.stopped) throw new Error("offline: CPU部屋は終了しています");
      const withAction = {
        ...payload,
        clientActionId:
          typeof payload.clientActionId === "string" ? payload.clientActionId : crypto.randomUUID(),
      };
      const result = this.authority.handleCommand(this.uid, name, withAction);
      if (name !== "leaveRoom") this.publishView();
      return result;
    });
  }

  async sendCue(cue: CueEvent): Promise<void> {
    if (this.stopped) throw new Error("offline: CPU部屋は終了しています");
    this.cueListeners.forEach((listener) => listener(copy(cue), this.uid));
  }

  async sendCueDirect(cue: CueEvent): Promise<boolean> {
    await this.sendCue(cue);
    return true;
  }

  onView(listener: (view: RoomView) => void): () => void {
    this.viewListeners.add(listener);
    const view = copy(this.lastView);
    queueMicrotask(() => {
      if (this.viewListeners.has(listener)) listener(view);
    });
    return () => this.viewListeners.delete(listener);
  }

  onCue(listener: (cue: CueEvent, senderUid: string) => void): () => void {
    this.cueListeners.add(listener);
    return () => this.cueListeners.delete(listener);
  }

  onEvicted(listener: (reason: "kick" | "room-closed") => void): () => void {
    this.evictionListeners.add(listener);
    return () => this.evictionListeners.delete(listener);
  }

  onMode(listener: (mode: "webrtc" | "firebase" | "offline") => void): () => void {
    this.modeListeners.add(listener);
    queueMicrotask(() => {
      if (this.modeListeners.has(listener)) listener("webrtc");
    });
    return () => this.modeListeners.delete(listener);
  }

  currentMode(): "webrtc" {
    return "webrtc";
  }

  currentView(): RoomView {
    return copy(this.lastView);
  }

  currentMember(): SparkMember | undefined {
    return this.authority.member(this.uid);
  }

  async stop(_markOffline = true): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.cpuInterval);
    this.viewListeners.clear();
    this.cueListeners.clear();
    this.evictionListeners.clear();
    this.modeListeners.clear();
  }
}
