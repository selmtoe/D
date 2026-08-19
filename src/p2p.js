const firebaseConfig = {
  apiKey: "AIzaSyD1YdTMESZi-ynMzS_p_hdtr1znBI64RmM",
  authDomain: "daifugo-8e039.firebaseapp.com",
  projectId: "daifugo-8e039",
  storageBucket: "daifugo-8e039.firebasestorage.app",
  messagingSenderId: "979025215319",
  appId: "1:979025215319:web:1bf381daf1eb647760c812",
  measurementId: "G-KSQ8LRN4ZE",
};

let arrayUnion;
let doc;
let getDoc;
let onSnapshot;
let serverTimestamp;
let setDoc;
let updateDoc;
let db;
let firebasePromise;

async function ensureFirebase() {
  if (db) return;
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    ]).then(([appSdk, firestore]) => {
      const app = appSdk.getApps()[0] || appSdk.initializeApp(firebaseConfig);
      ({ arrayUnion, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } = firestore);
      db = firestore.getFirestore(app);
    });
  }
  try {
    await firebasePromise;
  } catch (error) {
    firebasePromise = null;
    throw new Error(`Firebaseへ接続できませんでした。オフラインゲームはそのまま遊べます。（${error.message}）`);
  }
}
const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (value) => codeAlphabet[value % codeAlphabet.length]).join("");
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const field = (peerId, name = "") => `connections.${peerId}${name ? `.${name}` : ""}`;

function emit(target, type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export class P2PTransport extends EventTarget {
  constructor() {
    super();
    this.id = makeId();
    this.role = "offline";
    this.code = null;
    this.player = null;
    this.roomRef = null;
    this.peers = new Map();
    this.unsubscribers = [];
  }

  async host(player) {
    await ensureFirebase();
    this.close();
    this.role = "host";
    this.player = player;
    let available = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      this.code = makeCode();
      this.roomRef = doc(db, "rooms", this.code);
      if (!(await getDoc(this.roomRef)).exists()) { available = true; break; }
    }
    if (!available) throw new Error("空いているルームコードを確保できませんでした。もう一度お試しください。");
    await setDoc(this.roomRef, {
      id: this.code,
      blindCount: 0,
      players: [{ id: this.id, name: player.name, isHost: true, hand: [], order: -1, rank: null }],
      gameState: "p2p",
      field: [],
      discardPile: [],
      roundPile: [],
      lastPlayed: { player: null, cards: [] },
      turnPlayerId: null,
      passCount: 0,
      isRevolution: false,
      isJBackActive: false,
      turnDirection: 1,
      shibariSuits: [],
      pendingActions: [],
      log: [{ timestamp: Date.now(), message: "P2Pルームが作成されました。" }],
      type: "p2p",
      status: "p2p",
      version: 1,
      hostId: this.id,
      host: player,
      connections: {},
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 4,
    });
    this.unsubscribers.push(onSnapshot(this.roomRef, (snapshot) => {
      const connections = snapshot.data()?.connections || {};
      Object.entries(connections).forEach(([peerId, data]) => {
        if (data.status === "joining" && !this.peers.has(peerId)) {
          this.#acceptPeer(peerId, data).catch((error) => emit(this, "error", { error }));
          return;
        }
        const peer = this.peers.get(peerId);
        if (!peer) return;
        this.#consumeCandidates(peer.connection, data.guestCandidates || [], peer.seenGuestCandidates);
        if (data.answer && !peer.answerApplied && !peer.connection.currentRemoteDescription) {
          peer.answerApplied = true;
          peer.connection.setRemoteDescription(new RTCSessionDescription(data.answer)).catch((error) => emit(this, "error", { error }));
        }
      });
    }, (error) => emit(this, "error", { error })));
    emit(this, "state", { state: "hosting", code: this.code });
    return this.code;
  }

  async join(code, player) {
    await ensureFirebase();
    this.close();
    this.role = "guest";
    this.player = player;
    this.code = code.trim().toUpperCase();
    this.roomRef = doc(db, "rooms", this.code);
    const roomSnapshot = await getDoc(this.roomRef);
    if (!roomSnapshot.exists() || roomSnapshot.data().type !== "p2p") throw new Error("ルームが見つかりません。コードを確認してください。");
    const room = roomSnapshot.data();
    if (room.expiresAt && room.expiresAt < Date.now()) throw new Error("このルームは有効期限が切れています。");
    const connection = new RTCPeerConnection(rtcConfiguration);
    const peer = { connection, channel: null, player: room.host, seenHostCandidates: new Set(), offerApplied: false };
    this.peers.set(room.hostId, peer);
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) updateDoc(this.roomRef, { [field(this.id, "guestCandidates")]: arrayUnion(candidate.toJSON()) }).catch((error) => emit(this, "error", { error }));
    };
    connection.ondatachannel = ({ channel }) => this.#bindChannel(room.hostId, channel, room.host);
    this.#bindConnectionState(room.hostId, connection);
    this.unsubscribers.push(onSnapshot(this.roomRef, async (snapshot) => {
      const data = snapshot.data()?.connections?.[this.id];
      if (!data) return;
      this.#consumeCandidates(connection, data.hostCandidates || [], peer.seenHostCandidates);
      if (!peer.offerApplied && data.offer) {
        peer.offerApplied = true;
        await connection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await updateDoc(this.roomRef, {
          [field(this.id, "answer")]: { type: answer.type, sdp: answer.sdp },
          [field(this.id, "status")]: "answering",
        });
      }
    }, (error) => emit(this, "error", { error })));
    await updateDoc(this.roomRef, {
      [field(this.id)]: {
        guestId: this.id,
        player,
        status: "joining",
        hostCandidates: [],
        guestCandidates: [],
        createdAt: Date.now(),
      },
    });
    emit(this, "state", { state: "joining", code: this.code });
    return this.code;
  }

  async #acceptPeer(peerId, data) {
    const connection = new RTCPeerConnection(rtcConfiguration);
    const channel = connection.createDataChannel("game", { ordered: true });
    const peer = { connection, channel, player: data.player, seenGuestCandidates: new Set(), answerApplied: false };
    this.peers.set(peerId, peer);
    this.#bindChannel(peerId, channel, data.player);
    this.#bindConnectionState(peerId, connection);
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) updateDoc(this.roomRef, { [field(peerId, "hostCandidates")]: arrayUnion(candidate.toJSON()) }).catch((error) => emit(this, "error", { error }));
    };
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await updateDoc(this.roomRef, {
      [field(peerId, "offer")]: { type: offer.type, sdp: offer.sdp },
      [field(peerId, "status")]: "offering",
    });
  }

  #consumeCandidates(connection, candidates, seen) {
    candidates.forEach((candidate) => {
      const key = `${candidate.sdpMid}:${candidate.sdpMLineIndex}:${candidate.candidate}`;
      if (seen.has(key)) return;
      seen.add(key);
      connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => emit(this, "error", { error }));
    });
  }

  #bindConnectionState(peerId, connection) {
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      emit(this, "peerstate", { peerId, state });
      if (["failed", "closed", "disconnected"].includes(state)) emit(this, "peerleave", { peerId });
    };
  }

  #bindChannel(peerId, channel, player) {
    const peer = this.peers.get(peerId);
    if (peer) peer.channel = channel;
    channel.onopen = () => {
      emit(this, "peerjoin", { peerId, player });
      emit(this, "state", { state: "connected", code: this.code });
      this.#sendOn(channel, { type: "system-welcome", host: this.role === "host" ? this.player : undefined });
    };
    channel.onclose = () => emit(this, "peerleave", { peerId });
    channel.onerror = (error) => emit(this, "error", { error });
    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        emit(this, "message", { peerId, player, payload });
        if (this.role === "host" && payload.type !== "replay") this.broadcast({ type: "replay", from: peerId, payload }, peerId);
      } catch (error) {
        emit(this, "error", { error });
      }
    };
  }

  #sendOn(channel, payload) {
    if (channel?.readyState === "open") channel.send(JSON.stringify(payload));
  }

  send(payload) {
    if (this.role === "offline") return false;
    if (this.role === "host") return this.broadcast(payload);
    const host = [...this.peers.values()][0];
    this.#sendOn(host?.channel, payload);
    return host?.channel?.readyState === "open";
  }

  broadcast(payload, exceptPeerId = null) {
    let sent = false;
    for (const [peerId, peer] of this.peers) {
      if (peerId === exceptPeerId) continue;
      if (peer.channel?.readyState === "open") {
        this.#sendOn(peer.channel, payload);
        sent = true;
      }
    }
    return sent;
  }

  connectedPlayers() {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.channel?.readyState === "open")
      .map(([id, peer]) => ({ id, ...peer.player }));
  }

  close() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => {
      try { unsubscribe(); } catch { /* already gone */ }
    });
    this.peers.forEach(({ channel, connection }) => {
      try { channel?.close(); } catch { /* already gone */ }
      try { connection?.close(); } catch { /* already gone */ }
    });
    this.peers.clear();
    this.role = "offline";
    this.code = null;
    this.roomRef = null;
    emit(this, "state", { state: "offline" });
  }
}
