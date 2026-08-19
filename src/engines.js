export const PLAYER_ONE = 1;
export const PLAYER_TWO = -1;

const DIRECTIONS = [-1, 0, 1]
  .flatMap((row) => [-1, 0, 1].map((col) => [row, col]))
  .filter(([row, col]) => row || col);

const copy = (value) => structuredClone(value);

export function shuffle(values, rng = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createOthelloState() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  board[3][3] = PLAYER_TWO;
  board[4][4] = PLAYER_TWO;
  board[3][4] = PLAYER_ONE;
  board[4][3] = PLAYER_ONE;
  return { board, current: PLAYER_ONE, winner: null, lastMove: null, message: "黒の番です" };
}

export function getOthelloMoves(state, player = state.current) {
  if (state.winner !== null) return [];
  const moves = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (state.board[row][col]) continue;
      const flips = [];
      for (const [deltaRow, deltaCol] of DIRECTIONS) {
        const line = [];
        let nextRow = row + deltaRow;
        let nextCol = col + deltaCol;
        while (state.board[nextRow]?.[nextCol] === -player) {
          line.push([nextRow, nextCol]);
          nextRow += deltaRow;
          nextCol += deltaCol;
        }
        if (line.length && state.board[nextRow]?.[nextCol] === player) flips.push(...line);
      }
      if (flips.length) moves.push({ row, col, flips });
    }
  }
  return moves;
}

export function applyOthelloMove(source, row, col) {
  const state = copy(source);
  const move = getOthelloMoves(state).find((candidate) => candidate.row === row && candidate.col === col);
  if (!move) return { state: source, ok: false, error: "そこには置けません" };
  state.board[row][col] = state.current;
  move.flips.forEach(([flipRow, flipCol]) => { state.board[flipRow][flipCol] = state.current; });
  state.lastMove = { row, col };
  const opponent = -state.current;
  if (getOthelloMoves({ ...state, current: opponent }, opponent).length) {
    state.current = opponent;
    state.message = `${opponent === PLAYER_ONE ? "黒" : "白"}の番です`;
  } else if (getOthelloMoves(state, state.current).length) {
    state.message = `${opponent === PLAYER_ONE ? "黒" : "白"}は置けないためパスです`;
  } else {
    const flat = state.board.flat();
    const black = flat.filter((cell) => cell === PLAYER_ONE).length;
    const white = flat.filter((cell) => cell === PLAYER_TWO).length;
    state.winner = black === white ? 0 : black > white ? PLAYER_ONE : PLAYER_TWO;
    state.message = black === white ? `引き分けです（${black} - ${white}）` : `${state.winner === PLAYER_ONE ? "黒" : "白"}の勝ち！（${black} - ${white}）`;
  }
  return { state, ok: true };
}

export function countOthello(state) {
  const cells = state.board.flat();
  return {
    black: cells.filter((cell) => cell === PLAYER_ONE).length,
    white: cells.filter((cell) => cell === PLAYER_TWO).length,
  };
}

export function createConnectFourState() {
  return {
    board: Array.from({ length: 6 }, () => Array(7).fill(0)),
    current: PLAYER_ONE,
    winner: null,
    winningCells: [],
    lastMove: null,
    message: "赤の番です",
  };
}

function connectLine(board, row, col, player, rowDelta, colDelta) {
  const cells = [[row, col]];
  for (const direction of [-1, 1]) {
    let nextRow = row + rowDelta * direction;
    let nextCol = col + colDelta * direction;
    while (board[nextRow]?.[nextCol] === player) {
      direction < 0 ? cells.unshift([nextRow, nextCol]) : cells.push([nextRow, nextCol]);
      nextRow += rowDelta * direction;
      nextCol += colDelta * direction;
    }
  }
  return cells;
}

export function applyConnectFourMove(source, column) {
  if (source.winner !== null) return { state: source, ok: false, error: "ゲームは終了しています" };
  if (!Number.isInteger(column) || column < 0 || column > 6) return { state: source, ok: false, error: "列が正しくありません" };
  const state = copy(source);
  let row = 5;
  while (row >= 0 && state.board[row][column]) row -= 1;
  if (row < 0) return { state: source, ok: false, error: "この列はいっぱいです" };
  state.board[row][column] = state.current;
  state.lastMove = { row, column };
  for (const [rowDelta, colDelta] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = connectLine(state.board, row, column, state.current, rowDelta, colDelta);
    if (line.length >= 4) {
      state.winner = state.current;
      state.winningCells = line;
      state.message = `${state.current === PLAYER_ONE ? "赤" : "黄"}の勝ち！`;
      return { state, ok: true };
    }
  }
  if (state.board.every((line) => line.every(Boolean))) {
    state.winner = 0;
    state.message = "引き分けです";
  } else {
    state.current *= -1;
    state.message = `${state.current === PLAYER_ONE ? "赤" : "黄"}の番です`;
  }
  return { state, ok: true };
}

export function createMemoryState({ players = ["PLAYER 1", "PLAYER 2"], pairs = 8, rng = Math.random } = {}) {
  const symbols = ["月", "星", "花", "鳥", "雲", "山", "波", "鍵", "灯", "雪", "葉", "音"];
  const cards = shuffle(Array.from({ length: pairs }, (_, pair) => [0, 1].map((copyIndex) => ({
    id: `${pair}-${copyIndex}-${Math.floor(rng() * 1e7)}`,
    pair,
    symbol: symbols[pair % symbols.length],
    faceUp: false,
    matched: false,
  }))).flat(), rng);
  return {
    cards,
    players: players.map((player, index) => typeof player === "string" ? { id: `local-${index}`, name: player, score: 0 } : { ...player, score: player.score || 0 }),
    currentPlayer: 0,
    picks: [],
    pendingMismatch: false,
    winner: null,
    message: `${typeof players[0] === "string" ? players[0] : players[0].name}の番です`,
  };
}

export function pickMemoryCard(source, cardId) {
  if (source.pendingMismatch || source.winner !== null) return { state: source, ok: false, error: "カードを確認中です" };
  const state = copy(source);
  const card = state.cards.find((item) => item.id === cardId);
  if (!card || card.matched || card.faceUp) return { state: source, ok: false, error: "別のカードを選んでください" };
  card.faceUp = true;
  state.picks.push(card.id);
  if (state.picks.length === 1) {
    state.message = "もう1枚選んでください";
    return { state, ok: true };
  }
  const [first, second] = state.picks.map((id) => state.cards.find((item) => item.id === id));
  if (first.pair === second.pair) {
    first.matched = true;
    second.matched = true;
    state.players[state.currentPlayer].score += 1;
    state.picks = [];
    if (state.cards.every((item) => item.matched)) {
      const best = Math.max(...state.players.map((player) => player.score));
      const winners = state.players.filter((player) => player.score === best);
      state.winner = winners.length === 1 ? winners[0].id : "draw";
      state.message = winners.length === 1 ? `${winners[0].name}の勝ち！` : "引き分けです";
    } else {
      state.message = "ペア！ 続けてどうぞ";
    }
  } else {
    state.pendingMismatch = true;
    state.message = "ちがうカードでした";
  }
  return { state, ok: true };
}

export function resolveMemoryMismatch(source) {
  if (!source.pendingMismatch) return source;
  const state = copy(source);
  state.picks.forEach((id) => { state.cards.find((card) => card.id === id).faceUp = false; });
  state.picks = [];
  state.pendingMismatch = false;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.message = `${state.players[state.currentPlayer].name}の番です`;
  return state;
}

export const YACHT_CATEGORIES = [
  ["ones", "エース"], ["twos", "デュース"], ["threes", "スリー"], ["fours", "フォー"], ["fives", "ファイブ"], ["sixes", "シックス"],
  ["choice", "チョイス"], ["fourKind", "フォーカード"], ["fullHouse", "フルハウス"], ["smallStraight", "S.ストレート"], ["largeStraight", "L.ストレート"], ["yacht", "ヨット"],
];

export function scoreYachtCategory(category, dice) {
  const counts = Array.from({ length: 7 }, (_, face) => dice.filter((die) => die === face).length);
  const sum = dice.reduce((total, die) => total + die, 0);
  if (/^(ones|twos|threes|fours|fives|sixes)$/.test(category)) {
    const face = ["ones", "twos", "threes", "fours", "fives", "sixes"].indexOf(category) + 1;
    return counts[face] * face;
  }
  if (category === "choice") return sum;
  if (category === "fourKind") return counts.some((count) => count >= 4) ? sum : 0;
  if (category === "fullHouse") return counts.includes(3) && counts.includes(2) ? sum : 0;
  const unique = [...new Set(dice)].sort().join("");
  if (category === "smallStraight") return ["1234", "2345", "3456"].some((run) => unique.includes(run)) ? 15 : 0;
  if (category === "largeStraight") return unique === "12345" || unique === "23456" ? 30 : 0;
  if (category === "yacht") return counts.includes(5) ? 50 : 0;
  return 0;
}

export function yachtTotal(scores) {
  const upperKeys = ["ones", "twos", "threes", "fours", "fives", "sixes"];
  const upper = upperKeys.reduce((total, key) => total + (scores[key] ?? 0), 0);
  const subtotal = Object.values(scores).reduce((total, value) => total + value, 0);
  return subtotal + (upper >= 63 ? 35 : 0);
}

export function createYachtState(players = ["PLAYER 1", "PLAYER 2"]) {
  const normalized = players.slice(0, 8).map((player, index) => typeof player === "string"
    ? { id: `local-${index}`, name: player, scores: {} }
    : { id: player.id || `player-${index}`, name: player.name, scores: player.scores || {} });
  return {
    players: normalized,
    currentPlayer: 0,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rolls: 0,
    round: 1,
    winner: null,
    message: `${normalized[0].name}：サイコロを振ってください`,
  };
}

export function rollYachtDice(source, rng = Math.random) {
  if (source.winner !== null || source.rolls >= 3) return { state: source, ok: false, error: "このターンはもう振れません" };
  const state = copy(source);
  state.dice = state.dice.map((die, index) => state.held[index] ? die : Math.floor(rng() * 6) + 1);
  state.rolls += 1;
  state.message = state.rolls < 3 ? `あと${3 - state.rolls}回振れます` : "カテゴリーを選んでください";
  return { state, ok: true };
}

export function toggleYachtHold(source, index) {
  if (source.rolls === 0 || source.winner !== null || index < 0 || index > 4) return source;
  const state = copy(source);
  state.held[index] = !state.held[index];
  return state;
}

export function recordYachtScore(source, category) {
  const state = copy(source);
  const player = state.players[state.currentPlayer];
  if (!YACHT_CATEGORIES.some(([key]) => key === category) || Object.hasOwn(player.scores, category)) return { state: source, ok: false, error: "そのカテゴリーは選べません" };
  if (!state.rolls) return { state: source, ok: false, error: "先にサイコロを振ってください" };
  player.scores[category] = scoreYachtCategory(category, state.dice);
  const finished = state.players.every((entry) => Object.keys(entry.scores).length === YACHT_CATEGORIES.length);
  if (finished) {
    const top = Math.max(...state.players.map((entry) => yachtTotal(entry.scores)));
    const winners = state.players.filter((entry) => yachtTotal(entry.scores) === top);
    state.winner = winners.length === 1 ? winners[0].id : "draw";
    state.message = winners.length === 1 ? `${winners[0].name}の勝ち！ ${top}点` : `引き分け！ ${top}点`;
  } else {
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    if (state.currentPlayer === 0) state.round += 1;
    state.dice = [1, 1, 1, 1, 1];
    state.held = [false, false, false, false, false];
    state.rolls = 0;
    state.message = `${state.players[state.currentPlayer].name}：サイコロを振ってください`;
  }
  return { state, ok: true };
}
