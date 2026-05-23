#!/usr/bin/env bash
# Local secret scanner — intended as a pre-commit hook.
# Install: cp scripts/check-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# Checks staged changes (not the whole tree) so it's fast and catches
# leaks before they ever hit a branch.

set -euo pipefail

patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'                                # Anthropic
  'sk-[A-Za-z0-9]{40,}'                                      # OpenAI
  're_[A-Za-z0-9]{20,}'                                      # Resend
  'SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'               # SendGrid
  'AKIA[0-9A-Z]{16}'                                         # AWS access key
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'  # JWT (Supabase service_role etc.)
  'ghp_[A-Za-z0-9]{36,}'                                     # GitHub PAT
  'xox[abpr]-[A-Za-z0-9-]{10,}'                              # Slack token
)

bad=0
# Only scan added/modified lines in staged files. Skip deletions.
diff_output=$(git diff --cached --unified=0 --no-color --diff-filter=AM)

if [ -z "$diff_output" ]; then
  exit 0
fi

# Walk the patch; only examine '+' lines that are content (not '+++' headers).
while IFS= read -r line; do
  case "$line" in
    '+++ '*) continue ;;
    '+'*)
      for p in "${patterns[@]}"; do
        if echo "${line:1}" | grep -Eq "$p"; then
          echo "✗ Possible secret detected (pattern: $p):"
          echo "    $line"
          bad=1
        fi
      done
      ;;
  esac
done <<< "$diff_output"

if [ $bad -ne 0 ]; then
  cat <<EOF

Commit blocked by pre-commit secret scanner.

If this is a real secret:
  1. Remove it from the staged change.
  2. Put it in .env (gitignored) and production in Vercel env vars.
  3. If it was ever committed in a prior commit, ROTATE IT NOW in
     the provider dashboard — consider it burned.

If it's a false positive, bypass once with:
  git commit --no-verify
EOF
  exit 1
fi

exit 0
