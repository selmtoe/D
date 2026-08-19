import {
  PLAYER_ONE,
  YACHT_CATEGORIES,
  applyConnectFourMove,
  applyOthelloMove,
  countOthello,
  createConnectFourState,
  createMemoryState,
  createOthelloState,
  createYachtState,
  getOthelloMoves,
  pickMemoryCard,
  recordYachtScore,
  resolveMemoryMismatch,
  rollYachtDice,
  scoreYachtCategory,
  shuffle,
  toggleYachtHold,
  yachtTotal,
} from "./engines.js";
import { P2PTransport } from "./p2p.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clone = (value) => structuredClone(value);

const profileDefaults = { name: "ゲスト", skin: "#e9b98f", hair: "round", hairColor: "#39271f", eyes: "soft", mouth: "smile", accessory: "none" };
const profileOptions = {
  skin: ["#f4d2b8", "#e9b98f", "#c98961", "#8f5a3c", "#593a2b"],
  hair: [["round", "マッシュ"], ["side", "サイド"], ["spike", "ツンツン"], ["bob", "ボブ"], ["bald", "なし"]],
  hairColor: ["#211b1a", "#39271f", "#75472b", "#d39a52", "#9d3854", "#39527a"],
  eyes: [["soft", "やさしい"], ["bright", "ぱっちり"], ["cool", "クール"], ["wink", "ウインク"]],
  mouth: [["smile", "にっこり"], ["open", "わくわく"], ["calm", "まじめ"], ["cat", "ねこ"]],
  accessory: [["none", "なし"], ["glasses", "メガネ"], ["roundGlasses", "丸メガネ"], ["star", "ほし"]],
};

const games = [
  { id: "daifugo", title: "大富豪", kicker: "2–6 PLAYERS · ONLINE", description: "いまのローカルルールをそのまま受け継ぐ、本館の大富豪。", badge: "ORIGINAL", featured: true, background: "linear-gradient(145deg,#314b47,#182d2c)", visual: '<div class="mini-daifugo"><i>3♠</i><i>2♣</i><i>J♥</i></div>', help: ["大富豪は従来ページで開きます。", "ローカルルールや特殊効果は既存の実装を保持しています。挙動が仕様かバグか曖昧な場合は勝手に変更しません。"] },
  { id: "othello", title: "オセロ", kicker: "2 PLAYERS · P2P", description: "石の重みと反転の手触りを楽しむ、静かな真剣勝負。", badge: "CLASSIC", featured: false, background: "linear-gradient(145deg,#276852,#132f31)", visual: '<div class="mini-board othello"></div>', help: ["黒が先手です。相手の石を縦・横・斜めに挟める場所へ置きます。", "置ける場所がないときは自動でパス。両者とも置けなくなったら石の多い側が勝ちです。"] },
  { id: "connect", title: "コネクトフォー", kicker: "2 PLAYERS · P2P", description: "落として、つなぐ。縦・横・斜めに4枚そろえよう。", badge: "QUICK", featured: false, background: "linear-gradient(145deg,#276bbc,#162f61)", visual: '<div class="mini-board connect"></div>', help: ["赤が先手です。列を選ぶと、チップが一番下の空きマスへ落ちます。", "縦・横・斜めのどれかで、自分の色を4枚連続させたら勝ちです。"] },
  { id: "memory", title: "流星神経衰弱", kicker: "2–8 PLAYERS · P2P", description: "カードがずっと滑り続ける、目と記憶の追いかけっこ。", badge: "CHAOS", featured: true, background: "linear-gradient(145deg,#784c7f,#263b67)", visual: '<div class="mini-memory"><i></i><i></i><i></i><i></i></div>', help: ["動き続けるカードから2枚を選び、同じ絵柄なら1点です。", "ペアを取った人は続けてプレイ。違った場合は次の人へ交代します。最大8人で遊べます。"] },
  { id: "yacht", title: "ヨット", kicker: "2–8 PLAYERS · P2P", description: "5つのダイスを3回まで。みんなで競える本格スコア戦。", badge: "MULTI", featured: true, background: "linear-gradient(145deg,#705637,#263f3c)", visual: '<div class="mini-dice"><i></i><i></i><i></i></div>', help: ["自分の番ではサイコロを3回まで振れます。残したいダイスを押してHOLDしてください。", "12種類から未使用のカテゴリーを1つ選んで得点を記録。全員がすべて埋めたら合計点で勝負します。上段63点以上で35点ボーナスです。"] },
  { id: "hockey", title: "エアホッケー", kicker: "1–2 PLAYERS · P2P", description: "反発、摩擦、衝突。60fpsの物理でパックを打ち返す。", badge: "PHYSICS", featured: false, background: "linear-gradient(145deg,#c4d8e6,#397195)", visual: '<div class="mini-puck"></div>', help: ["マウスまたは指で青いマレットを動かします。オンライン参加者は赤側を担当します。", "先に7点取った側の勝ち。パックは壁とマレットに速度・角度を保って反射します。"] },
  { id: "speed", title: "スピード", kicker: "1–2 PLAYERS · P2P", description: "中央の数字と前後1つ違いのカードを、誰よりも早く。", badge: "FAST", featured: false, background: "linear-gradient(145deg,#495541,#18322b)", visual: '<div class="mini-speed"><i>8♠</i><i>9♥</i></div>', help: ["手札から、中央のどちらかのカードと数字が1つ違うカードを出します。AとKもつながります。", "手札と山札を先になくした側が勝ちです。双方出せない場合は自動で中央をめくります。"] },
];

let profile = loadJSON("atelier-profile", profileDefaults);
let draftProfile = { ...profile };
let transport = new P2PTransport();
let activeGameId = null;
let activeController = null;
let toastTimer = null;

function loadJSON(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch { return { ...fallback }; }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2200);
}

function avatarSvg(config) {
  const hair = {
    round: `<path d="M47 75c4-37 30-53 60-50 31 3 48 25 44 58-13-19-36-29-59-22-19 5-29 12-45 14Z" fill="${config.hairColor}"/>`,
    side: `<path d="M45 80c2-38 29-57 61-54 30 2 47 24 44 55-24-24-57-27-83-7l-22 6Z" fill="${config.hairColor}"/><path d="M49 67c26 8 53-2 70-31-31-7-62 4-70 31Z" fill="${config.hairColor}"/>`,
    spike: `<path d="M47 80 37 49l21 8 5-30 21 18 13-28 14 27 25-21-1 31 25-5-12 33c-27-22-71-23-101-2Z" fill="${config.hairColor}"/>`,
    bob: `<path d="M41 104c-8-48 12-77 53-80 45-3 69 30 59 86l-23-8c8-33-7-50-36-48-26 2-38 20-30 49l-23 1Z" fill="${config.hairColor}"/>`,
    bald: "",
  }[config.hair];
  const eyes = {
    soft: '<path d="M69 92q10-9 20 0" fill="none" stroke="#30251f" stroke-width="4" stroke-linecap="round"/><path d="M111 92q10-9 20 0" fill="none" stroke="#30251f" stroke-width="4" stroke-linecap="round"/>',
    bright: '<ellipse cx="79" cy="91" rx="6" ry="8" fill="#30251f"/><ellipse cx="121" cy="91" rx="6" ry="8" fill="#30251f"/><circle cx="77" cy="88" r="2" fill="white"/><circle cx="119" cy="88" r="2" fill="white"/>',
    cool: '<path d="M69 88l20 3" stroke="#30251f" stroke-width="5" stroke-linecap="round"/><path d="M111 91l20-3" stroke="#30251f" stroke-width="5" stroke-linecap="round"/>',
    wink: '<path d="M68 92q11-10 21 0" fill="none" stroke="#30251f" stroke-width="4" stroke-linecap="round"/><ellipse cx="121" cy="91" rx="6" ry="8" fill="#30251f"/>',
  }[config.eyes];
  const mouth = {
    smile: '<path d="M83 116q17 17 34 0" fill="none" stroke="#8e483f" stroke-width="5" stroke-linecap="round"/>',
    open: '<ellipse cx="100" cy="119" rx="16" ry="12" fill="#8e483f"/><path d="M88 122q12 7 24 0" stroke="#ed8c8c" stroke-width="4"/>',
    calm: '<path d="M88 120h24" stroke="#8e483f" stroke-width="4" stroke-linecap="round"/>',
    cat: '<path d="M80 118q10 12 20 0 10 12 20 0" fill="none" stroke="#8e483f" stroke-width="4" stroke-linecap="round"/>',
  }[config.mouth];
  const accessory = {
    none: "",
    glasses: '<g fill="none" stroke="#29324a" stroke-width="4"><rect x="61" y="80" width="35" height="25" rx="7"/><rect x="104" y="80" width="35" height="25" rx="7"/><path d="M96 88h8M61 87l-12-4M139 87l12-4"/></g>',
    roundGlasses: '<g fill="none" stroke="#4b342b" stroke-width="4"><circle cx="79" cy="91" r="16"/><circle cx="121" cy="91" r="16"/><path d="M95 89h10"/></g>',
    star: '<path d="m142 72 5 9 10 2-7 7 2 11-10-5-10 5 2-11-8-7 11-2Z" fill="#ffd45c" stroke="#b87a20" stroke-width="2"/>',
  }[config.accessory];
  return `<svg viewBox="0 0 200 200" role="img" aria-label="アバター"><defs><linearGradient id="shirt" x2="0" y2="1"><stop stop-color="#748eff"/><stop offset="1" stop-color="#3d4c9d"/></linearGradient></defs><circle cx="100" cy="100" r="98" fill="rgba(255,255,255,.05)"/><path d="M38 200c5-38 30-55 62-55s57 17 62 55" fill="url(#shirt)"/><ellipse cx="100" cy="96" rx="55" ry="64" fill="${config.skin}"/><ellipse cx="47" cy="97" rx="9" ry="16" fill="${config.skin}"/><ellipse cx="153" cy="97" rx="9" ry="16" fill="${config.skin}"/>${hair}${eyes}<path d="M100 94v15" stroke="rgba(92,53,39,.28)" stroke-width="3" stroke-linecap="round"/>${mouth}${accessory}</svg>`;
}

function refreshProfileUi() {
  $("#header-player-name").textContent = profile.name || "ゲスト";
  $("#header-avatar").innerHTML = avatarSvg(profile);
}

function renderGameCards() {
  $("#game-grid").innerHTML = games.map((game) => `
    <button type="button" class="game-card${game.featured ? " featured" : ""}" data-game="${game.id}" style="--game-bg:${game.background}">
      <span class="game-card-badge">${game.badge}</span>
      <span class="game-card-visual">${game.visual}</span>
      <span class="game-card-copy"><small>${game.kicker}</small><strong>${game.title}</strong><p>${game.description}</p></span>
    </button>`).join("");
}

function setupProfileDialog() {
  const render = () => {
    $("#avatar-preview").innerHTML = avatarSvg(draftProfile);
    $("#profile-name").value = draftProfile.name;
    for (const key of ["skin", "hairColor"]) {
      const target = $(`#${key === "hairColor" ? "hair-color" : key}-options`);
      target.innerHTML = profileOptions[key].map((value) => `<button type="button" class="swatch${draftProfile[key] === value ? " selected" : ""}" data-profile-key="${key}" data-value="${value}" style="--swatch:${value}" aria-label="色を選ぶ"></button>`).join("");
    }
    for (const key of ["hair", "eyes", "mouth", "accessory"]) {
      $(`#${key}-options`).innerHTML = profileOptions[key].map(([value, label]) => `<button type="button" class="choice-chip${draftProfile[key] === value ? " selected" : ""}" data-profile-key="${key}" data-value="${value}">${label}</button>`).join("");
    }
  };
  $("#profile-button").addEventListener("click", () => {
    draftProfile = { ...profile };
    render();
    $("#profile-dialog").showModal();
  });
  $("#profile-dialog").addEventListener("click", (event) => {
    const choice = event.target.closest("[data-profile-key]");
    if (!choice) return;
    draftProfile[choice.dataset.profileKey] = choice.dataset.value;
    render();
  });
  $("#profile-name").addEventListener("input", (event) => { draftProfile.name = event.target.value.slice(0, 12); });
  $("#save-profile").addEventListener("click", (event) => {
    event.preventDefault();
    profile = { ...draftProfile, name: draftProfile.name.trim() || "ゲスト" };
    localStorage.setItem("atelier-profile", JSON.stringify(profile));
    refreshProfileUi();
    $("#profile-dialog").close();
    toast("プロフィールを保存しました");
  });
}

function onlinePlayer() {
  return { name: profile.name, avatar: profile };
}

function roster() {
  if (transport.role === "offline") return [];
  return [{ id: transport.id, ...onlinePlayer() }, ...transport.connectedPlayers()];
}

function updateNetworkUi(state = transport.role === "offline" ? "offline" : "connected") {
  const online = transport.role !== "offline";
  document.body.classList.toggle("is-online", online);
  $("#connection-label").textContent = !online ? "この端末で遊ぶ" : transport.role === "host" ? `部屋 ${transport.code}` : `参加中 ${transport.code}`;
  $("#connection-idle").hidden = online;
  $("#connection-active").hidden = !online;
  if (!online) return;
  $("#room-code").textContent = transport.code;
  const peers = transport.connectedPlayers();
  $("#network-state").textContent = state === "joining" ? "ホストへ接続中…" : peers.length ? `${peers.length + 1}人が接続中` : "接続を待っています";
  $("#network-detail").textContent = transport.role === "host" ? "このコードを友だちに伝えてください" : "ゲーム入力は端末間を直接送ります";
  $("#peer-list").innerHTML = [`<li>👑 ${profile.name}（あなた）</li>`, ...peers.map((peer) => `<li>● ${escapeHtml(peer.name || "ゲスト")}</li>`)].join("");
  if (activeGameId) $("#turn-badge").textContent = peers.length ? `${peers.length + 1}人 P2P` : "P2P待機中";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function setupNetwork() {
  const dialog = $("#connection-dialog");
  const open = () => { $("#connection-error").textContent = ""; updateNetworkUi(); dialog.showModal(); };
  $("#connection-button").addEventListener("click", open);
  $("#hero-connect").addEventListener("click", open);
  $("#host-room").addEventListener("click", async () => {
    $("#connection-error").textContent = "";
    try { await transport.host(onlinePlayer()); updateNetworkUi("hosting"); } catch (error) { transport.close(); updateNetworkUi(); $("#connection-error").textContent = `接続を開始できませんでした：${error.message}`; }
  });
  $("#join-room").addEventListener("click", async () => {
    $("#connection-error").textContent = "";
    const code = $("#join-code").value.trim();
    if (code.length !== 5) { $("#connection-error").textContent = "5文字のルームコードを入力してください。"; return; }
    try { await transport.join(code, onlinePlayer()); updateNetworkUi("joining"); } catch (error) { transport.close(); updateNetworkUi(); $("#connection-error").textContent = error.message; }
  });
  $("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(transport.code); toast("ルームコードをコピーしました"); });
  $("#leave-network").addEventListener("click", () => { transport.close(); updateNetworkUi(); toast("P2P接続を終了しました"); });

  transport.addEventListener("state", (event) => updateNetworkUi(event.detail.state));
  transport.addEventListener("peerjoin", () => {
    updateNetworkUi("connected");
    toast("プレイヤーが参加しました");
    if (transport.role === "host" && activeController) {
      transport.broadcast({ type: "game-open", game: activeGameId });
      publishState();
    }
  });
  transport.addEventListener("peerleave", () => { updateNetworkUi(); toast("プレイヤーとの接続が切れました"); });
  transport.addEventListener("error", (event) => {
    const message = event.detail.error?.message || "通信エラーが発生しました";
    $("#connection-error").textContent = message;
    console.warn("P2P", event.detail.error);
  });
  transport.addEventListener("message", (event) => handleNetworkMessage(event.detail.payload, event.detail.peerId));
}

function handleNetworkMessage(envelope, peerId) {
  const message = envelope.type === "replay" ? envelope.payload : envelope;
  if (message.type === "game-open" && transport.role === "guest") {
    if (activeGameId !== message.game) launchGame(message.game, { remote: true });
    return;
  }
  if (message.type === "game-state" && transport.role === "guest") {
    if (activeGameId !== message.game) launchGame(message.game, { remote: true });
    activeController?.loadState(message.state);
    return;
  }
  if (message.type === "game-action" && transport.role === "host" && activeController && message.game === activeGameId) {
    activeController.applyAction({ ...message.action, actorId: peerId });
    publishState();
  }
}

function controllerContext() {
  return {
    request(action) {
      const enriched = { ...action, actorId: transport.role === "offline" ? null : transport.id };
      if (transport.role === "guest") {
        transport.send({ type: "game-action", game: activeGameId, action: enriched });
      } else {
        activeController?.applyAction(enriched);
        publishState();
      }
    },
    publish: publishState,
    toast,
    isAuthority: () => transport.role !== "guest",
    isOnline: () => transport.role !== "offline",
    role: () => transport.role,
    selfId: () => transport.id,
    playerRoster: roster,
  };
}

function publishState() {
  if (!activeController) return;
  const state = activeController.getState();
  if (transport.role === "host") transport.broadcast({ type: "game-state", game: activeGameId, state });
  if (transport.role !== "guest" && !activeController.noPersist) {
    try { localStorage.setItem(`atelier-save-${activeGameId}`, JSON.stringify(state)); } catch { /* storage is optional */ }
  }
}

function launchGame(id, { remote = false } = {}) {
  if (id === "daifugo") { window.location.href = "daifugo.html"; return; }
  const game = games.find((entry) => entry.id === id);
  if (!game) return;
  activeController?.destroy?.();
  activeGameId = id;
  $("#hub-screen").hidden = true;
  $(".site-header").hidden = true;
  $("#game-shell").hidden = false;
  $("#game-title").textContent = game.title;
  $("#game-kicker").textContent = game.kicker;
  $("#turn-badge").textContent = transport.role === "offline" ? "この端末でプレイ" : "P2P接続中";
  const saved = transport.role === "offline" ? localStorage.getItem(`atelier-save-${id}`) : null;
  let savedState = null;
  try { savedState = saved ? JSON.parse(saved) : null; } catch { /* start fresh */ }
  const mount = { othello: mountOthello, connect: mountConnectFour, memory: mountMemory, yacht: mountYacht, hockey: mountAirHockey, speed: mountSpeed }[id];
  activeController = mount($("#game-stage"), controllerContext(), remote ? null : savedState);
  if (transport.role === "host" && !remote) {
    transport.broadcast({ type: "game-open", game: id });
    publishState();
  }
  window.scrollTo(0, 0);
}

function goHome() {
  activeController?.destroy?.();
  activeController = null;
  activeGameId = null;
  $("#game-shell").hidden = true;
  $("#hub-screen").hidden = false;
  $(".site-header").hidden = false;
}

function setupNavigation() {
  document.addEventListener("click", (event) => {
    const gameButton = event.target.closest("[data-game]");
    if (gameButton) launchGame(gameButton.dataset.game);
    if (event.target.closest('[data-action="home"]')) goHome();
  });
  $("#game-help").addEventListener("click", () => {
    const game = games.find((entry) => entry.id === activeGameId);
    if (!game) return;
    $("#help-title").textContent = `${game.title}の遊び方`;
    $("#help-content").innerHTML = `<ul>${game.help.map((line) => `<li>${line}</li>`).join("")}</ul>`;
    $("#help-dialog").showModal();
  });
}

function mountOthello(container, context, saved) {
  let state = saved?.board ? saved : { ...createOthelloState(), seats: context.playerRoster().slice(0, 2).map((player) => player.id) };
  container.innerHTML = `<div class="table-layout"><div class="table-main"><div class="othello-board-wrap"><div class="othello-board"></div></div></div><aside class="side-panel"><h2>石の数</h2><ul class="score-list"><li><span>● 黒</span><b data-score="black">2</b></li><li><span>○ 白</span><b data-score="white">2</b></li></ul><div class="game-message"></div><button class="table-button subtle" data-new>新しい対局</button></aside></div>`;
  const board = $(".othello-board", container);
  const render = () => {
    const valid = new Set(getOthelloMoves(state).map((move) => `${move.row}-${move.col}`));
    board.innerHTML = state.board.map((line, row) => line.map((cell, col) => `<button class="othello-cell${valid.has(`${row}-${col}`) ? " valid" : ""}" data-row="${row}" data-col="${col}" ${state.winner !== null ? "disabled" : ""}>${cell ? `<i class="othello-piece ${cell === PLAYER_ONE ? "black" : "white"}"></i>` : ""}</button>`).join("")).join("");
    const scores = countOthello(state);
    $('[data-score="black"]', container).textContent = scores.black;
    $('[data-score="white"]', container).textContent = scores.white;
    $(".game-message", container).textContent = state.message;
    $("#turn-badge").textContent = state.winner === null ? `${state.current === PLAYER_ONE ? "黒" : "白"}の番` : "対局終了";
  };
  board.addEventListener("click", (event) => { const cell = event.target.closest(".othello-cell"); if (cell) context.request({ type: "move", row: Number(cell.dataset.row), col: Number(cell.dataset.col) }); });
  $("[data-new]", container).addEventListener("click", () => context.request({ type: "new" }));
  const controller = { getState: () => clone(state), loadState: (next) => { state = clone(next); render(); }, applyAction: (action) => {
    if (action.type === "new") state = { ...createOthelloState(), seats: context.playerRoster().slice(0, 2).map((player) => player.id) };
    else if (action.type === "move") {
      const expected = state.seats?.[state.current === PLAYER_ONE ? 0 : 1];
      if (context.isOnline() && expected && expected !== action.actorId) { context.toast("今は相手の番です"); return; }
      const result = applyOthelloMove(state, action.row, action.col); state = result.state; if (!result.ok) context.toast(result.error);
    }
    render();
  }, destroy() {} };
  render();
  return controller;
}

function mountConnectFour(container, context, saved) {
  let state = saved?.board ? saved : { ...createConnectFourState(), seats: context.playerRoster().slice(0, 2).map((player) => player.id) };
  container.innerHTML = `<div class="table-layout"><div class="table-main"><div class="connect-wrap"><div class="connect-board"></div></div></div><aside class="side-panel"><h2>コネクトフォー</h2><ul class="score-list"><li><span>● 赤</span><b>先手</b></li><li><span>● 黄</span><b>後手</b></li></ul><div class="game-message"></div><button class="table-button subtle" data-new>新しい対局</button></aside></div>`;
  const board = $(".connect-board", container);
  const render = () => {
    board.innerHTML = state.board.map((line, row) => line.map((cell, col) => `<button class="connect-slot" data-column="${col}" aria-label="${col + 1}列目">${cell ? `<i class="connect-chip ${cell === PLAYER_ONE ? "red" : "yellow"}"></i>` : ""}</button>`).join("")).join("");
    $(".game-message", container).textContent = state.message;
    $("#turn-badge").textContent = state.winner === null ? `${state.current === PLAYER_ONE ? "赤" : "黄"}の番` : "対局終了";
  };
  board.addEventListener("click", (event) => { const slot = event.target.closest(".connect-slot"); if (slot) context.request({ type: "drop", column: Number(slot.dataset.column) }); });
  $("[data-new]", container).addEventListener("click", () => context.request({ type: "new" }));
  const controller = { getState: () => clone(state), loadState: (next) => { state = clone(next); render(); }, applyAction: (action) => {
    if (action.type === "new") state = { ...createConnectFourState(), seats: context.playerRoster().slice(0, 2).map((player) => player.id) };
    else if (action.type === "drop") {
      const expected = state.seats?.[state.current === PLAYER_ONE ? 0 : 1];
      if (context.isOnline() && expected && expected !== action.actorId) { context.toast("今は相手の番です"); return; }
      const result = applyConnectFourMove(state, action.column); state = result.state; if (!result.ok) context.toast(result.error);
    }
    render();
  }, destroy() {} };
  render();
  return controller;
}

function memoryPlayers(context) {
  const online = context.playerRoster();
  return online.length > 1 ? online : [{ id: "local-0", name: profile.name }, { id: "local-1", name: "PLAYER 2" }];
}

function mountMemory(container, context, saved) {
  let state = saved?.cards ? saved : createMemoryState({ players: memoryPlayers(context), pairs: 8 });
  let frame = null;
  let mismatchTimer = null;
  const motion = new Map();
  container.innerHTML = `<div class="table-layout"><div class="table-main"><div class="memory-arena"></div></div><aside class="side-panel"><h2>流星神経衰弱</h2><ul class="score-list"></ul><div class="game-message"></div><button class="table-button subtle" data-new>カードを配り直す</button></aside></div>`;
  const arena = $(".memory-arena", container);
  const ensureMotion = () => state.cards.forEach((card, index) => {
    if (!motion.has(card.id)) motion.set(card.id, { x: 20 + (index % 4) * 120, y: 20 + Math.floor(index / 4) * 125, vx: (index % 2 ? 1 : -1) * (38 + index % 5 * 8), vy: (index % 3 ? 1 : -1) * (32 + index % 4 * 7) });
  });
  const render = () => {
    ensureMotion();
    arena.innerHTML = state.cards.map((card) => `<button class="memory-card${card.faceUp ? " open" : ""}${card.matched ? " matched" : ""}" data-card="${card.id}"><span class="memory-card-inner"><span class="memory-face memory-back"></span><span class="memory-face memory-front">${card.symbol}</span></span></button>`).join("");
    $(".score-list", container).innerHTML = state.players.map((player, index) => `<li class="${index === state.currentPlayer ? "active" : ""}"><span>${escapeHtml(player.name)}</span><b>${player.score}組</b></li>`).join("");
    $(".game-message", container).textContent = state.message;
    $("#turn-badge").textContent = state.winner === null ? `${state.players[state.currentPlayer].name}の番` : "ゲーム終了";
  };
  const animate = (time) => {
    const last = animate.last || time;
    const delta = Math.min((time - last) / 1000, .04);
    animate.last = time;
    const bounds = arena.getBoundingClientRect();
    for (const [id, item] of motion) {
      const element = arena.querySelector(`[data-card="${CSS.escape(id)}"]`);
      if (!element) continue;
      const width = element.offsetWidth || 86;
      const height = element.offsetHeight || 116;
      item.x += item.vx * delta;
      item.y += item.vy * delta;
      if (item.x <= 0 || item.x + width >= bounds.width) { item.vx *= -1; item.x = Math.max(0, Math.min(item.x, bounds.width - width)); }
      if (item.y <= 0 || item.y + height >= bounds.height) { item.vy *= -1; item.y = Math.max(0, Math.min(item.y, bounds.height - height)); }
      element.style.transform = `translate3d(${item.x}px,${item.y}px,0) rotate(${Math.sin(time / 1100 + item.x) * 4}deg)`;
    }
    frame = requestAnimationFrame(animate);
  };
  arena.addEventListener("click", (event) => { const card = event.target.closest(".memory-card"); if (card) context.request({ type: "pick", cardId: card.dataset.card }); });
  $("[data-new]", container).addEventListener("click", () => context.request({ type: "new" }));
  const controller = {
    getState: () => clone(state),
    loadState(next) { state = clone(next); render(); },
    applyAction(action) {
      if (action.type === "new") { state = createMemoryState({ players: memoryPlayers(context), pairs: 8 }); motion.clear(); }
      if (action.type === "pick") {
        if (context.isOnline() && state.players[state.currentPlayer]?.id !== action.actorId) { context.toast("今は相手の番です"); return; }
        const result = pickMemoryCard(state, action.cardId);
        state = result.state;
        if (!result.ok) context.toast(result.error);
        if (state.pendingMismatch && context.isAuthority()) {
          clearTimeout(mismatchTimer);
          mismatchTimer = setTimeout(() => context.request({ type: "resolve" }), 950);
        }
      }
      if (action.type === "resolve") state = resolveMemoryMismatch(state);
      render();
    },
    destroy() { cancelAnimationFrame(frame); clearTimeout(mismatchTimer); },
  };
  render();
  frame = requestAnimationFrame(animate);
  return controller;
}

function yachtPlayers(context, localCount = 2) {
  const online = context.playerRoster();
  if (online.length > 1) return online.slice(0, 8);
  return Array.from({ length: localCount }, (_, index) => ({ id: `local-${index}`, name: index === 0 ? profile.name : `PLAYER ${index + 1}` }));
}

function diePips(face) {
  const positions = { 1: ["c"], 2: ["tl", "br"], 3: ["tl", "c", "br"], 4: ["tl", "tr", "bl", "br"], 5: ["tl", "tr", "c", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"] }[face];
  return positions.map((position) => `<i class="pip ${position}"></i>`).join("");
}

function mountYacht(container, context, saved) {
  let localCount = saved?.players?.length || 2;
  let state = saved?.dice ? saved : createYachtState(yachtPlayers(context, localCount));
  let rolling = false;
  container.innerHTML = `<div class="table-layout"><div class="table-main"><div class="yacht-felt"><p class="eyebrow">YACHT CLUB</p><div class="dice-row"></div><button class="roll-button">ROLL<br><small>0 / 3</small></button></div></div><aside class="side-panel"><h2>スコアシート</h2><ul class="score-list player-scores"></ul><div class="yacht-categories"></div><div class="game-message"></div><button class="table-button subtle" data-new>新しいゲーム</button><button class="table-button subtle" data-players>ローカル人数：${localCount}人</button></aside></div>`;
  const canAct = () => !context.isOnline() || state.players[state.currentPlayer]?.id === context.selfId();
  const render = () => {
    $(".dice-row", container).innerHTML = state.dice.map((die, index) => `<button class="die${state.held[index] ? " held" : ""}${rolling ? " rolling" : ""}" data-die="${index}" aria-label="${die}の目${state.held[index] ? "、ホールド中" : ""}">${diePips(die)}</button>`).join("");
    const current = state.players[state.currentPlayer];
    const rollButton = $(".roll-button", container);
    rollButton.innerHTML = `ROLL<br><small>${state.rolls} / 3</small>`;
    rollButton.disabled = !canAct() || state.rolls >= 3 || state.winner !== null;
    $(".player-scores", container).innerHTML = state.players.map((player, index) => `<li class="${index === state.currentPlayer ? "active" : ""}"><span>${escapeHtml(player.name)}</span><b>${yachtTotal(player.scores)}点</b></li>`).join("");
    $(".yacht-categories", container).innerHTML = YACHT_CATEGORIES.map(([key, label]) => {
      const used = Object.hasOwn(current.scores, key);
      const preview = state.rolls ? scoreYachtCategory(key, state.dice) : 0;
      return `<button class="category-button" data-category="${key}" ${used || !canAct() || state.winner !== null ? "disabled" : ""}><span>${label}</span><b>${used ? current.scores[key] : preview}</b></button>`;
    }).join("");
    $(".game-message", container).textContent = state.message;
    $("#turn-badge").textContent = `${current.name} · ${state.round}/12`;
    $("[data-players]", container).hidden = context.isOnline();
    $("[data-players]", container).textContent = `ローカル人数：${localCount}人`;
  };
  $(".dice-row", container).addEventListener("click", (event) => { const die = event.target.closest(".die"); if (die && canAct()) context.request({ type: "hold", index: Number(die.dataset.die) }); });
  $(".roll-button", container).addEventListener("click", () => { if (canAct()) { rolling = true; render(); setTimeout(() => { rolling = false; context.request({ type: "roll" }); }, 330); } });
  $(".yacht-categories", container).addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (button && canAct()) context.request({ type: "score", category: button.dataset.category }); });
  $("[data-new]", container).addEventListener("click", () => context.request({ type: "new" }));
  $("[data-players]", container).addEventListener("click", () => { localCount = localCount >= 8 ? 2 : localCount + 1; context.request({ type: "new", count: localCount }); });
  const controller = {
    getState: () => clone(state),
    loadState(next) { state = clone(next); render(); },
    applyAction(action) {
      const current = state.players[state.currentPlayer];
      if (context.isOnline() && action.type !== "new" && current?.id !== action.actorId) { context.toast("今はあなたの番ではありません"); return; }
      if (action.type === "new") { localCount = action.count || localCount; state = createYachtState(yachtPlayers(context, localCount)); }
      if (action.type === "hold") state = toggleYachtHold(state, action.index);
      if (action.type === "roll") { const result = rollYachtDice(state); state = result.state; if (!result.ok) context.toast(result.error); }
      if (action.type === "score") { const result = recordYachtScore(state, action.category); state = result.state; if (!result.ok) context.toast(result.error); }
      render();
    },
    destroy() {},
  };
  render();
  return controller;
}

function mountAirHockey(container, context) {
  const state = { scores: [0, 0], winner: null, seats: context.playerRoster().slice(0, 2).map((player) => player.id), puck: { x: 480, y: 270, vx: 250, vy: 70 }, paddles: [{ x: 140, y: 270 }, { x: 820, y: 270 }] };
  let frame = null;
  let lastTime = performance.now();
  let lastPublish = 0;
  container.innerHTML = `<div class="hockey-frame"><div class="hockey-score"><span class="blue">BLUE <b data-score="0">0</b></span><span>—</span><span class="red"><b data-score="1">0</b> RED</span></div><canvas width="960" height="540" aria-label="エアホッケー台"></canvas></div>`;
  const canvas = $("canvas", container);
  const drawContext = canvas.getContext("2d");
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function resetPuck(direction) { state.puck = { x: 480, y: 270, vx: 245 * direction, vy: (Math.random() - .5) * 190 }; }
  function collide(paddle) {
    const dx = state.puck.x - paddle.x;
    const dy = state.puck.y - paddle.y;
    const distance = Math.hypot(dx, dy);
    const minimum = 61;
    if (distance > 0 && distance < minimum) {
      const nx = dx / distance;
      const ny = dy / distance;
      state.puck.x = paddle.x + nx * minimum;
      state.puck.y = paddle.y + ny * minimum;
      const relative = state.puck.vx * nx + state.puck.vy * ny;
      state.puck.vx -= 2 * relative * nx;
      state.puck.vy -= 2 * relative * ny;
      state.puck.vx += nx * 105;
      state.puck.vy += ny * 105;
    }
  }
  function simulate(delta, time) {
    if (state.winner !== null) return;
    if (!context.isOnline()) {
      const ai = state.paddles[1];
      const targetX = state.puck.x > 480 ? clamp(state.puck.x + 80, 545, 890) : 790;
      ai.x += (targetX - ai.x) * Math.min(1, delta * 2.8);
      ai.y += (clamp(state.puck.y, 55, 485) - ai.y) * Math.min(1, delta * 3.1);
    }
    state.puck.x += state.puck.vx * delta;
    state.puck.y += state.puck.vy * delta;
    state.puck.vx *= Math.pow(.997, delta * 60);
    state.puck.vy *= Math.pow(.997, delta * 60);
    if (Math.abs(state.puck.vx) + Math.abs(state.puck.vy) < 120) state.puck.vx *= 1.02;
    if (state.puck.y < 25 || state.puck.y > 515) { state.puck.y = clamp(state.puck.y, 25, 515); state.puck.vy *= -1; }
    const inGoal = state.puck.y > 195 && state.puck.y < 345;
    if (!inGoal && (state.puck.x < 25 || state.puck.x > 935)) { state.puck.x = clamp(state.puck.x, 25, 935); state.puck.vx *= -1; }
    collide(state.paddles[0]); collide(state.paddles[1]);
    if (state.puck.x < -28) { state.scores[1] += 1; state.winner = state.scores[1] >= 7 ? 1 : null; resetPuck(1); }
    if (state.puck.x > 988) { state.scores[0] += 1; state.winner = state.scores[0] >= 7 ? 0 : null; resetPuck(-1); }
    if (context.role() === "host" && time - lastPublish > 50) { lastPublish = time; context.publish(); }
  }
  function draw() {
    const gradient = drawContext.createLinearGradient(0, 0, 960, 540); gradient.addColorStop(0, "#f5fbff"); gradient.addColorStop(1, "#a9d1e5"); drawContext.fillStyle = gradient; drawContext.fillRect(0, 0, 960, 540);
    drawContext.strokeStyle = "rgba(27,84,112,.38)"; drawContext.lineWidth = 5; drawContext.beginPath(); drawContext.moveTo(480, 0); drawContext.lineTo(480, 540); drawContext.stroke();
    drawContext.beginPath(); drawContext.arc(480, 270, 105, 0, Math.PI * 2); drawContext.stroke();
    drawContext.strokeStyle = "#49687a"; drawContext.lineWidth = 14; drawContext.beginPath(); drawContext.moveTo(0, 195); drawContext.lineTo(0, 345); drawContext.moveTo(960, 195); drawContext.lineTo(960, 345); drawContext.stroke();
    [[state.paddles[0], "#238ccc"], [state.paddles[1], "#e14b5b"]].forEach(([paddle, color]) => { drawContext.save(); drawContext.shadowColor = "rgba(0,0,0,.35)"; drawContext.shadowBlur = 16; drawContext.shadowOffsetY = 9; drawContext.fillStyle = color; drawContext.beginPath(); drawContext.arc(paddle.x, paddle.y, 43, 0, Math.PI * 2); drawContext.fill(); drawContext.fillStyle = "rgba(255,255,255,.22)"; drawContext.beginPath(); drawContext.arc(paddle.x - 10, paddle.y - 12, 14, 0, Math.PI * 2); drawContext.fill(); drawContext.restore(); });
    drawContext.save(); drawContext.shadowColor = "rgba(0,0,0,.45)"; drawContext.shadowBlur = 13; drawContext.shadowOffsetY = 7; drawContext.fillStyle = "#25313a"; drawContext.beginPath(); drawContext.arc(state.puck.x, state.puck.y, 18, 0, Math.PI * 2); drawContext.fill(); drawContext.restore();
    if (state.winner !== null) { drawContext.fillStyle = "rgba(8,12,19,.68)"; drawContext.fillRect(0,0,960,540); drawContext.fillStyle = "white"; drawContext.textAlign = "center"; drawContext.font = "700 52px Georgia"; drawContext.fillText(`${state.winner === 0 ? "BLUE" : "RED"} WINS`,480,270); drawContext.font = "20px sans-serif"; drawContext.fillText("タップして再戦",480,310); }
    $('[data-score="0"]', container).textContent = state.scores[0]; $('[data-score="1"]', container).textContent = state.scores[1];
  }
  function loop(time) { const delta = Math.min((time - lastTime) / 1000, .035); lastTime = time; if (context.isAuthority()) simulate(delta, time); draw(); frame = requestAnimationFrame(loop); }
  const pointer = (event) => { const rect = canvas.getBoundingClientRect(); const x = (event.clientX - rect.left) * 960 / rect.width; const y = (event.clientY - rect.top) * 540 / rect.height; const side = context.role() === "guest" ? 1 : 0; context.request({ type: "move", side, x, y }); };
  canvas.addEventListener("pointermove", pointer); canvas.addEventListener("pointerdown", (event) => { if (state.winner !== null) context.request({ type: "new" }); else pointer(event); });
  const controller = { noPersist: true, getState: () => clone(state), loadState(next) { Object.assign(state, clone(next)); }, applyAction(action) { if (action.type === "new") { state.scores=[0,0]; state.winner=null; resetPuck(Math.random()>.5?1:-1); } if (action.type === "move") { const side = action.side; const expected = context.isOnline() ? state.seats.indexOf(action.actorId) : 0; if (context.isOnline() && (expected < 0 || side !== expected)) return; const minX = side === 0 ? 48 : 528; const maxX = side === 0 ? 432 : 912; state.paddles[side] = { x: clamp(action.x, minX, maxX), y: clamp(action.y, 48, 492) }; } }, destroy() { cancelAnimationFrame(frame); } };
  frame = requestAnimationFrame(loop);
  return controller;
}

const suits = ["♠", "♥", "♦", "♣"];
const rankText = (rank) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[rank] || String(rank);
const redSuit = (suit) => suit === "♥" || suit === "♦";
function createSpeedState() {
  const deck = shuffle(suits.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({ rank: index + 1, suit }))));
  const sides = [0, 1].map((side) => ({ hand: deck.slice(side * 26, side * 26 + 4), stock: deck.slice(side * 26 + 4, (side + 1) * 26) }));
  return { sides, center: [sides[0].stock.pop(), sides[1].stock.pop()], winner: null, message: "中央と1つ違いのカードを出そう" };
}
function fits(card, target) { const difference = Math.abs(card.rank - target.rank); return difference === 1 || difference === 12; }

function mountSpeed(container, context, saved) {
  let state = saved?.center ? saved : createSpeedState();
  if (!state.seats) state.seats = context.playerRoster().slice(0, 2).map((player) => player.id);
  let aiTimer = null;
  container.innerHTML = `<div class="speed-felt"><div class="speed-zone opponent"></div><div class="speed-center"></div><div class="game-message"></div><div class="speed-zone player"></div></div>`;
  const cardHtml = (card, index, side, hidden = false) => hidden ? '<span class="playing-card card-back"></span>' : `<button class="playing-card${redSuit(card.suit) ? " red" : ""}" data-side="${side}" data-index="${index}"><b>${rankText(card.rank)}</b><span>${card.suit}</span></button>`;
  const canActSide = () => context.role() === "guest" ? 1 : 0;
  const movesFor = (side) => state.sides[side].hand.flatMap((card, index) => state.center.map((target, pile) => fits(card, target) ? { side, index, pile } : null)).filter(Boolean);
  const scheduleAi = () => {
    clearTimeout(aiTimer);
    if (!context.isAuthority() || context.isOnline() || state.winner !== null) return;
    aiTimer = setTimeout(() => { const moves = movesFor(1); if (moves.length) context.request({ type: "play", ...moves[Math.floor(Math.random() * moves.length)] }); else maybeDeal(); scheduleAi(); }, 520 + Math.random() * 650);
  };
  const maybeDeal = () => { if (!movesFor(0).length && !movesFor(1).length && (state.sides[0].stock.length || state.sides[1].stock.length)) context.request({ type: "deal" }); };
  const render = () => {
    $(".speed-zone.player", container).innerHTML = state.sides[canActSide()].hand.map((card, index) => cardHtml(card, index, canActSide())).join("") + `<span class="stock-count">山札 ${state.sides[canActSide()].stock.length}枚</span>`;
    const opponent = canActSide() === 0 ? 1 : 0;
    $(".speed-zone.opponent", container).innerHTML = state.sides[opponent].hand.map((card, index) => cardHtml(card, index, opponent, context.isOnline())).join("") + `<span class="stock-count">山札 ${state.sides[opponent].stock.length}枚</span>`;
    $(".speed-center", container).innerHTML = state.center.map((card) => `<span class="playing-card center-card${redSuit(card.suit) ? " red" : ""}"><b>${rankText(card.rank)}</b><span>${card.suit}</span></span>`).join("");
    $(".game-message", container).textContent = state.winner === null ? state.message : `${state.winner === canActSide() ? "あなた" : "相手"}の勝ち！ タップで再戦`;
    $("#turn-badge").textContent = "同時プレイ";
    scheduleAi();
  };
  $(".speed-zone.player", container).addEventListener("click", (event) => {
    const card = event.target.closest("[data-index]"); if (!card) return;
    const side = Number(card.dataset.side); const index = Number(card.dataset.index); const target = state.center.findIndex((center) => fits(state.sides[side].hand[index], center));
    if (target < 0) { card.classList.add("invalid"); setTimeout(() => card.classList.remove("invalid"), 260); context.toast("中央と1つ違いのカードだけ出せます"); return; }
    context.request({ type: "play", side, index, pile: target });
  });
  container.addEventListener("click", (event) => { if (state.winner !== null && !event.target.closest("[data-index]")) context.request({ type: "new" }); });
  const controller = {
    getState: () => clone(state),
    loadState(next) { state = clone(next); render(); },
    applyAction(action) {
      if (action.type === "new") state = { ...createSpeedState(), seats: context.playerRoster().slice(0, 2).map((player) => player.id) };
      if (action.type === "play") {
        const expectedSide = context.isOnline() ? state.seats.indexOf(action.actorId) : action.side;
        const card = state.sides[action.side]?.hand[action.index];
        if (expectedSide !== action.side || !card || !fits(card, state.center[action.pile])) return;
        state.center[action.pile] = card;
        state.sides[action.side].hand.splice(action.index, 1);
        if (state.sides[action.side].stock.length) state.sides[action.side].hand.push(state.sides[action.side].stock.pop());
        if (!state.sides[action.side].hand.length && !state.sides[action.side].stock.length) state.winner = action.side;
      }
      if (action.type === "deal") state.center = state.center.map((card, side) => state.sides[side].stock.pop() || card);
      render(); setTimeout(maybeDeal, 80);
    },
    destroy() { clearTimeout(aiTimer); },
  };
  render();
  return controller;
}

renderGameCards();
refreshProfileUi();
setupProfileDialog();
setupNetwork();
setupNavigation();
updateNetworkUi();
window.addEventListener("beforeunload", () => transport.close());
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch((error) => console.warn("Service Worker", error)));
}
