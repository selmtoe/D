import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_ONE,
  applyConnectFourMove,
  applyOthelloMove,
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
  toggleYachtHold,
  yachtTotal,
} from "../src/engines.js";

test("オセロの初期局面には黒の合法手が4つある", () => {
  const state = createOthelloState();
  assert.equal(getOthelloMoves(state).length, 4);
  const result = applyOthelloMove(state, 2, 3);
  assert.equal(result.ok, true);
  assert.equal(result.state.board[3][3], PLAYER_ONE);
  assert.equal(result.state.current, -PLAYER_ONE);
});

test("オセロは石を挟めない場所を拒否する", () => {
  const state = createOthelloState();
  const result = applyOthelloMove(state, 0, 0);
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, state);
});

test("コネクトフォーは縦4枚を検出する", () => {
  let state = createConnectFourState();
  for (const column of [0, 1, 0, 1, 0, 1, 0]) state = applyConnectFourMove(state, column).state;
  assert.equal(state.winner, PLAYER_ONE);
  assert.equal(state.winningCells.length, 4);
});

test("コネクトフォーは満杯の列を拒否する", () => {
  let state = createConnectFourState();
  for (let index = 0; index < 6; index += 1) state = applyConnectFourMove(state, 0).state;
  const result = applyConnectFourMove(state, 0);
  assert.equal(result.ok, false);
});

test("神経衰弱はペアで加点し、ミスで手番を送る", () => {
  const sequence = [0, 0, 0, 0, 0, 0];
  let state = createMemoryState({ players: ["A", "B"], pairs: 2, rng: () => sequence.shift() ?? 0 });
  const first = state.cards[0];
  const pair = state.cards.find((card) => card.pair === first.pair && card.id !== first.id);
  state = pickMemoryCard(state, first.id).state;
  state = pickMemoryCard(state, pair.id).state;
  assert.equal(state.players[0].score, 1);

  const remaining = state.cards.filter((card) => !card.matched);
  state.cards.push({ id: "extra", pair: 99, symbol: "X", faceUp: false, matched: false });
  state = pickMemoryCard(state, remaining[0].id).state;
  state = pickMemoryCard(state, "extra").state;
  assert.equal(state.pendingMismatch, true);
  state = resolveMemoryMismatch(state);
  assert.equal(state.currentPlayer, 1);
});

test("ヨットの全カテゴリー得点を計算できる", () => {
  assert.equal(scoreYachtCategory("sixes", [6, 6, 6, 2, 1]), 18);
  assert.equal(scoreYachtCategory("choice", [1, 2, 3, 4, 6]), 16);
  assert.equal(scoreYachtCategory("fourKind", [5, 5, 5, 5, 2]), 22);
  assert.equal(scoreYachtCategory("fullHouse", [3, 3, 3, 2, 2]), 13);
  assert.equal(scoreYachtCategory("smallStraight", [1, 2, 3, 4, 4]), 15);
  assert.equal(scoreYachtCategory("largeStraight", [2, 3, 4, 5, 6]), 30);
  assert.equal(scoreYachtCategory("yacht", [4, 4, 4, 4, 4]), 50);
});

test("ヨットはホールドを守ってロールし、得点後に次の人へ送る", () => {
  let state = createYachtState(["A", "B", "C"]);
  state = rollYachtDice(state, () => 0).state;
  state = toggleYachtHold(state, 0);
  state = rollYachtDice(state, () => .99).state;
  assert.equal(state.dice[0], 1);
  assert.deepEqual(state.dice.slice(1), [6, 6, 6, 6]);
  state = recordYachtScore(state, "choice").state;
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.players[0].scores.choice, 25);
});

test("ヨット上段63点には35点ボーナスが入る", () => {
  const scores = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
  assert.equal(yachtTotal(scores), 98);
});
