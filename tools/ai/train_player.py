#!/usr/bin/env python3
"""Train the letsplay player policy by behavioural cloning, export weights JSON.

This is the **Python side** of the pure-TS MLP pipeline (the TS data-gen lives in
``src/tests/playtest/letsplay/exportBcData.ts``). It takes the JSONL dataset that
exporter produces — one ``{"features": [...], "action": <int>}`` row per teacher
step — and fits a multi-layer perceptron as a multi-class classifier
(cross-entropy over the 16-action vocabulary), then exports the trained weights as
JSON in the exact shape ``src/tests/playtest/letsplay/mlp.ts`` loads.

Behavioural cloning means **no environment in the training loop**: the teacher
(``MemoryHeuristicPolicy``) has already labelled each observation with its
action, so this is plain supervised learning. Drop the exported
``*.weights.json`` where ``NeuralPolicy`` loads it (dev-only) to let the net
think for the player.

Weight orientation matches PyTorch ``nn.Linear``: each layer's ``W`` is
``[outDim][inDim]`` and ``b`` is ``[outDim]`` — exporting ``.weight``/``.bias``
straight to lists needs no transpose, and ``mlp.ts`` reads that layout verbatim.
``mlp.ts`` re-applies ReLU between layers and leaves the final layer linear, so
**only the Linear layers are exported, in order** — ``nn.ReLU``/``nn.Dropout``
are skipped (they carry no parameters and are implicit/inert at inference).

Usage (small local smoke run)::

    python3 tools/ai/train_player.py \
        --data .letsplay/bc-dataset.jsonl \
        --out  src/tests/playtest/letsplay/weights/player.weights.json \
        --hidden 32 --epochs 200 --seed 0

Usage (the RTX 4090 target architecture, 50→256→128→16)::

    python3 tools/ai/train_player.py \
        --data train.jsonl \
        --hidden 256 128 \
        --dropout 0.15 \
        --epochs 500 \
        --batch 512 \
        --lr 3e-4 \
        --val-split 0.2 \
        --device cuda \
        --out player.weights.json

Requires PyTorch (``pip install torch``); train on the RTX 4090 for the full
dataset. This script and the contract test pin the *format*, not a shipped
model.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

# Must match ACTION_ORDER in src/tests/playtest/letsplay/observe.ts — the net's
# output head has one score per action slot: move, warp, land, dock, trade,
# take-quest, attack, flee, repair, wait, buy-gear, upgrade-hull, buy-module,
# take-loan, repay-loan, sell-cargo.
NUM_ACTIONS = 16


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


def build_model(in_dim: int, hidden: list[int], dropout: float, num_actions: int):
    """Build an ``nn.Sequential`` with N hidden ``Linear+ReLU(+Dropout)`` blocks.

    ``hidden`` is the list of hidden-layer widths in order (e.g. ``[256, 128]``
    for the 4090 architecture, ``[32]`` for the tiny reference net). Dropout is
    omitted entirely when ``dropout <= 0`` rather than inserted as a no-op, so
    a zero-dropout export still round-trips through ``export_weights`` cleanly.
    """
    import torch.nn as nn  # local import: keep module import torch-free

    layers: list[nn.Module] = []
    prev = in_dim
    for width in hidden:
        layers.append(nn.Linear(prev, width))
        layers.append(nn.ReLU())
        if dropout > 0:
            layers.append(nn.Dropout(dropout))
        prev = width
    layers.append(nn.Linear(prev, num_actions))
    return nn.Sequential(*layers)


def resolve_device(name: str):
    """Resolve ``--device`` with an auto-detect fallback chain cuda → mps → cpu.

    An explicit request for an unavailable backend (e.g. ``--device cuda`` on a
    machine with no GPU) degrades to the next backend down the chain with a
    warning rather than crashing — the same script runs unmodified on a dev
    laptop (smoke test) and the RTX 4090 (real training).
    """
    import torch

    def cuda_ok() -> bool:
        return torch.cuda.is_available()

    def mps_ok() -> bool:
        return bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()

    if name == "auto":
        if cuda_ok():
            return torch.device("cuda")
        if mps_ok():
            return torch.device("mps")
        return torch.device("cpu")

    if name == "cuda" and not cuda_ok():
        print("warning: --device cuda requested but unavailable, falling back", file=sys.stderr)
        return resolve_device("auto" if not mps_ok() else "mps")
    if name == "mps" and not mps_ok():
        print("warning: --device mps requested but unavailable, falling back to cpu", file=sys.stderr)
        return torch.device("cpu")
    return torch.device(name)


def export_weights(model, out_path: Path) -> None:
    """Write the trained model's Linear layers as MlpWeights JSON.

    Only ``nn.Linear`` layers are emitted (in order); ``nn.ReLU``/``nn.Dropout``
    are skipped since they carry no parameters and are implicit in ``mlp.ts``
    (ReLU applied between layers, linear on the last; dropout is inference-inert
    even if it were exported). ``W`` is ``[outDim][inDim]`` exactly as PyTorch
    stores ``.weight``.
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
        from torch.utils.data import DataLoader, TensorDataset, random_split
    except ImportError:  # pragma: no cover - environment-dependent
        sys.exit(
            "PyTorch is required to train: pip install torch "
            "(train on the RTX 4090)."
        )

    torch.manual_seed(args.seed)
    feats, labels = load_dataset(Path(args.data))
    in_dim = len(feats[0])
    device = resolve_device(args.device)
    print(
        f"loaded {len(feats)} rows, feature width {in_dim}, "
        f"{NUM_ACTIONS} action classes, device={device}"
    )

    x = torch.tensor(feats, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)
    dataset = TensorDataset(x, y)

    val_size = int(len(dataset) * args.val_split)
    train_size = len(dataset) - val_size
    if val_size > 0:
        train_set, val_set = random_split(
            dataset,
            [train_size, val_size],
            generator=torch.Generator().manual_seed(args.seed),
        )
    else:
        train_set, val_set = dataset, None

    train_loader = DataLoader(
        train_set,
        batch_size=args.batch,
        shuffle=True,
        num_workers=args.num_workers,
    )
    val_loader = (
        DataLoader(val_set, batch_size=args.batch, shuffle=False, num_workers=args.num_workers)
        if val_set is not None
        else None
    )

    model = build_model(in_dim, args.hidden, args.dropout, NUM_ACTIONS).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, args.epochs))
    loss_fn = nn.CrossEntropyLoss()

    best_val_loss = float("inf")
    best_state = copy.deepcopy(model.state_dict())
    patience_counter = 0
    log_every = max(1, args.epochs // 20)

    for epoch in range(args.epochs):
        model.train()
        train_loss_sum = 0.0
        train_correct = 0
        train_total = 0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            logits = model(xb)
            loss = loss_fn(logits, yb)
            loss.backward()
            opt.step()
            train_loss_sum += loss.item() * xb.size(0)
            train_correct += (logits.argmax(dim=1) == yb).sum().item()
            train_total += xb.size(0)
        scheduler.step()
        train_loss = train_loss_sum / max(1, train_total)
        train_acc = train_correct / max(1, train_total)

        if val_loader is not None:
            model.eval()
            val_loss_sum = 0.0
            val_correct = 0
            val_total = 0
            with torch.no_grad():
                for xb, yb in val_loader:
                    xb, yb = xb.to(device), yb.to(device)
                    logits = model(xb)
                    loss = loss_fn(logits, yb)
                    val_loss_sum += loss.item() * xb.size(0)
                    val_correct += (logits.argmax(dim=1) == yb).sum().item()
                    val_total += xb.size(0)
            val_loss = val_loss_sum / max(1, val_total)
            val_acc = val_correct / max(1, val_total)

            if val_loss < best_val_loss - 1e-6:
                best_val_loss = val_loss
                best_state = copy.deepcopy(model.state_dict())
                patience_counter = 0
            else:
                patience_counter += 1
        else:
            val_loss, val_acc = train_loss, train_acc
            best_state = copy.deepcopy(model.state_dict())

        if (epoch + 1) % log_every == 0 or epoch == 0:
            print(
                f"epoch {epoch + 1:>4}/{args.epochs}  "
                f"train_loss={train_loss:.4f} train_acc={train_acc:.3f}  "
                f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}"
            )

        if val_loader is not None and patience_counter >= args.patience:
            print(f"early stopping at epoch {epoch + 1} (patience={args.patience})")
            break

    model.load_state_dict(best_state)
    export_weights(model, Path(args.out))
    print(f"exported weights → {args.out}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", required=True, help="JSONL BC dataset path")
    p.add_argument("--out", required=True, help="output weights JSON path")
    p.add_argument(
        "--hidden",
        type=int,
        nargs="+",
        default=[32],
        help="hidden layer widths, e.g. --hidden 256 128",
    )
    p.add_argument("--dropout", type=float, default=0.0, help="dropout after each hidden ReLU")
    p.add_argument("--epochs", type=int, default=200)
    p.add_argument("--batch", type=int, default=512, help="mini-batch size")
    p.add_argument("--lr", type=float, default=1e-2)
    p.add_argument("--val-split", type=float, default=0.0, help="fraction held out for validation")
    p.add_argument("--patience", type=int, default=30, help="early-stopping patience on val loss")
    p.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "mps", "cpu"],
        help="auto-detects cuda → mps → cpu when unspecified/unavailable",
    )
    p.add_argument("--num-workers", type=int, default=0, help="DataLoader worker processes")
    p.add_argument("--seed", type=int, default=0)
    train(p.parse_args())


if __name__ == "__main__":
    main()
