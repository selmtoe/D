from __future__ import annotations

import hashlib
import json
import math
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import torch
from torch import Tensor, nn


RANKS = ("3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "JOKER")
SUITS = ("spade", "heart", "diamond", "club")
PHASES = ("lobby", "playing", "finished")
PLAYER_STATUSES = ("active", "finished", "disqualified", "other")
PENDING_EFFECTS = ("steal", "give", "discard", "bomber", "collect", "clearField")
COMMANDS = (
    "submitPlay",
    "submitPass",
    "declareJokerMimic",
    "resolveSteal",
    "resolveGive",
    "resolveDiscard",
    "resolveBomber",
    "resolveCollect",
)
KINDS = ("play", "pass", "effect", "joker-mimic")
MAX_PLAYERS = 6
MAX_EVIDENCE_BYTES = 256 * 1024 * 1024
MAX_MATCHES = 16_384
MAX_DECISIONS_PER_MATCH = 100_000
MAX_TOTAL_DECISIONS = 2_000_000
MAX_CANDIDATES_PER_DECISION = 512
MAX_IDENTIFIER_LENGTH = 256

_CARD_RE = re.compile(
    r"(?:blind-revealed:)?(?:(?P<joker>JOKER)|(?P<suit>spade|heart|diamond|club)-"
    r"(?P<rank>3|4|5|6|7|8|9|10|J|Q|K|A|2))\((?P<card_id>[^)]+)\)"
)


@dataclass(frozen=True)
class ParsedCard:
    card_id: str
    rank: str
    suit: str | None


@dataclass(frozen=True)
class DecisionExample:
    match_id: str
    seed: int
    sequence: int
    state: tuple[float, ...]
    actions: tuple[tuple[float, ...], ...]
    target: int


@dataclass(frozen=True)
class EvidenceDataset:
    path: Path
    sha256: str
    schema_version: int
    examples: tuple[DecisionExample, ...]
    match_ids: tuple[str, ...]
    match_seeds: dict[str, int]


def _one_hot(value: str, vocabulary: Sequence[str]) -> list[float]:
    return [1.0 if value == item else 0.0 for item in vocabulary]


def _safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _reject_nonfinite_json(value: str) -> None:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


def _bounded_identifier(value: Any, field: str) -> str:
    result = str(value)
    if not result or len(result) > MAX_IDENTIFIER_LENGTH:
        raise ValueError(f"{field} must contain 1-{MAX_IDENTIFIER_LENGTH} characters")
    return result


def _clamp_ratio(value: int | float, denominator: float) -> float:
    return max(0.0, min(float(value) / denominator, 1.0))


def parse_card_label(label: Any) -> ParsedCard | None:
    if not isinstance(label, str):
        return None
    match = _CARD_RE.search(label)
    if not match:
        return None
    joker = match.group("joker")
    return ParsedCard(
        card_id=match.group("card_id"),
        rank="JOKER" if joker else match.group("rank"),
        suit=None if joker else match.group("suit"),
    )


def _card_catalog(observation: dict[str, Any]) -> dict[str, ParsedCard]:
    hand = _safe_dict(observation.get("hand"))
    pending_mimic = _safe_dict(observation.get("pendingJokerMimic"))
    labels = [
        *_safe_list(hand.get("visible")),
        *_safe_list(observation.get("field")),
        *_safe_list(pending_mimic.get("revealed")),
    ]
    cards = [card for card in map(parse_card_label, labels) if card is not None]
    return {card.card_id: card for card in cards}


def _rank_histogram(cards: Iterable[ParsedCard]) -> list[float]:
    counts = {rank: 0 for rank in RANKS}
    for card in cards:
        counts[card.rank] += 1
    return [_clamp_ratio(counts[rank], 4.0 if rank != "JOKER" else 2.0) for rank in RANKS]


def _suit_histogram(cards: Iterable[ParsedCard]) -> list[float]:
    counts = {suit: 0 for suit in SUITS}
    for card in cards:
        if card.suit is not None:
            counts[card.suit] += 1
    return [_clamp_ratio(counts[suit], 13.0) for suit in SUITS]


def state_feature_names() -> tuple[str, ...]:
    names: list[str] = []
    names.extend(f"phase:{phase}" for phase in PHASES)
    names.extend(("mode:normal", "mode:blind", "player_count", "own_hand_count", "own_visible_count", "own_hidden_count"))
    names.extend(f"own_rank:{rank}" for rank in RANKS)
    names.extend(f"own_suit:{suit}" for suit in SUITS)
    names.append("field_count")
    names.extend(f"field_rank:{rank}" for rank in RANKS)
    names.extend(f"field_suit:{suit}" for suit in SUITS)
    names.extend(("revolution", "jack_back", "direction_forward"))
    names.extend(f"suit_lock:{suit}" for suit in SUITS)
    names.append("pending_effect_count")
    names.extend(f"pending_effect:{kind}" for kind in PENDING_EFFECTS)
    names.extend(("pending_required_count", "pending_joker_mimic", "pending_joker_candidate_count"))
    for seat in range(MAX_PLAYERS):
        names.extend(
            (
                f"seat{seat}:present",
                f"seat{seat}:self",
                f"seat{seat}:current",
                f"seat{seat}:card_count",
            )
        )
        names.extend(f"seat{seat}:status:{status}" for status in PLAYER_STATUSES)
    return tuple(names)


def action_feature_names() -> tuple[str, ...]:
    names: list[str] = []
    names.extend(f"command:{command}" for command in COMMANDS)
    names.append("command:other")
    names.extend(f"kind:{kind}" for kind in KINDS)
    names.extend(("card_count", "known_card_count", "unknown_card_count"))
    names.extend(f"card_rank:{rank}" for rank in RANKS)
    names.extend(f"card_suit:{suit}" for suit in SUITS)
    names.extend(("target_count", "target_unknown"))
    names.extend(f"target_relative_seat:{seat}" for seat in range(MAX_PLAYERS))
    names.extend(f"bomber_rank:{rank}" for rank in RANKS)
    names.extend(("mimic_count", "blind_confirmed", "authority_judged_blind"))
    return tuple(names)


STATE_FEATURE_NAMES = state_feature_names()
ACTION_FEATURE_NAMES = action_feature_names()


def encode_state(observation: dict[str, Any], actor_id: str, mode: str) -> tuple[float, ...]:
    hand = _safe_dict(observation.get("hand"))
    visible_cards = [
        card for card in map(parse_card_label, _safe_list(hand.get("visible"))) if card is not None
    ]
    hidden_positions = _safe_list(hand.get("hiddenPositions"))
    field_cards = [
        card for card in map(parse_card_label, _safe_list(observation.get("field"))) if card is not None
    ]
    players = [_safe_dict(player) for player in _safe_list(observation.get("players"))]
    actor_index = next(
        (index for index, player in enumerate(players) if player.get("id") == actor_id),
        0,
    )
    relative_players = players[actor_index:] + players[:actor_index]
    pending_effects = [
        _safe_dict(effect) for effect in _safe_list(observation.get("pendingEffects"))
    ]
    rule_flags = _safe_dict(observation.get("ruleFlags"))
    suit_lock = set(str(suit) for suit in _safe_list(rule_flags.get("suitLock")))
    pending_mimic = _safe_dict(observation.get("pendingJokerMimic"))

    features: list[float] = []
    features.extend(_one_hot(str(observation.get("phase", "")), PHASES))
    features.extend((1.0 if mode == "normal" else 0.0, 1.0 if mode == "blind" else 0.0))
    features.extend(
        (
            _clamp_ratio(len(players), MAX_PLAYERS),
            _clamp_ratio(hand.get("count", 0), 54.0),
            _clamp_ratio(len(visible_cards), 54.0),
            _clamp_ratio(len(hidden_positions), 54.0),
        )
    )
    features.extend(_rank_histogram(visible_cards))
    features.extend(_suit_histogram(visible_cards))
    features.append(_clamp_ratio(len(field_cards), 54.0))
    features.extend(_rank_histogram(field_cards))
    features.extend(_suit_histogram(field_cards))
    features.extend(
        (
            1.0 if rule_flags.get("revolution") else 0.0,
            1.0 if rule_flags.get("jackBack") else 0.0,
            1.0 if rule_flags.get("direction") == 1 else 0.0,
        )
    )
    features.extend(1.0 if suit in suit_lock else 0.0 for suit in SUITS)
    features.append(_clamp_ratio(len(pending_effects), 6.0))
    features.extend(
        1.0 if any(effect.get("kind") == kind for effect in pending_effects) else 0.0
        for kind in PENDING_EFFECTS
    )
    features.extend(
        (
            _clamp_ratio(sum(int(effect.get("requiredCount", 0)) for effect in pending_effects), 6.0),
            1.0 if pending_mimic else 0.0,
            _clamp_ratio(pending_mimic.get("candidateCount", 0), 16.0),
        )
    )

    current_player_id = observation.get("currentPlayerId")
    for seat in range(MAX_PLAYERS):
        if seat >= len(relative_players):
            features.extend((0.0,) * (4 + len(PLAYER_STATUSES)))
            continue
        player = relative_players[seat]
        player_id = player.get("id")
        status = str(player.get("status", "other"))
        normalized_status = status if status in PLAYER_STATUSES[:-1] else "other"
        features.extend(
            (
                1.0,
                1.0 if player_id == actor_id else 0.0,
                1.0 if player_id == current_player_id else 0.0,
                _clamp_ratio(player.get("cardCount", 0), 54.0),
            )
        )
        features.extend(_one_hot(normalized_status, PLAYER_STATUSES))

    if len(features) != len(STATE_FEATURE_NAMES):
        raise ValueError(f"state feature size mismatch: {len(features)} != {len(STATE_FEATURE_NAMES)}")
    if not all(math.isfinite(value) for value in features):
        raise ValueError("state features contain a non-finite value")
    return tuple(features)


def _candidate_card_ids(candidate: dict[str, Any]) -> list[str]:
    direct = [str(card_id) for card_id in _safe_list(candidate.get("cardIds"))]
    payload = _safe_dict(candidate.get("payload"))
    payload_ids = [str(card_id) for card_id in _safe_list(payload.get("cardIds"))]
    transfer_ids = [
        str(transfer.get("cardId"))
        for transfer in map(_safe_dict, _safe_list(payload.get("transfers")))
        if transfer.get("cardId") is not None
    ]
    selection_ids = [
        str(selection.get("cardId"))
        for selection in map(_safe_dict, _safe_list(payload.get("selections")))
        if selection.get("cardId") is not None
    ]
    result: list[str] = []
    for card_id in [*direct, *payload_ids, *transfer_ids, *selection_ids]:
        if card_id not in result:
            result.append(card_id)
    return result


def _candidate_target_ids(candidate: dict[str, Any]) -> list[str]:
    payload = _safe_dict(candidate.get("payload"))
    targets = [
        item.get("targetUid")
        for item in [
            *map(_safe_dict, _safe_list(payload.get("transfers"))),
            *map(_safe_dict, _safe_list(payload.get("selections"))),
        ]
    ]
    result: list[str] = []
    for target in targets:
        if target is not None and str(target) not in result:
            result.append(str(target))
    return result


def encode_action(
    candidate: dict[str, Any], observation: dict[str, Any], actor_id: str
) -> tuple[float, ...]:
    command = str(candidate.get("commandName", ""))
    kind = str(candidate.get("kind", ""))
    payload = _safe_dict(candidate.get("payload"))
    catalog = _card_catalog(observation)
    card_ids = _candidate_card_ids(candidate)
    known_cards = [catalog[card_id] for card_id in card_ids if card_id in catalog]
    unknown_count = len(card_ids) - len(known_cards)

    players = [_safe_dict(player) for player in _safe_list(observation.get("players"))]
    actor_index = next(
        (index for index, player in enumerate(players) if player.get("id") == actor_id),
        0,
    )
    relative_ids = [player.get("id") for player in players[actor_index:] + players[:actor_index]]
    target_ids = _candidate_target_ids(candidate)
    target_seats = [
        relative_ids.index(target_id) for target_id in target_ids if target_id in relative_ids
    ]
    unknown_targets = len(target_ids) - len(target_seats)
    bomber_ranks = {
        "JOKER" if str(rank).upper() == "JOKER" else str(rank)
        for rank in _safe_list(payload.get("ranks"))
    }
    mimics = _safe_list(candidate.get("mimics")) or _safe_list(payload.get("mimics"))

    features: list[float] = []
    features.extend(_one_hot(command, COMMANDS))
    features.append(1.0 if command not in COMMANDS else 0.0)
    features.extend(_one_hot(kind, KINDS))
    features.extend(
        (
            _clamp_ratio(len(card_ids), 8.0),
            _clamp_ratio(len(known_cards), 8.0),
            _clamp_ratio(unknown_count, 8.0),
        )
    )
    features.extend(_rank_histogram(known_cards))
    features.extend(_suit_histogram(known_cards))
    features.extend((_clamp_ratio(len(target_ids), MAX_PLAYERS), _clamp_ratio(unknown_targets, MAX_PLAYERS)))
    features.extend(1.0 if seat in target_seats else 0.0 for seat in range(MAX_PLAYERS))
    features.extend(1.0 if rank in bomber_ranks else 0.0 for rank in RANKS)
    features.extend(
        (
            _clamp_ratio(len(mimics), 8.0),
            1.0 if payload.get("blindConfirmed") else 0.0,
            1.0 if candidate.get("authorityJudgedBlind") else 0.0,
        )
    )

    if len(features) != len(ACTION_FEATURE_NAMES):
        raise ValueError(f"action feature size mismatch: {len(features)} != {len(ACTION_FEATURE_NAMES)}")
    if not all(math.isfinite(value) for value in features):
        raise ValueError("action features contain a non-finite value")
    return tuple(features)


def _candidate_identity(candidate: dict[str, Any]) -> str:
    # Human labels and selection reasons are deliberately excluded. Only the action sent
    # to the authority is used to locate the teacher's choice inside the candidate set.
    identity = {
        "kind": candidate.get("kind"),
        "commandName": candidate.get("commandName"),
        "payload": candidate.get("payload", {}),
        "cardIds": candidate.get("cardIds", []),
        "mimics": candidate.get("mimics", []),
        "authorityJudgedBlind": candidate.get("authorityJudgedBlind", False),
    }
    return json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_evidence(path: Path, max_matches: int | None = None) -> EvidenceDataset:
    if path.stat().st_size > MAX_EVIDENCE_BYTES:
        raise ValueError(f"evidence exceeds {MAX_EVIDENCE_BYTES} bytes")
    raw = path.read_bytes()
    bundle = json.loads(raw, parse_constant=_reject_nonfinite_json)
    if not isinstance(bundle, dict):
        raise ValueError("evidence root must be an object")
    if bundle.get("schemaVersion") != 1:
        raise ValueError(f"unsupported evidence schema: {bundle.get('schemaVersion')!r}")
    matches = _safe_list(bundle.get("matches"))
    if len(matches) > MAX_MATCHES:
        raise ValueError(f"evidence exceeds {MAX_MATCHES} matches")
    if max_matches is not None:
        if max_matches < 2:
            raise ValueError("max_matches must be at least 2 so train/validation stay disjoint")
        matches = matches[:max_matches]
    if len(matches) < 2:
        raise ValueError("at least two matches are required")

    examples: list[DecisionExample] = []
    match_ids: list[str] = []
    match_seeds: dict[str, int] = {}
    for raw_match in matches:
        match = _safe_dict(raw_match)
        match_id = _bounded_identifier(match.get("matchId", ""), "matchId")
        if match_id in match_seeds:
            raise ValueError(f"invalid or duplicate matchId: {match_id!r}")
        seed = int(match.get("seed"))
        mode = str(match.get("mode", "normal"))
        match_ids.append(match_id)
        match_seeds[match_id] = seed
        raw_decisions = _safe_list(match.get("decisions"))
        if not raw_decisions:
            raise ValueError(f"match contains no decisions: {match_id}")
        if len(raw_decisions) > MAX_DECISIONS_PER_MATCH:
            raise ValueError(
                f"match {match_id} exceeds {MAX_DECISIONS_PER_MATCH} decisions"
            )
        for raw_decision in raw_decisions:
            decision = _safe_dict(raw_decision)
            actor_id = _bounded_identifier(decision.get("actorId", ""), "actorId")
            observation = _safe_dict(decision.get("observation"))
            candidates = [_safe_dict(item) for item in _safe_list(decision.get("legalCandidates"))]
            selected = _safe_dict(decision.get("selected"))
            if not candidates or not selected:
                raise ValueError(f"malformed decision in {match_id}")
            if len(candidates) > MAX_CANDIDATES_PER_DECISION:
                raise ValueError(
                    f"decision in {match_id} exceeds {MAX_CANDIDATES_PER_DECISION} candidates"
                )
            selected_identity = _candidate_identity(selected)
            target_indexes = [
                index
                for index, candidate in enumerate(candidates)
                if _candidate_identity(candidate) == selected_identity
            ]
            if len(target_indexes) != 1:
                raise ValueError(
                    f"selected candidate is not unique in {match_id} sequence={decision.get('sequence')}"
                )
            examples.append(
                DecisionExample(
                    match_id=match_id,
                    seed=seed,
                    sequence=int(decision.get("sequence", 0)),
                    state=encode_state(observation, actor_id, mode),
                    actions=tuple(
                        encode_action(candidate, observation, actor_id) for candidate in candidates
                    ),
                    target=target_indexes[0],
                )
            )
            if len(examples) > MAX_TOTAL_DECISIONS:
                raise ValueError(f"evidence exceeds {MAX_TOTAL_DECISIONS} decisions")
    if not examples:
        raise ValueError("evidence contains no decisions")
    return EvidenceDataset(
        path=path,
        sha256=hashlib.sha256(raw).hexdigest(),
        schema_version=1,
        examples=tuple(examples),
        match_ids=tuple(match_ids),
        match_seeds=match_seeds,
    )


def split_by_match(
    dataset: EvidenceDataset,
    validation_fraction: float,
    test_fraction: float,
    seed: int,
) -> tuple[
    tuple[DecisionExample, ...],
    tuple[DecisionExample, ...],
    tuple[DecisionExample, ...],
    tuple[str, ...],
    tuple[str, ...],
    tuple[str, ...],
]:
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("validation_fraction must be between 0 and 1")
    if not 0.0 < test_fraction < 1.0:
        raise ValueError("test_fraction must be between 0 and 1")
    if validation_fraction + test_fraction >= 1.0:
        raise ValueError("validation_fraction + test_fraction must be below 1")
    unique_seeds = sorted(set(dataset.match_seeds.values()))
    if len(unique_seeds) < 3:
        raise ValueError("at least three distinct match seeds are required")
    random.Random(seed).shuffle(unique_seeds)
    validation_count = max(
        1, min(len(unique_seeds) - 2, round(len(unique_seeds) * validation_fraction))
    )
    test_count = max(1, min(len(unique_seeds) - validation_count - 1, round(len(unique_seeds) * test_fraction)))
    validation_seeds = set(unique_seeds[:validation_count])
    test_seeds = set(unique_seeds[validation_count : validation_count + test_count])
    validation_ids = tuple(
        sorted(
            match_id
            for match_id in dataset.match_ids
            if dataset.match_seeds[match_id] in validation_seeds
        )
    )
    test_ids = tuple(
        sorted(
            match_id
            for match_id in dataset.match_ids
            if dataset.match_seeds[match_id] in test_seeds
        )
    )
    train_ids = tuple(
        sorted(
            match_id
            for match_id in dataset.match_ids
            if match_id not in validation_ids and match_id not in test_ids
        )
    )
    train_set = set(train_ids)
    validation_set = set(validation_ids)
    test_set = set(test_ids)
    if train_set & validation_set or train_set & test_set or validation_set & test_set:
        raise AssertionError("match leakage between train, validation, and test splits")
    train = tuple(example for example in dataset.examples if example.match_id in train_set)
    validation = tuple(example for example in dataset.examples if example.match_id in validation_set)
    test = tuple(example for example in dataset.examples if example.match_id in test_set)
    if not train or not validation or not test:
        raise ValueError("train, validation, and test splits must all contain decisions")
    return train, validation, test, train_ids, validation_ids, test_ids


def collate_examples(examples: Sequence[DecisionExample], device: torch.device) -> tuple[Tensor, Tensor, Tensor, Tensor]:
    if not examples:
        raise ValueError("cannot collate an empty batch")
    batch_size = len(examples)
    max_candidates = max(len(example.actions) for example in examples)
    states = torch.tensor([example.state for example in examples], dtype=torch.float32, device=device)
    actions = torch.zeros(
        (batch_size, max_candidates, len(ACTION_FEATURE_NAMES)),
        dtype=torch.float32,
        device=device,
    )
    mask = torch.zeros((batch_size, max_candidates), dtype=torch.bool, device=device)
    targets = torch.tensor([example.target for example in examples], dtype=torch.long, device=device)
    for row, example in enumerate(examples):
        count = len(example.actions)
        actions[row, :count] = torch.tensor(example.actions, dtype=torch.float32, device=device)
        mask[row, :count] = True
    return states, actions, mask, targets


class CandidateScorer(nn.Module):
    def __init__(self, state_dim: int, action_dim: int, hidden_dim: int = 96) -> None:
        super().__init__()
        self.state_encoder = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
        )
        self.action_encoder = nn.Sequential(
            nn.Linear(action_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
        )
        self.scorer = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, 1),
        )

    def forward(self, states: Tensor, actions: Tensor, mask: Tensor) -> Tensor:
        state_hidden = self.state_encoder(states).unsqueeze(1).expand(-1, actions.shape[1], -1)
        action_hidden = self.action_encoder(actions)
        logits = self.scorer(torch.cat((state_hidden, action_hidden), dim=-1)).squeeze(-1)
        return logits.masked_fill(~mask, torch.finfo(logits.dtype).min)


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def load_policy_checkpoint(
    path: Path,
    expected_sha256: str | None = None,
) -> tuple[CandidateScorer, dict[str, Any], str]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if expected_sha256 is not None and digest.lower() != expected_sha256.lower():
        raise ValueError("checkpoint SHA-256 does not match the expected digest")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict):
        raise ValueError("checkpoint root must be an object")
    metadata = checkpoint.get("metadata")
    state_dict = checkpoint.get("state_dict")
    if not isinstance(metadata, dict) or not isinstance(state_dict, dict):
        raise ValueError("checkpoint must contain metadata and state_dict objects")
    if metadata.get("schema_version") != 1 or metadata.get("model_class") != "CandidateScorer":
        raise ValueError("unsupported checkpoint schema or model class")
    if tuple(metadata.get("state_feature_names", ())) != STATE_FEATURE_NAMES:
        raise ValueError("checkpoint state feature schema does not match this runtime")
    if tuple(metadata.get("action_feature_names", ())) != ACTION_FEATURE_NAMES:
        raise ValueError("checkpoint action feature schema does not match this runtime")
    state_dim = int(metadata.get("state_dim", 0))
    action_dim = int(metadata.get("action_dim", 0))
    hidden_dim = int(metadata.get("hidden_dim", 0))
    if state_dim != len(STATE_FEATURE_NAMES) or action_dim != len(ACTION_FEATURE_NAMES):
        raise ValueError("checkpoint feature dimensions do not match this runtime")
    if hidden_dim < 8 or hidden_dim > 4096:
        raise ValueError("checkpoint hidden dimension is outside the supported range")
    if not all(isinstance(value, Tensor) and torch.isfinite(value).all() for value in state_dict.values()):
        raise ValueError("checkpoint state_dict contains invalid tensors")
    model = CandidateScorer(state_dim, action_dim, hidden_dim=hidden_dim)
    model.load_state_dict(state_dict, strict=True)
    model.eval()
    return model, metadata, digest
