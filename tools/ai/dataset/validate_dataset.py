#!/usr/bin/env python3
"""Validate a letsplay BC dataset JSONL before training.

Reads the {"features": number[], "action": int} rows exportBcData.ts /
scenarioMixExport.run.test.ts write, and prints:
  - row count + feature width
  - action-index distribution (flags any index with zero rows — a dead head
    `train_player.py` cannot learn)
  - per-feature-column mean/std/min/max (flags NaNs and constant/dead columns)

No third-party dependencies (stdlib only), so it runs before `pip install torch`.

Usage:
  python3 tools/ai/dataset/validate_dataset.py path/to/train.jsonl
"""

import json
import math
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_dataset.py <dataset.jsonl>", file=sys.stderr)
        return 1
    path = sys.argv[1]

    n = 0
    max_action = -1
    action_counts: dict[int, int] = {}
    feature_len = None
    sums: list[float] = []
    sums_sq: list[float] = []
    mins: list[float] = []
    maxs: list[float] = []
    nan_cols: set[int] = set()

    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            features = row["features"]
            action = row["action"]

            if feature_len is None:
                feature_len = len(features)
                sums = [0.0] * feature_len
                sums_sq = [0.0] * feature_len
                mins = [math.inf] * feature_len
                maxs = [-math.inf] * feature_len
            elif len(features) != feature_len:
                print(
                    f"line {line_no}: feature length {len(features)} != {feature_len}",
                    file=sys.stderr,
                )
                return 1

            for i, v in enumerate(features):
                if v != v:  # NaN
                    nan_cols.add(i)
                    continue
                sums[i] += v
                sums_sq[i] += v * v
                if v < mins[i]:
                    mins[i] = v
                if v > maxs[i]:
                    maxs[i] = v

            action_counts[action] = action_counts.get(action, 0) + 1
            max_action = max(max_action, action)
            n += 1

    if n == 0 or feature_len is None:
        print("empty dataset", file=sys.stderr)
        return 1

    print(f"rows: {n}")
    print(f"feature width: {feature_len}")
    print()

    print("action distribution:")
    for a in range(max_action + 1):
        c = action_counts.get(a, 0)
        print(f"  [{a}] {c} ({100.0 * c / n:.1f}%)")
    missing = [a for a in range(max_action + 1) if action_counts.get(a, 0) == 0]
    if missing:
        print(f"  WARNING: no rows for action index(es): {missing} (dead head)")
    print()

    print("feature stats (mean, std, min, max):")
    dead_cols = []
    for i in range(feature_len):
        mean = sums[i] / n
        var = max(0.0, sums_sq[i] / n - mean * mean)
        std = math.sqrt(var)
        lo, hi = mins[i], maxs[i]
        flag = ""
        if hi - lo < 1e-9:
            dead_cols.append(i)
            flag = "  <- CONSTANT"
        print(f"  [{i:2d}] mean={mean:.4f} std={std:.4f} min={lo:.4f} max={hi:.4f}{flag}")

    if nan_cols:
        print(f"\nWARNING: NaN values encountered in column(s): {sorted(nan_cols)}")
    if dead_cols:
        print(f"\nWARNING: constant (dead) feature column(s): {dead_cols}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
