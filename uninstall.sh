#!/usr/bin/env bash
# uninstall.sh — remove the session-mirror plugin and the opencode-mirror CLI.
set -euo pipefail

PURGE=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./uninstall.sh [options]

Options:
  --purge     Also delete the mirror directory (~/.local/share/opencode-mirror).
  --dry-run   Show what would be done, without changing anything.
  -h, --help  Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --purge)   PURGE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DST="$CONFIG_DIR/plugins/session-mirror.ts"
CLI_DST="${XDG_BIN_HOME:-$HOME/.local/bin}/opencode-mirror"
MIRROR_DIR="$HOME/.local/share/opencode-mirror"

do_rm() { if [ "$DRY_RUN" -eq 1 ]; then printf '  [dry-run] rm -rf %s\n' "$1"; else rm -rf "$1"; fi; }

for f in "$PLUGIN_DST" "$CLI_DST"; do
  if [ -e "$f" ] || [ -L "$f" ]; then
    echo "removing $f"
    do_rm "$f"
    if [ -e "$f.bak" ]; then
      echo "  (backup left at $f.bak)"
    fi
  else
    echo "not found: $f"
  fi
done

if [ "$PURGE" -eq 1 ]; then
  echo "purging mirror: $MIRROR_DIR"
  do_rm "$MIRROR_DIR"
else
  echo "mirror kept at: $MIRROR_DIR"
fi

echo "Done."
