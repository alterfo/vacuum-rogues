#!/usr/bin/env bash
# context-inject.sh — surface the active ralphex task's **Files:** block.
#
# Purpose: at the start of a ralphex task iteration the model has a cold context.
# Instead of re-reading the whole plan to find what the current task touches, run
# this to print the task title, its `**Files:**` block, and each file's on-disk
# status (existing line count, or "to be created"). Pair it with the vacuum MCP
# `find_symbol` tool to jump straight to the relevant line ranges. See the
# orientation preamble in .ralphex/prompts/task.txt for the intended workflow.
#
# Usage:
#   tools/context-inject.sh <plan-file> [task-number]
#
#   <plan-file>    path to a ralphex plan (e.g. docs/plans/20260614-ai-dev-tooling.md)
#   [task-number]  optional; default = the first Task/Iteration with an unchecked [ ] box
#
# Exit codes: 0 ok · 1 usage error · 2 plan file or matching task not found.
#
# Compatible with macOS' default bash 3.2 (no associative arrays / mapfile).
set -euo pipefail

usage() {
  echo "usage: tools/context-inject.sh <plan-file> [task-number]" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 1
fi

plan_file="$1"
want_task="${2:-}"

if [ ! -f "$plan_file" ]; then
  echo "context-inject: plan file not found: $plan_file" >&2
  exit 2
fi

# Repo root = parent of the tools/ directory that holds this script.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

# awk extracts the target task. It emits tab-separated control lines:
#   TITLE <num> <title>
#   FILE  <verb> <path>
#   ERROR <message>
awk_output="$(
  awk -v want="$want_task" '
    function flush_path(line,   rest, parts, path, verb) {
      if (match(line, /(Create|Modify|Delete):/)) {
        verb = substr(line, RSTART, RLENGTH - 1)
        rest = substr(line, RSTART + RLENGTH)
        gsub(/`/, "", rest)
        sub(/^[ \t]+/, "", rest)
        split(rest, parts, /[ \t]+/)
        path = parts[1]
        if (path != "") {
          tnum = t
          fcount[tnum]++
          fverb[tnum, fcount[tnum]] = verb
          fpath[tnum, fcount[tnum]] = path
        }
      }
    }
    BEGIN { t = 0; infiles = 0; ntasks = 0 }
    # Task/Iteration header opens a new task block.
    /^###[ \t]+(Task|Iteration)[ \t]+[0-9]+:/ {
      ntasks++
      t = ntasks
      infiles = 0
      match($0, /[0-9]+/); num[t] = substr($0, RSTART, RLENGTH)
      title = $0
      sub(/^###[ \t]+(Task|Iteration)[ \t]+[0-9]+:[ \t]*/, "", title)
      ttitle[t] = title
      unchecked[t] = 0
      fcount[t] = 0
      next
    }
    # Any other ### or ## header ends the current task block.
    /^###[ \t]/ || /^##[ \t]/ { t = 0; infiles = 0; next }
    t == 0 { next }
    /^\*\*Files:\*\*/ { infiles = 1; next }
    /- \[ \]/ { unchecked[t] = 1 }
    {
      if (infiles) {
        if ($0 ~ /^[ \t]*-[ \t]+(Create|Modify|Delete):/) {
          flush_path($0)
        } else if ($0 ~ /^[ \t]*$/) {
          infiles = 0
        } else if ($0 !~ /^[ \t]*-/) {
          infiles = 0
        }
      }
    }
    END {
      target = 0
      if (want != "") {
        for (i = 1; i <= ntasks; i++) if (num[i] == want) { target = i; break }
        if (target == 0) { printf "ERROR\ttask %s not found in plan\n", want; exit }
      } else {
        for (i = 1; i <= ntasks; i++) if (unchecked[i] == 1) { target = i; break }
        if (target == 0) { printf "ERROR\tno task with an unchecked [ ] box\n"; exit }
      }
      printf "TITLE\t%s\t%s\n", num[target], ttitle[target]
      for (j = 1; j <= fcount[target]; j++) {
        printf "FILE\t%s\t%s\n", fverb[target, j], fpath[target, j]
      }
    }
  ' "$plan_file"
)"

# Render the awk control lines into a human/agent-readable report.
printed_header=0
while IFS="$(printf '\t')" read -r kind a b; do
  case "$kind" in
    ERROR)
      echo "context-inject: $a" >&2
      exit 2
      ;;
    TITLE)
      echo "Active task $a: $b"
      echo "Files:"
      printed_header=1
      ;;
    FILE)
      abs="$repo_root/$b"
      if [ -f "$abs" ]; then
        lines="$(wc -l < "$abs" | tr -d ' ')"
        echo "  [$a] $b — exists, ${lines} lines"
      else
        echo "  [$a] $b — to be created"
      fi
      ;;
  esac
done <<EOF
$awk_output
EOF

if [ "$printed_header" -eq 1 ]; then
  echo
  echo "Tip: use the vacuum MCP 'find_symbol' tool to jump to exact line numbers,"
  echo "then read only the ranges you need — not whole files."
fi
