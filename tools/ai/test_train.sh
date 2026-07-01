#!/usr/bin/env bash
# Smoke test for tools/ai/train_player.py — generates a tiny random BC-shaped
# dataset (50 features / 16 actions, matching the current letsplay contract)
# and runs a few epochs end-to-end, so a pipeline crash (bad arg wiring, a
# device fallback bug, an export shape regression) surfaces before spending a
# real training run on the RTX 4090. Not a gate — run manually before a
# retrain, or after touching train_player.py.
set -euo pipefail

cd "$(dirname "$0")"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

DATA="$TMP_DIR/smoke.jsonl"
OUT="$TMP_DIR/smoke.weights.json"

python3 - "$DATA" <<'PYEOF'
import json
import random
import sys

path = sys.argv[1]
random.seed(0)
with open(path, "w", encoding="utf8") as fh:
    for _ in range(200):
        features = [random.random() for _ in range(50)]
        action = random.randrange(16)
        fh.write(json.dumps({"features": features, "action": action}) + "\n")
PYEOF

python3 train_player.py \
    --data "$DATA" \
    --out "$OUT" \
    --hidden 16 8 \
    --dropout 0.1 \
    --epochs 3 \
    --batch 32 \
    --val-split 0.2 \
    --patience 30 \
    --device cpu \
    --num-workers 0

python3 - "$OUT" <<'PYEOF'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf8") as fh:
    data = json.load(fh)
layers = data.get("layers", [])
assert len(layers) == 3, f"expected 3 Linear layers (2 hidden + output), got {len(layers)}"
assert len(layers[0]["W"]) == 16 and len(layers[0]["W"][0]) == 50, "layer 0 shape mismatch"
assert len(layers[-1]["W"]) == 16, "output layer must have 16 action scores"
print(f"smoke test OK: {len(layers)} Linear layers exported")
PYEOF

echo "tools/ai/train_player.py smoke test passed"
