#!/usr/bin/env python3
"""Train the letsplay player policy by behavioural cloning, export weights JSON.

This is the **Python side** of the pure-TS MLP pipeline (the TS data-gen lives in
``src/tests/playtest/letsplay/exportBcData.ts``). It takes the JSONL dataset that
exporter produces — one ``{"features": [...], "action": <int>}`` row per teacher
step — and fits the tiny multi-layer perceptron as a multi-class classifier
(cross-entropy over the 10-action vocabulary), then exports the trained weights as
JSON in the exact shape ``src/tests/playtest/letsplay/mlp.ts`` loads.

Behavioural cloning means **no environment in the training loop**: the teacher
(the heuristic policy today, the memory-using teacher later) has already labelled
each observation with its action, so this is plain supervised learning. Drop the
exported ``*.weights.json`` where ``NeuralPolicy`` loads it (dev-only) to let the
net think for the player.

Weight orientation matches PyTorch ``nn.Linear``: each layer's ``W`` is
``[outDim][inDim]`` and ``b`` is ``[outDim]`` — exporting ``.weight``/``.bias``
straight to lists needs no transpose, and ``mlp.ts`` reads that layout verbatim.
``mlp.ts`` re-applies ReLU between layers and leaves the final layer linear, so
**only the Linear layers are exported, in order** (no activation metadata).

Usage::

    python3 tools/ai/train_player.py \
        --data .letsplay/bc-dataset.jsonl \
        --out  src/tests/playtest/letsplay/weights/player.weights.json \
        --hidden 32 --epochs 200 --seed 0

Requires PyTorch (``pip install torch``); train on the RTX 4090. The actual run
is a manual Post-Completion step — this script and the contract test pin the
*format*, not a shipped model.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Must match ACTION_ORDER in src/tests/playtest/letsplay/observe.ts — the net's
# output head has one score per action slot. (move, warp, land, dock, trade,
# take-quest, attack, flee, repair, wait.)
NUM_ACTIONS = 10


def load_dataset(path: Path) -> tuple[list[list[float]], list[int]]:
    """Load a JSONL BC dataset into ``(features, labels)`` lists.

    Validates that every row has a consistent feature width and an in-range
    action label, so a malformed dataset fails loudly before training.
    """
    features: list[list[float]] = []
    labels: list[int] = []
    width: int | None = None
    with path.open("r", encoding="utf8") as fh:
        for lineno, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            feats = row["features"]
            action = int(row["action"])
            if width is None:
                width = len(feats)
            elif len(feats) != width:
                raise ValueError(
                    f"{path}:{lineno}: feature width {len(feats)} != {width}"
                )
            if not (0 <= action < NUM_ACTIONS):
                raise ValueError(
                    f"{path}:{lineno}: action {action} out of range "
                    f"[0, {NUM_ACTIONS})"
                )
            features.append([float(x) for x in feats])
            labels.append(action)
    if not features:
        raise ValueError(f"{path}: no rows")
    return features, labels


def export_weights(model, out_path: Path) -> None:
    """Write the trained model's Linear layers as MlpWeights JSON.

    Only ``nn.Linear`` layers are emitted (in order); ReLU is implicit in
    ``mlp.ts`` (applied between layers, linear on the last). ``W`` is
    ``[outDim][inDim]`` exactly as PyTorch stores ``.weight``.
    """
    import torch.nn as nn  # local import: keep module import torch-free

    layers = []
    for module in model:
        if isinstance(module, nn.Linear):
            layers.append(
                {
                    "W": module.weight.detach().cpu().tolist(),
                    "b": module.bias.detach().cpu().tolist(),
                }
            )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"layers": layers}, indent=2), encoding="utf8")


def train(args: argparse.Namespace) -> None:
    try:
        import torch
        import torch.nn as nn
    except ImportError:  # pragma: no cover - environment-dependent
        sys.exit(
            "PyTorch is required to train: pip install torch "
            "(train on the RTX 4090)."
        )

    torch.manual_seed(args.seed)
    feats, labels = load_dataset(Path(args.data))
    in_dim = len(feats[0])
    print(
        f"loaded {len(feats)} rows, feature width {in_dim}, "
        f"{NUM_ACTIONS} action classes"
    )

    x = torch.tensor(feats, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)

    model = nn.Sequential(
        nn.Linear(in_dim, args.hidden),
        nn.ReLU(),
        nn.Linear(args.hidden, NUM_ACTIONS),
    )
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    loss_fn = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(args.epochs):
        opt.zero_grad()
        logits = model(x)
        loss = loss_fn(logits, y)
        loss.backward()
        opt.step()
        if (epoch + 1) % max(1, args.epochs // 10) == 0 or epoch == 0:
            with torch.no_grad():
                acc = (logits.argmax(dim=1) == y).float().mean().item()
            print(f"epoch {epoch + 1:>4}/{args.epochs}  loss={loss.item():.4f}  acc={acc:.3f}")

    export_weights(model, Path(args.out))
    print(f"exported weights → {args.out}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", required=True, help="JSONL BC dataset path")
    p.add_argument("--out", required=True, help="output weights JSON path")
    p.add_argument("--hidden", type=int, default=32, help="hidden layer width")
    p.add_argument("--epochs", type=int, default=200)
    p.add_argument("--lr", type=float, default=1e-2)
    p.add_argument("--seed", type=int, default=0)
    train(p.parse_args())


if __name__ == "__main__":
    main()
