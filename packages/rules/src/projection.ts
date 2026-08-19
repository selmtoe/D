import type { GameState, ProjectedGameState, ProjectedHandCard, Viewer } from "./types.js";

export function projectGame(state: GameState, viewer: Viewer): ProjectedGameState {
  const viewerPlayer =
    viewer.playerId === undefined
      ? undefined
      : state.players.find((player) => player.id === viewer.playerId);
  const seesAll =
    viewer.spectator === true || viewerPlayer === undefined || viewerPlayer.status !== "active";
  const players = state.players.map((player) => ({
    ...player,
    hand: player.hand.map((entry, position): ProjectedHandCard => {
      const maySeeFace = seesAll || player.id === viewer.playerId || entry.blind;
      return {
        id: entry.card.id,
        blind: entry.blind,
        position,
        ...(maySeeFace && !(player.id === viewer.playerId && entry.blind && !seesAll)
          ? { face: { suit: entry.card.suit, rank: entry.card.rank } }
          : {}),
      };
    }),
  }));
  const {
    deck,
    effectBatch: _effectBatch,
    appliedActionIds: _appliedActionIds,
    players: _players,
    ...publicState
  } = state;
  return { ...publicState, players, deckCount: deck.length };
}
