#!/usr/bin/env python3
"""Validate a letsplay BC dataset JSONL before training.

Reads the {"features": number[], "action": int} rows exportBcData.ts /
scenarioMixExport.run.test.ts write, and prints:
  - row count + feature width
  - action-index distribution (flags any index with zero rows — a dead head
    `train_player.py` cannot learn — or a near-zero head too sparse to
    validate reliably)
  - per-feature-column mean/std/min/max (flags NaNs/Infs and constant/dead
    columns)
  - extremes/range check — `featurize` contracts every value into [0,1], so
    any value outside that band (beyond a small float-noise tolerance) is a
    real bug in the exporter, not a modelling choice
  - statistical outliers — per-column values beyond mean ± 6*std, a cheap
    smell test independent of the hard [0,1] contract
  - exact-duplicate rows — a high duplicate ratio usually means a degenerate
    (stuck/looping) session flooding the dataset with one repeated state

No third-party dependencies (stdlib only), so it runs before `pip install torch`.

Exit code is non-zero on any finding that would make a training run a waste of
time (NaN/Inf, feature-width mismatch, a dead action head, or out-of-contract
feature values) — a CI-style gate, not just a print. Soft findings (sparse-but
-nonzero heads, statistical outliers, duplicates) print WARNING but do not fail
the run; use `--strict` to fail on those too.

Usage:
  python3 tools/ai/dataset/validate_dataset.py path/to/train.jsonl [--strict]
"""

import argparse
import json
import math
import sys

FEATURE_LO = 0.0
FEATURE_HI = 1.0
RANGE_TOLERANCE = 1e-6
OUTLIER_Z = 6.0
SPARSE_HEAD_ROWS = 20
SPARSE_HEAD_FRACTION = 0.001
DUPLICATE_WARN_FRACTION = 0.05


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also fail on soft findings (sparse heads, outliers, duplicates)",
    )
    args = parser.parse_args()
    path = args.dataset

    n = 0
    max_action = -1
    action_counts: dict[int, int] = {}
    feature_len = None
    sums: list[float] = []
    sums_sq: list[float] = []
    mins: list[float] = []
    maxs: list[float] = []
    nan_cols: set[int] = set()
    inf_cols: set[int] = set()
    out_of_range_cols: dict[int, int] = {}
    out_of_range_worst: dict[int, float] = {}
    seen_hashes: dict[int, int] = {}
    duplicate_rows = 0

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
                if math.isinf(v):
                    inf_cols.add(i)
                    continue
                if v < FEATURE_LO - RANGE_TOLERANCE or v > FEATURE_HI + RANGE_TOLERANCE:
                    out_of_range_cols[i] = out_of_range_cols.get(i, 0) + 1
                    worst = out_of_range_worst.get(i, 0.0)
                    if abs(v - 0.5) > abs(worst - 0.5):
                        out_of_range_worst[i] = v
                sums[i] += v
                sums_sq[i] += v * v
                if v < mins[i]:
                    mins[i] = v
                if v > maxs[i]:
                    maxs[i] = v

            action_counts[action] = action_counts.get(action, 0) + 1
            max_action = max(max_action, action)

            row_hash = hash((tuple(features), action))
            if row_hash in seen_hashes:
                duplicate_rows += 1
            else:
                seen_hashes[row_hash] = line_no

            n += 1

    if n == 0 or feature_len is None:
        print("empty dataset", file=sys.stderr)
        return 1

    hard_failure = False
    soft_failure = False

    print(f"rows: {n}")
    print(f"feature width: {feature_len}")
    print()

    print("action distribution:")
    for a in range(max_action + 1):
        c = action_counts.get(a, 0)
        print(f"  [{a}] {c} ({100.0 * c / n:.1f}%)")
    dead = [a for a in range(max_action + 1) if action_counts.get(a, 0) == 0]
    sparse = [
        a
        for a in range(max_action + 1)
        if 0 < action_counts.get(a, 0) < max(SPARSE_HEAD_ROWS, SPARSE_HEAD_FRACTION * n)
    ]
    if dead:
        print(f"  FAIL: no rows for action index(es): {dead} (dead head)")
        hard_failure = True
    if sparse:
        print(
            f"  WARNING: sparse action index(es) {sparse} "
            f"(< {SPARSE_HEAD_ROWS} rows or {SPARSE_HEAD_FRACTION * 100:.1f}% of dataset) — "
            "too few examples for a reliable val-split estimate on this head"
        )
        soft_failure = True
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
    print()

    if nan_cols:
        print(f"FAIL: NaN values encountered in column(s): {sorted(nan_cols)}")
        hard_failure = True
    if inf_cols:
        print(f"FAIL: Inf/-Inf values encountered in column(s): {sorted(inf_cols)}")
        hard_failure = True
    if dead_cols:
        print(f"WARNING: constant (dead) feature column(s): {dead_cols}")
        soft_failure = True

    if out_of_range_cols:
        print(
            f"FAIL: {sum(out_of_range_cols.values())} value(s) outside the "
            f"[{FEATURE_LO}, {FEATURE_HI}] featurize contract, across "
            f"{len(out_of_range_cols)} column(s):"
        )
        for i in sorted(out_of_range_cols)[:20]:
            print(
                f"  [{i:2d}] {out_of_range_cols[i]} offending row(s), "
                f"worst value seen={out_of_range_worst[i]:.6f}"
            )
        hard_failure = True

    # Statistical outliers — informational only, independent of the hard
    # [0,1] contract above (catches a column that stays in-range but has a
    # suspiciously extreme tail relative to its own distribution).
    outlier_cols = []
    for i in range(feature_len):
        mean = sums[i] / n
        var = max(0.0, sums_sq[i] / n - mean * mean)
        std = math.sqrt(var)
        if std < 1e-9:
            continue
        lo_z = (mins[i] - mean) / std
        hi_z = (maxs[i] - mean) / std
        if abs(lo_z) > OUTLIER_Z or abs(hi_z) > OUTLIER_Z:
            outlier_cols.append((i, lo_z, hi_z))
    if outlier_cols:
        print(
            f"\nWARNING: {len(outlier_cols)} column(s) with a >|{OUTLIER_Z}|-sigma "
            "extreme value (min/max relative to that column's own mean/std):"
        )
        for i, lo_z, hi_z in outlier_cols[:20]:
            print(f"  [{i:2d}] min_z={lo_z:.1f} max_z={hi_z:.1f}")
        soft_failure = True

    if duplicate_rows:
        frac = duplicate_rows / n
        loud = "  <-- HIGH, investigate" if frac > DUPLICATE_WARN_FRACTION else ""
        print(
            f"\nWARNING: {duplicate_rows} exact-duplicate (features, action) row(s) "
            f"({100.0 * frac:.2f}%){loud} — a high ratio usually means a stuck/looping "
            "session flooded the dataset with one repeated state, and inflates "
            "--val-split accuracy via train/val leakage (identical rows can land on "
            "both sides of the split)"
        )
        soft_failure = True

    print()
    if hard_failure:
        print("RESULT: FAIL — do not train on this dataset until the above is fixed.")
        return 1
    if soft_failure:
        print("RESULT: PASS with warnings.")
        if args.strict:
            print("(--strict set: treating warnings as failure)")
            return 1
        return 0
    print("RESULT: PASS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
