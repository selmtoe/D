from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import torch
from torch import nn

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.ai.pipeline import (  # noqa: E402
    ACTION_FEATURE_NAMES,
    STATE_FEATURE_NAMES,
    CandidateScorer,
    DecisionExample,
    collate_examples,
    load_evidence,
    load_policy_checkpoint,
    parameter_count,
    split_by_match,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EVIDENCE = REPO_ROOT / "artifacts" / "qa" / "bot-match-evidence.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "artifacts" / "ai" / "runs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train an experimental candidate-scoring policy from deterministic QA matches."
    )
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--seed", type=int, default=20260827)
    parser.add_argument("--validation-fraction", type=float, default=0.25)
    parser.add_argument("--test-fraction", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--hidden-dim", type=int, default=96)
    parser.add_argument("--max-matches", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def configure_reproducibility(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)


def repository_metadata() -> dict[str, Any]:
    def git(*arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *arguments],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )

    revision = git("rev-parse", "HEAD")
    status = git("status", "--porcelain")
    return {
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "git_revision": revision.stdout.strip() if revision.returncode == 0 else None,
        "git_dirty": bool(status.stdout.strip()) if status.returncode == 0 else None,
    }


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("--device cuda was requested, but torch.cuda.is_available() is false")
        device = torch.device("cuda")
    elif requested == "cpu":
        device = torch.device("cpu")
    else:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    probe = torch.ones(1, device=device) * 2
    if requested == "cuda" and not probe.is_cuda:
        raise RuntimeError("CUDA was requested, but the verification tensor is not on CUDA")
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    return device


def device_metadata(requested: str, device: torch.device) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "requested": requested,
        "resolved": str(device),
        "type": device.type,
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "torch_cuda_version": torch.version.cuda,
        "verified_tensor_on_cuda": device.type == "cuda",
    }
    if device.type == "cuda":
        index = device.index if device.index is not None else torch.cuda.current_device()
        metadata.update(
            {
                "index": index,
                "name": torch.cuda.get_device_name(index),
                "capability": list(torch.cuda.get_device_capability(index)),
                "allocated_bytes_after_probe": torch.cuda.memory_allocated(index),
            }
        )
    return metadata


def prepare_run_directory(base: Path, run_name: str | None, overwrite: bool) -> Path:
    resolved_name = run_name or datetime.now(timezone.utc).strftime("run-%Y%m%dT%H%M%SZ")
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
    if not resolved_name or any(character not in allowed for character in resolved_name):
        raise ValueError("run-name may contain only letters, digits, dot, underscore, and hyphen")
    if resolved_name in {".", ".."}:
        raise ValueError("run-name must identify a child directory")
    resolved_base = base.resolve()
    run_dir = resolved_base / resolved_name
    if run_dir.parent != resolved_base:
        raise ValueError("run directory must remain directly under output-dir")
    if run_dir.exists():
        if not overwrite:
            raise FileExistsError(f"run directory already exists: {run_dir}; use --overwrite explicitly")
        if run_dir.is_symlink():
            raise ValueError("refusing to overwrite a symbolic-link run directory")
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    return run_dir


def batches(
    examples: Sequence[DecisionExample], batch_size: int, seed: int, shuffle: bool
) -> list[list[DecisionExample]]:
    indexes = list(range(len(examples)))
    if shuffle:
        random.Random(seed).shuffle(indexes)
    return [
        [examples[index] for index in indexes[start : start + batch_size]]
        for start in range(0, len(indexes), batch_size)
    ]


def evaluate(
    model: CandidateScorer,
    examples: Sequence[DecisionExample],
    batch_size: int,
    device: torch.device,
) -> dict[str, float]:
    criterion = nn.CrossEntropyLoss(reduction="none")
    total_loss = 0.0
    correct = 0
    top3_correct = 0
    reciprocal_rank = 0.0
    multi_count = 0
    multi_loss = 0.0
    multi_correct = 0
    multi_top3_correct = 0
    multi_reciprocal_rank = 0.0
    weighted_loss = 0.0
    weighted_correct = 0.0
    weight_sum = 0.0
    blind_count = 0
    blind_correct = 0
    model.eval()
    with torch.inference_mode():
        for batch in batches(examples, batch_size, seed=0, shuffle=False):
            states, actions, mask, targets = collate_examples(batch, device)
            logits = model(states, actions, mask)
            losses = criterion(logits, targets)
            weights = torch.tensor(
                [example.sample_weight for example in batch],
                dtype=torch.float32,
                device=device,
            )
            if not torch.isfinite(logits[mask]).all() or not torch.isfinite(losses).all():
                raise FloatingPointError("evaluation produced non-finite logits or losses")
            total_loss += float(losses.sum().item())
            order = logits.argsort(dim=1, descending=True)
            predictions = order[:, 0]
            correct_rows = predictions == targets
            top3_rows = (order[:, : min(3, order.shape[1])] == targets[:, None]).any(dim=1)
            correct += int(correct_rows.sum().item())
            weighted_loss += float((losses * weights).sum().item())
            weighted_correct += float((correct_rows.float() * weights).sum().item())
            weight_sum += float(weights.sum().item())
            blind_rows = torch.tensor(
                [example.blind for example in batch], dtype=torch.bool, device=device
            )
            blind_count += int(blind_rows.sum().item())
            blind_correct += int(correct_rows[blind_rows].sum().item())
            top3_correct += int(top3_rows.sum().item())
            target_ranks = (order == targets[:, None]).nonzero(as_tuple=False)[:, 1] + 1
            reciprocal_ranks = 1.0 / target_ranks.float()
            reciprocal_rank += float(reciprocal_ranks.sum().item())
            multi_rows = mask.sum(dim=1) > 1
            multi_count += int(multi_rows.sum().item())
            multi_loss += float(losses[multi_rows].sum().item())
            multi_correct += int(correct_rows[multi_rows].sum().item())
            multi_top3_correct += int(top3_rows[multi_rows].sum().item())
            multi_reciprocal_rank += float(reciprocal_ranks[multi_rows].sum().item())
    count = len(examples)
    return {
        "decision_count": float(count),
        "loss": total_loss / count,
        "accuracy": correct / count,
        "weighted_loss": weighted_loss / max(weight_sum, 1e-9),
        "weighted_accuracy": weighted_correct / max(weight_sum, 1e-9),
        "sample_weight_sum": weight_sum,
        "blind_decision_count": float(blind_count),
        "blind_accuracy": blind_correct / blind_count if blind_count else 1.0,
        "top3_accuracy": top3_correct / count,
        "mean_reciprocal_rank": reciprocal_rank / count,
        "multi_candidate_count": float(multi_count),
        "multi_candidate_loss": multi_loss / multi_count if multi_count else 0.0,
        "multi_candidate_accuracy": multi_correct / multi_count if multi_count else 1.0,
        "multi_candidate_top3_accuracy": multi_top3_correct / multi_count if multi_count else 1.0,
        "multi_candidate_mean_reciprocal_rank": (
            multi_reciprocal_rank / multi_count if multi_count else 1.0
        ),
    }


def baseline_metrics(examples: Sequence[DecisionExample]) -> dict[str, float]:
    multi = [example for example in examples if len(example.actions) > 1]
    total_weight = sum(example.sample_weight for example in examples)
    return {
        "random_expected_accuracy": sum(1.0 / len(example.actions) for example in examples)
        / len(examples),
        "first_candidate_accuracy": sum(example.target == 0 for example in examples) / len(examples),
        "weighted_first_candidate_accuracy": sum(
            example.sample_weight for example in examples if example.target == 0
        )
        / max(total_weight, 1e-9),
        "mean_candidate_count": sum(len(example.actions) for example in examples) / len(examples),
        "max_candidate_count": float(max(len(example.actions) for example in examples)),
        "forced_choice_fraction": (len(examples) - len(multi)) / len(examples),
        "multi_candidate_count": float(len(multi)),
        "multi_candidate_random_expected_accuracy": (
            sum(1.0 / len(example.actions) for example in multi) / len(multi) if multi else 1.0
        ),
        "multi_candidate_first_candidate_accuracy": (
            sum(example.target == 0 for example in multi) / len(multi) if multi else 1.0
        ),
    }


def train_model(
    model: CandidateScorer,
    train: Sequence[DecisionExample],
    validation: Sequence[DecisionExample],
    args: argparse.Namespace,
    device: torch.device,
) -> tuple[list[dict[str, Any]], dict[str, torch.Tensor], int]:
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay
    )
    criterion = nn.CrossEntropyLoss(reduction="none")
    history: list[dict[str, Any]] = []
    best_accuracy = -1.0
    best_epoch = 0
    best_state: dict[str, torch.Tensor] = {}

    for epoch in range(1, args.epochs + 1):
        epoch_started = time.perf_counter()
        model.train()
        train_loss_sum = 0.0
        for batch in batches(train, args.batch_size, seed=args.seed + epoch, shuffle=True):
            states, actions, mask, targets = collate_examples(batch, device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(states, actions, mask)
            losses = criterion(logits, targets)
            weights = torch.tensor(
                [example.sample_weight for example in batch],
                dtype=torch.float32,
                device=device,
            )
            loss = (losses * weights).sum() / weights.sum().clamp_min(1e-9)
            if not torch.isfinite(logits[mask]).all() or not torch.isfinite(loss):
                raise FloatingPointError("training produced non-finite logits or loss")
            loss.backward()
            if any(
                parameter.grad is not None and not torch.isfinite(parameter.grad).all()
                for parameter in model.parameters()
            ):
                raise FloatingPointError("training produced non-finite gradients")
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            train_loss_sum += float(loss.item()) * len(batch)
        if device.type == "cuda":
            torch.cuda.synchronize(device)
        validation_metrics = evaluate(model, validation, args.batch_size, device)
        epoch_record = {
            "epoch": epoch,
            "train_loss": train_loss_sum / len(train),
            "validation": validation_metrics,
            "duration_seconds": time.perf_counter() - epoch_started,
        }
        history.append(epoch_record)
        print(
            f"epoch={epoch:03d} train_loss={epoch_record['train_loss']:.5f} "
            f"val_loss={validation_metrics['loss']:.5f} "
            f"val_accuracy={validation_metrics['accuracy']:.4f}"
        )
        if validation_metrics["weighted_accuracy"] > best_accuracy:
            best_accuracy = validation_metrics["weighted_accuracy"]
            best_epoch = epoch
            best_state = {
                key: value.detach().cpu().clone() for key, value in model.state_dict().items()
            }
    return history, best_state, best_epoch


def atomic_json_write(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1 or args.hidden_dim < 8:
        raise ValueError("epochs/batch-size must be positive and hidden-dim must be at least 8")
    finite_arguments = {
        "validation_fraction": args.validation_fraction,
        "test_fraction": args.test_fraction,
        "learning_rate": args.learning_rate,
        "weight_decay": args.weight_decay,
    }
    if not all(math.isfinite(value) for value in finite_arguments.values()):
        raise ValueError("all floating-point arguments must be finite")
    if args.learning_rate <= 0 or args.weight_decay < 0:
        raise ValueError("learning-rate must be positive and weight-decay must be non-negative")
    started_at = datetime.now(timezone.utc)
    started = time.perf_counter()
    configure_reproducibility(args.seed)
    device = resolve_device(args.device)
    hardware = device_metadata(args.device, device)
    print(f"device={hardware['resolved']} name={hardware.get('name', 'CPU')} torch={torch.__version__}")

    dataset = load_evidence(args.evidence.resolve(), max_matches=args.max_matches)
    train, validation, test, train_ids, validation_ids, test_ids = split_by_match(
        dataset, args.validation_fraction, args.test_fraction, args.seed
    )
    split_match_sets = [
        {example.match_id for example in train},
        {example.match_id for example in validation},
        {example.match_id for example in test},
    ]
    if any(
        split_match_sets[left] & split_match_sets[right]
        for left in range(len(split_match_sets))
        for right in range(left + 1, len(split_match_sets))
    ):
        raise AssertionError("train/validation/test match leakage detected")
    train_seeds = {example.seed for example in train}
    validation_seeds = {example.seed for example in validation}
    test_seeds = {example.seed for example in test}
    if train_seeds & validation_seeds or train_seeds & test_seeds or validation_seeds & test_seeds:
        raise AssertionError("train/validation/test seed leakage detected")
    run_dir = prepare_run_directory(args.output_dir, args.run_name, args.overwrite)
    model = CandidateScorer(
        len(STATE_FEATURE_NAMES), len(ACTION_FEATURE_NAMES), hidden_dim=args.hidden_dim
    ).to(device)
    probe = next(model.parameters())
    if args.device == "cuda" and not probe.is_cuda:
        raise RuntimeError("CUDA was requested, but model parameters are not on CUDA")

    dataset_metrics = {
        "evidence_path": str(dataset.path),
        "evidence_sha256": dataset.sha256,
        "schema_version": dataset.schema_version,
        "match_count": len(dataset.match_ids),
        "decision_count": len(dataset.examples),
        "train_match_ids": list(train_ids),
        "validation_match_ids": list(validation_ids),
        "test_match_ids": list(test_ids),
        "train_seeds": sorted(train_seeds),
        "validation_seeds": sorted(validation_seeds),
        "test_seeds": sorted(test_seeds),
        "train_decisions": len(train),
        "validation_decisions": len(validation),
        "test_decisions": len(test),
        "split_leakage_count": 0,
        "seed_leakage_count": 0,
    }
    common: dict[str, Any] = {
        "schema_version": 1,
        "run_name": run_dir.name,
        "status": "dry-run" if args.dry_run else "completed",
        "started_at_utc": started_at.isoformat(),
        "reproducibility": {
            "seed": args.seed,
            "deterministic_algorithms": torch.are_deterministic_algorithms_enabled(),
            "cublas_workspace_config": os.environ.get("CUBLAS_WORKSPACE_CONFIG"),
            **repository_metadata(),
        },
        "device": hardware,
        "dataset": dataset_metrics,
        "feature_schema": {
            "state_dim": len(STATE_FEATURE_NAMES),
            "action_dim": len(ACTION_FEATURE_NAMES),
            "state_names": list(STATE_FEATURE_NAMES),
            "action_names": list(ACTION_FEATURE_NAMES),
            "excluded_teacher_fields": [
                "selected",
                "selectionReason",
                "sentCommand",
                "authorityResult",
                "authorityEvents",
                "appliedVerification",
                "auditTags",
                "candidate.label",
            ],
        },
        "model": {
            "class": "CandidateScorer",
            "hidden_dim": args.hidden_dim,
            "parameter_count": parameter_count(model),
            "legality_owner": "existing TypeScript rules/authority candidate generator",
            "objective": "outcome-weighted candidate cross entropy",
        },
        "configuration": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.learning_rate,
            "weight_decay": args.weight_decay,
            "validation_fraction": args.validation_fraction,
            "test_fraction": args.test_fraction,
            "max_matches": args.max_matches,
        },
        "baselines": {
            "train": baseline_metrics(train),
            "validation": baseline_metrics(validation),
            "test": baseline_metrics(test),
        },
    }

    if args.dry_run:
        common["duration_seconds"] = time.perf_counter() - started
        common["outputs"] = {"metrics": str(run_dir / "metrics.json"), "checkpoint": None}
        atomic_json_write(run_dir / "metrics.json", common)
        print(f"dry-run validated {len(dataset.examples)} decisions across {len(dataset.match_ids)} matches")
        print(f"metrics={run_dir / 'metrics.json'}")
        return 0

    history, best_state, best_epoch = train_model(model, train, validation, args, device)
    model.load_state_dict(best_state)
    final_train = evaluate(model, train, args.batch_size, device)
    final_validation = evaluate(model, validation, args.batch_size, device)
    final_test = evaluate(model, test, args.batch_size, device)
    checkpoint_path = run_dir / "policy.pt"
    checkpoint = {
        "state_dict": best_state,
        "metadata": {
            "schema_version": 1,
            "model_class": "CandidateScorer",
            "state_dim": len(STATE_FEATURE_NAMES),
            "action_dim": len(ACTION_FEATURE_NAMES),
            "hidden_dim": args.hidden_dim,
            "state_feature_names": STATE_FEATURE_NAMES,
            "action_feature_names": ACTION_FEATURE_NAMES,
            "dataset_sha256": dataset.sha256,
            "seed": args.seed,
            "best_epoch": best_epoch,
        },
    }
    torch.save(checkpoint, checkpoint_path)
    if device.type == "cuda":
        torch.cuda.synchronize(device)
        common["device"]["max_memory_allocated_bytes"] = torch.cuda.max_memory_allocated(device)
    checkpoint_sha256 = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
    _, _, verified_checkpoint_sha256 = load_policy_checkpoint(
        checkpoint_path, expected_sha256=checkpoint_sha256
    )
    common.update(
        {
            "duration_seconds": time.perf_counter() - started,
            "best_epoch": best_epoch,
            "history": history,
            "final_best_checkpoint_metrics": {
                "train": final_train,
                "validation": final_validation,
                "test": final_test,
            },
            "outputs": {
                "metrics": str(run_dir / "metrics.json"),
                "checkpoint": str(checkpoint_path),
                "checkpoint_bytes": checkpoint_path.stat().st_size,
                "checkpoint_sha256": checkpoint_sha256,
                "checkpoint_verified_sha256": verified_checkpoint_sha256,
            },
        }
    )
    atomic_json_write(run_dir / "metrics.json", common)
    print(
        f"best_epoch={best_epoch} validation_accuracy={final_validation['accuracy']:.4f} "
        f"test_accuracy={final_test['accuracy']:.4f}"
    )
    print(f"checkpoint={checkpoint_path}")
    print(f"metrics={run_dir / 'metrics.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
