from __future__ import annotations

import json
import hashlib
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import torch

from tools.ai.pipeline import (
    ACTION_FEATURE_NAMES,
    STATE_FEATURE_NAMES,
    CandidateScorer,
    collate_examples,
    load_evidence,
    load_policy_checkpoint,
    split_by_match,
)
from tools.ai.train import prepare_run_directory


def candidate(card_id: str, label: str) -> dict[str, object]:
    return {
        "kind": "play",
        "label": label,
        "cardIds": [card_id],
        "mimics": [],
        "commandName": "submitPlay",
        "payload": {"cardIds": [card_id], "mimics": [], "blindConfirmed": False},
    }


def decision(game_id: str, sequence: int, selected_index: int) -> dict[str, object]:
    first = candidate(f"{game_id}-card-a", f"spade-3({game_id}-card-a)")
    second = candidate(f"{game_id}-card-b", f"heart-4({game_id}-card-b)")
    return {
        "sequence": sequence,
        "actorId": "p1",
        "observation": {
            "phase": "playing",
            "revision": sequence,
            "gameId": game_id,
            "currentPlayerId": "p1",
            "field": [],
            "hand": {
                "count": 2,
                "visible": [f"spade-3({game_id}-card-a)", f"heart-4({game_id}-card-b)"],
                "hiddenPositions": [],
            },
            "players": [
                {"id": "p1", "status": "active", "cardCount": 2},
                {"id": "p2", "status": "active", "cardCount": 2},
            ],
            "pendingEffects": [],
            "ruleFlags": {"revolution": False, "jackBack": False, "direction": 1, "suitLock": []},
        },
        "legalCandidates": [first, second],
        "selected": [first, second][selected_index],
        "selectionReason": "must never become a feature",
        "authorityResult": {"ok": True},
        "sampleWeight": 2.5,
    }


class PipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "evidence.json"
        bundle = {
            "schemaVersion": 1,
            "matches": [
                {
                    "matchId": f"match-{index}",
                    "seed": 100 + index,
                    "mode": "normal" if index % 2 else "blind",
                    "decisions": [decision(f"game-{index}", 1, index % 2)],
                }
                for index in range(4)
            ],
        }
        self.path.write_text(json.dumps(bundle), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_features_and_match_split_are_valid(self) -> None:
        dataset = load_evidence(self.path)
        train, validation, test, train_ids, validation_ids, test_ids = split_by_match(
            dataset, 0.25, 0.25, 7
        )
        self.assertTrue(train)
        self.assertTrue(validation)
        self.assertTrue(test)
        self.assertTrue(set(train_ids).isdisjoint(validation_ids))
        self.assertTrue(set(train_ids).isdisjoint(test_ids))
        self.assertTrue(set(validation_ids).isdisjoint(test_ids))
        train_seeds = {example.seed for example in train}
        validation_seeds = {example.seed for example in validation}
        test_seeds = {example.seed for example in test}
        self.assertTrue(train_seeds.isdisjoint(validation_seeds))
        self.assertTrue(train_seeds.isdisjoint(test_seeds))
        self.assertTrue(validation_seeds.isdisjoint(test_seeds))
        self.assertEqual(len(dataset.examples[0].state), len(STATE_FEATURE_NAMES))
        self.assertEqual(len(dataset.examples[0].actions[0]), len(ACTION_FEATURE_NAMES))
        self.assertNotIn("must never become a feature", STATE_FEATURE_NAMES)
        self.assertNotIn("must never become a feature", ACTION_FEATURE_NAMES)
        self.assertEqual(dataset.examples[0].sample_weight, 2.5)
        self.assertTrue(dataset.examples[0].blind)

    def test_teacher_only_fields_do_not_change_features(self) -> None:
        original = load_evidence(self.path)
        bundle = json.loads(self.path.read_text(encoding="utf-8"))
        for match in bundle["matches"]:
            for item in match["decisions"]:
                item["selectionReason"] = "different teacher explanation"
                item["authorityResult"] = {"ok": False, "error": "post-state must stay out"}
                item["appliedVerification"] = {"revisionAfter": 999999}
                item["auditTags"] = ["teacher-only"]
                for legal in item["legalCandidates"]:
                    legal["label"] = "changed candidate label"
                item["selected"]["label"] = "changed selected label"
        changed_path = Path(self.temp_dir.name) / "teacher-fields-changed.json"
        changed_path.write_text(json.dumps(bundle), encoding="utf-8")
        changed = load_evidence(changed_path)

        self.assertEqual(original.examples, changed.examples)

    def test_non_finite_json_is_rejected(self) -> None:
        invalid = Path(self.temp_dir.name) / "invalid.json"
        invalid.write_text('{"schemaVersion": 1, "matches": NaN}', encoding="utf-8")
        with self.assertRaises(ValueError):
            load_evidence(invalid)

    def test_invalid_sample_weight_is_rejected(self) -> None:
        bundle = json.loads(self.path.read_text(encoding="utf-8"))
        bundle["matches"][0]["decisions"][0]["sampleWeight"] = 0
        invalid = Path(self.temp_dir.name) / "invalid-weight.json"
        invalid.write_text(json.dumps(bundle), encoding="utf-8")
        with self.assertRaises(ValueError):
            load_evidence(invalid)

    def test_masked_candidate_scorer_never_selects_padding(self) -> None:
        dataset = load_evidence(self.path)
        one_candidate = replace(
            dataset.examples[0], actions=dataset.examples[0].actions[:1], target=0
        )
        examples = [one_candidate, dataset.examples[1]]
        device = torch.device("cpu")
        states, actions, mask, targets = collate_examples(examples, device)
        model = CandidateScorer(len(STATE_FEATURE_NAMES), len(ACTION_FEATURE_NAMES), hidden_dim=16)
        logits = model(states, actions, mask)
        self.assertEqual(tuple(logits.shape), (2, 2))
        self.assertTrue(torch.isfinite(logits[mask]).all())
        self.assertEqual(logits[0, 1].item(), torch.finfo(logits.dtype).min)
        self.assertEqual(logits[0].argmax().item(), 0)
        loss = torch.nn.functional.cross_entropy(logits, targets)
        loss.backward()
        self.assertTrue(torch.isfinite(loss))

    def test_run_directory_cannot_escape_output_directory(self) -> None:
        with self.assertRaises(ValueError):
            prepare_run_directory(Path(self.temp_dir.name), "..", overwrite=True)
        with self.assertRaises(ValueError):
            prepare_run_directory(Path(self.temp_dir.name), "nested/run", overwrite=True)

    def test_checkpoint_loader_verifies_hash_and_schema(self) -> None:
        model = CandidateScorer(len(STATE_FEATURE_NAMES), len(ACTION_FEATURE_NAMES), hidden_dim=16)
        checkpoint_path = Path(self.temp_dir.name) / "policy.pt"
        torch.save(
            {
                "state_dict": model.state_dict(),
                "metadata": {
                    "schema_version": 1,
                    "model_class": "CandidateScorer",
                    "state_dim": len(STATE_FEATURE_NAMES),
                    "action_dim": len(ACTION_FEATURE_NAMES),
                    "hidden_dim": 16,
                    "state_feature_names": STATE_FEATURE_NAMES,
                    "action_feature_names": ACTION_FEATURE_NAMES,
                },
            },
            checkpoint_path,
        )
        digest = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
        restored, metadata, verified_digest = load_policy_checkpoint(checkpoint_path, digest)
        self.assertEqual(metadata["hidden_dim"], 16)
        self.assertEqual(verified_digest, digest)
        self.assertEqual(
            list(model.state_dict()),
            list(restored.state_dict()),
        )
        with self.assertRaises(ValueError):
            load_policy_checkpoint(checkpoint_path, "0" * 64)


if __name__ == "__main__":
    unittest.main()
