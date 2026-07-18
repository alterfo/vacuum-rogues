#!/usr/bin/env bash
set -uo pipefail
cd /Users/olegsidorkin/SpaceRangers

LOG=tools/ai/dataset/retrain_run.log
: > "$LOG"
echo "=== $(date) retrain start ===" >> "$LOG"

# 10GB old-space ceiling: chunk 1 at the previously-documented 0.25 scale (50
# sessions) OOM'd the vitest worker at the default ~4GB heap (post
# three-year-campaign engine state is heavier per session than when the
# README's 30-40min/4-chunk timing was measured). Smaller chunks (0.1 scale =
# 20 sessions, 10 chunks) plus a bigger heap give two independent safety
# margins instead of relying on either alone.
export NODE_OPTIONS="--max-old-space-size=10240"

CHUNKS=10
SCALE=0.1
CHUNK_FILES=()
for i in $(seq 1 $CHUNKS); do
  echo "=== chunk BC$i export ===" >> "$LOG"
  chunk_file="tools/ai/dataset/train_BC$i.jsonl"
  LETSPLAY_EXPORT_MIX=1 \
  LETSPLAY_EXPORT_MIX_SESSIONS_SCALE="$SCALE" \
  LETSPLAY_EXPORT_MIX_SEED_PREFIX="BC$i" \
  LETSPLAY_EXPORT_MIX_OUTPUT="$chunk_file" \
  npm run dataset:export >> "$LOG" 2>&1
  status=$?
  echo "=== chunk BC$i export exit=$status ===" >> "$LOG"
  if [ "$status" -ne 0 ]; then
    echo "RETRAIN_FAILED chunk BC$i" >> "$LOG"
    exit 1
  fi
  echo "=== chunk BC$i validation ===" >> "$LOG"
  python3 tools/ai/dataset/validate_dataset.py "$chunk_file" >> "$LOG" 2>&1
  echo "=== chunk BC$i validation exit=$? (non-blocking, informational) ===" >> "$LOG"
  CHUNK_FILES+=("$chunk_file")
done

echo "=== concatenating chunks ===" >> "$LOG"
cat "${CHUNK_FILES[@]}" > tools/ai/dataset/train.jsonl
wc -l tools/ai/dataset/train.jsonl >> "$LOG"

echo "=== validating full dataset (best-practice gate) ===" >> "$LOG"
python3 tools/ai/dataset/validate_dataset.py tools/ai/dataset/train.jsonl >> "$LOG" 2>&1
validate_status=$?
echo "=== full-dataset validation exit=$validate_status ===" >> "$LOG"
if [ "$validate_status" -ne 0 ]; then
  echo "DATASET_VALIDATION_FAILED — see FAIL lines above; proceeding to train anyway per user instruction, review before trusting the result" >> "$LOG"
fi

echo "=== training ===" >> "$LOG"
cd tools/ai
python3 train_player.py \
  --data dataset/train.jsonl \
  --hidden 256 128 \
  --dropout 0.15 \
  --epochs 500 \
  --batch 512 \
  --lr 3e-4 \
  --val-split 0.2 \
  --patience 40 \
  --seed 0 \
  --device mps \
  --parity-out ../../src/tests/playtest/letsplay/fixtures/player.io.json \
  --out ../../src/tests/playtest/letsplay/weights/player.weights.json.new \
  >> "../../$LOG" 2>&1
status=$?
cd /Users/olegsidorkin/SpaceRangers
echo "=== training exit=$status ===" >> "$LOG"
if [ "$status" -ne 0 ]; then
  echo "RETRAIN_FAILED training" >> "$LOG"
  exit 1
fi

mv src/tests/playtest/letsplay/weights/player.weights.json.new src/tests/playtest/letsplay/weights/player.weights.json
echo "RETRAIN_DONE" >> "$LOG"
