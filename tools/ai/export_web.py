from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

from pipeline import load_policy_checkpoint


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a verified CandidateScorer checkpoint for the browser runtime."
    )
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    model, metadata, digest = load_policy_checkpoint(args.checkpoint, args.sha256)
    state_dict = model.state_dict()
    tensors = {}
    for name, tensor in state_dict.items():
        values = tensor.detach().cpu().float().contiguous().numpy()
        raw = values.astype("<f4", copy=False).tobytes()
        tensors[name] = {
            "length": int(values.size),
            "base64": base64.b64encode(raw).decode("ascii"),
        }
    payload = {
        "schemaVersion": 1,
        "modelClass": "CandidateScorer",
        "sourceCheckpointSha256": digest,
        "stateDim": int(metadata["state_dim"]),
        "actionDim": int(metadata["action_dim"]),
        "hiddenDim": int(metadata["hidden_dim"]),
        "tensorEncoding": "float32-le-base64",
        "stateFeatureNames": list(metadata["state_feature_names"]),
        "actionFeatureNames": list(metadata["action_feature_names"]),
        "tensors": tensors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(f"exported={args.output}")
    print(f"checkpoint_sha256={digest}")
    print(f"parameters={sum(value['length'] for value in tensors.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
