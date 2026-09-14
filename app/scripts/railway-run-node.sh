#!/usr/bin/env bash
# Run a local Node script INSIDE the production container, against the live
# Railway volume. Run from app/ (the Railway service is rooted there).
#
#   bash scripts/railway-run-node.sh scripts/merge-renova-into-optimal-health.cjs
#   DRY_RUN=1 bash scripts/railway-run-node.sh scripts/merge-renova-into-optimal-health.cjs
#
# Why this exists: `railway run` injects env vars into a LOCAL process (it
# reads the local data/ copy, not the volume), and the deployed standalone
# image carries neither /app/scripts nor tsx. So the script is shipped over
# `railway ssh` as a quoted heredoc (the local shell never expands its `${}`)
# and run with the container's own better-sqlite3. Env vars named in PASS are
# forwarded.
set -euo pipefail

file="${1:?usage: railway-run-node.sh <script.cjs>}"
[[ -f "$file" ]] || { echo "no such file: $file" >&2; exit 1; }
remote="/app/$file"
PASS=(DRY_RUN)

env_prefix=""
for v in "${PASS[@]}"; do
  if [[ -n "${!v:-}" ]]; then env_prefix+="$v=${!v} "; fi
done

cmd="$(python3 - "$file" "$remote" "$env_prefix" <<'PY'
import sys
src = open(sys.argv[1]).read()
remote, env_prefix = sys.argv[2], sys.argv[3]
assert "\nJS\n" not in src, "script contains the heredoc delimiter"
print(
    f"mkdir -p $(dirname {remote}) && cat > {remote} <<'JS'\n{src}\nJS\n"
    f"cd /app && {env_prefix}NODE_PATH=/app/node_modules node {remote}"
)
PY
)"

railway ssh "$cmd"
