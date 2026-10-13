#!/usr/bin/env bash
# Runs the "Live smoke tests" from examples/README.md in parallel and reports pass/skip/fail per
# script. Provider keys usually live in the developer's zsh profile, which a non-interactive
# shell (CI-style runners, agent tool shells) never sources — so when zsh is available this
# re-execs itself under `zsh -ic` to pick them up. Set COOLHAND_EXAMPLES_NO_ZSH=1 to use the
# current environment as-is. Build first: `npm run build`.
set -u

if [ -z "${COOLHAND_EXAMPLES_IN_ZSH:-}" ] && [ -z "${COOLHAND_EXAMPLES_NO_ZSH:-}" ] && command -v zsh >/dev/null 2>&1; then
  exec env COOLHAND_EXAMPLES_IN_ZSH=1 zsh -ic 'exec bash "$0"' "${BASH_SOURCE[0]}"
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

if [ ! -f dist/index.js ]; then
  echo "dist/ is missing — run 'npm run build' first." >&2
  exit 2
fi

scripts=(openai-example anthropic-example basic feedback-example)
logs=$(mktemp -d)

for s in "${scripts[@]}"; do
  (node "examples/$s.js" > "$logs/$s.log" 2>&1; echo "$?" > "$logs/$s.exit") &
done
wait

failed=0
for s in "${scripts[@]}"; do
  code=$(cat "$logs/$s.exit")
  if [ "$code" != 0 ] || grep -q '❌' "$logs/$s.log"; then
    echo "FAIL  $s (exit $code)"
    tail -n 8 "$logs/$s.log" | cut -c1-200 | sed 's/^/        /'
    failed=1
  elif grep -q '^Skipping' "$logs/$s.log"; then
    echo "SKIP  $s — $(grep -m1 '^Skipping' "$logs/$s.log")"
  else
    echo "PASS  $s"
  fi
done

echo "logs: $logs"
exit "$failed"
