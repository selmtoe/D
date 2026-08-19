import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

export type CueEvent =
  | {
      version: 1;
      type: "emote";
      eventId: string;
      emote: "applause" | "surprise" | "thinking";
      atMs: number;
    }
  | { version: 1; type: "focus"; eventId: string; focusPlayerId: string; atMs: number }
  | {
      version: 1;
      type: "animation";
      eventId: string;
      cue: "play" | "pass" | "flush";
      atMs: number;
    };

const exactKeys: Record<CueEvent["type"], string[]> = {
  emote: ["version", "type", "eventId", "emote", "atMs"],
  focus: ["version", "type", "eventId", "focusPlayerId", "atMs"],
  animation: ["version", "type", "eventId", "cue", "atMs"],
};

export function parseCue(value: unknown): CueEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    item.version !== 1 ||
    !["emote", "focus", "animation"].includes(String(item.type)) ||
    typeof item.eventId !== "string" ||
    typeof item.atMs !== "number"
  )
    return null;
  const type = item.type as CueEvent["type"];
  if (Object.keys(item).some((key) => !exactKeys[type].includes(key))) return null;
  if (type === "emote" && ["applause", "surprise", "thinking"].includes(String(item.emote)))
    return item as CueEvent;
  if (
    type === "focus" &&
    typeof item.focusPlayerId === "string" &&
    item.focusPlayerId.length <= 128
  )
    return item as CueEvent;
  if (type === "animation" && ["play", "pass", "flush"].includes(String(item.cue)))
    return item as CueEvent;
  return null;
}

export function encodeCueWire(cue: CueEvent): { kind: CueEvent["type"]; payload: string } {
  return { kind: cue.type, payload: JSON.stringify(cue) };
}
export function decodeCueWire(value: Record<string, unknown>): CueEvent | null {
  if (typeof value.kind !== "string" || typeof value.payload !== "string") return null;
  try {
    const cue = parseCue(JSON.parse(value.payload));
    return cue?.type === value.kind ? cue : null;
  } catch {
    return null;
  }
}

type Signal = {
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};

function decodeSignal(value: Record<string, unknown>): Signal | null {
  if (
    typeof value.senderUid !== "string" ||
    typeof value.targetUid !== "string" ||
    typeof value.payload !== "string" ||
    !["offer", "answer", "ice"].includes(String(value.kind))
  )
    return null;
  try {
    const payload = JSON.parse(value.payload) as Record<string, unknown>;
    if ((value.kind === "offer" || value.kind === "answer") && typeof payload.sdp === "string")
      return { from: value.senderUid, to: value.targetUid, type: value.kind, sdp: payload.sdp };
    if (value.kind === "ice" && payload.candidate && typeof payload.candidate === "object")
      return {
        from: value.senderUid,
        to: value.targetUid,
        type: "candidate",
        candidate: payload.candidate as RTCIceCandidateInit,
      };
  } catch {
    return null;
  }
  return null;
}

export class PeerCueNetwork {
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly seen = new Set<string>();
  private fallbackOnly = typeof RTCPeerConnection === "undefined";
  constructor(
    private readonly db: Firestore,
    private readonly roomId: string,
    private readonly uid: string,
    private readonly onCue: (cue: CueEvent, sender: string) => void,
    private readonly onMode: (mode: "webrtc" | "firebase" | "offline") => void,
  ) {}

  async start(peerIds: string[]): Promise<void> {
    const startAt = Timestamp.now();
    const signalQuery = query(
      collection(this.db, "webrtcRooms", this.roomId, "signals"),
      where("targetUid", "==", this.uid),
    );
    this.unsubscribes.push(
      onSnapshot(
        signalQuery,
        (snapshot) =>
          snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            if (
              data.createdAt instanceof Timestamp &&
              data.createdAt.toMillis() < startAt.toMillis()
            )
              return;
            const signal = decodeSignal(data);
            if (signal)
              void this.receiveSignal(signal).catch(() => {
                this.fallbackOnly = true;
                this.onMode("firebase");
              });
          }),
        () => {
          this.fallbackOnly = true;
          this.onMode("firebase");
        },
      ),
    );
    const cueQuery = query(
      collection(this.db, "webrtcRooms", this.roomId, "cues"),
      where("createdAt", ">=", startAt),
      orderBy("createdAt", "asc"),
    );
    this.unsubscribes.push(
      onSnapshot(
        cueQuery,
        (snapshot) =>
          snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            const cue = decodeCueWire(data);
            const sender = String(data.senderUid ?? "");
            if (cue && sender !== this.uid && !this.seen.has(cue.eventId)) {
              this.seen.add(cue.eventId);
              this.onCue(cue, sender);
            }
          }),
        () => this.onMode(this.channels.size ? "webrtc" : "offline"),
      ),
    );
    if (this.fallbackOnly) {
      this.onMode("firebase");
      return;
    }
    const boundedPeers = [...new Set(peerIds)]
      .filter((id) => id !== this.uid)
      .sort()
      .slice(0, 5);
    await Promise.all(
      boundedPeers
        .filter((id) => this.uid < id)
        .map((id) =>
          this.offer(id).catch(() => {
            this.fallbackOnly = true;
            this.onMode("firebase");
          }),
        ),
    );
    window.setTimeout(() => {
      if (!this.channels.size) {
        this.fallbackOnly = true;
        this.onMode("firebase");
      }
    }, 6000);
  }

  private peer(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    if (this.peers.size >= 5) throw new Error("peer limit reached");
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peer.onicecandidate = (event) => {
      if (event.candidate)
        void this.signal({
          from: this.uid,
          to: peerId,
          type: "candidate",
          candidate: event.candidate.toJSON(),
        }).catch(() => {
          this.fallbackOnly = true;
          this.onMode("firebase");
        });
    };
    peer.ondatachannel = (event) => this.attachChannel(peerId, event.channel);
    peer.onconnectionstatechange = () => {
      if (
        ["failed", "closed", "disconnected"].includes(peer.connectionState) &&
        !this.channels.size
      ) {
        this.fallbackOnly = true;
        this.onMode("firebase");
      }
    };
    this.peers.set(peerId, peer);
    return peer;
  }

  private attachChannel(peerId: string, channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.channels.set(peerId, channel);
      this.onMode("webrtc");
    };
    channel.onclose = () => {
      this.channels.delete(peerId);
      if (!this.channels.size) this.onMode("firebase");
    };
    channel.onmessage = (event) => {
      try {
        const cue = parseCue(JSON.parse(String(event.data)));
        if (cue && !this.seen.has(cue.eventId)) {
          this.seen.add(cue.eventId);
          this.onCue(cue, peerId);
        }
      } catch {
        /* malformed non-authoritative messages are ignored */
      }
    };
  }

  private async offer(peerId: string): Promise<void> {
    const peer = this.peer(peerId);
    const channel = peer.createDataChannel("daifugo-cues", { ordered: false, maxRetransmits: 1 });
    this.attachChannel(peerId, channel);
    const offer = await peer.createOffer();
    if (!offer.sdp) throw new Error("offer SDP unavailable");
    await peer.setLocalDescription(offer);
    await this.signal({ from: this.uid, to: peerId, type: "offer", sdp: offer.sdp });
  }

  private async receiveSignal(signal: Signal): Promise<void> {
    if (!signal.from || signal.from === this.uid) return;
    const peer = this.peer(signal.from);
    if (signal.type === "offer" && signal.sdp) {
      await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await peer.createAnswer();
      if (!answer.sdp) throw new Error("answer SDP unavailable");
      await peer.setLocalDescription(answer);
      await this.signal({ from: this.uid, to: signal.from, type: "answer", sdp: answer.sdp });
    } else if (signal.type === "answer" && signal.sdp)
      await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    else if (signal.type === "candidate" && signal.candidate)
      await peer.addIceCandidate(signal.candidate);
  }

  private async signal(signal: Signal): Promise<void> {
    const kind = signal.type === "candidate" ? "ice" : signal.type;
    const payload =
      signal.type === "candidate"
        ? JSON.stringify({ candidate: signal.candidate })
        : JSON.stringify({ sdp: signal.sdp });
    await addDoc(collection(this.db, "webrtcRooms", this.roomId, "signals"), {
      senderUid: signal.from,
      targetUid: signal.to,
      kind,
      payload,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
    });
  }

  async send(cue: CueEvent): Promise<boolean> {
    this.seen.add(cue.eventId);
    let sent = false;
    const wire = JSON.stringify(cue);
    if (!this.fallbackOnly)
      for (const channel of this.channels.values())
        if (channel.readyState === "open") {
          channel.send(wire);
          sent = true;
        }
    if (!sent)
      try {
        await addDoc(collection(this.db, "webrtcRooms", this.roomId, "cues"), {
          senderUid: this.uid,
          ...encodeCueWire(cue),
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
        });
        this.onMode("firebase");
        return true;
      } catch {
        this.onMode("offline");
        return false;
      }
    return true;
  }

  close(): void {
    this.unsubscribes.forEach((stop) => stop());
    this.channels.forEach((channel) => channel.close());
    this.peers.forEach((peer) => peer.close());
    this.channels.clear();
    this.peers.clear();
  }
}

export function emoteCue(emote: "applause" | "surprise" | "thinking"): CueEvent {
  return { version: 1, type: "emote", eventId: crypto.randomUUID(), emote, atMs: Date.now() };
}
