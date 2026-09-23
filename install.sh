#!/usr/bin/env bash
# install.sh — install the session-mirror plugin and the opencode-mirror CLI.
#
# Default mode copies the files. Use --link to symlink them instead (useful when you
# edit this repository and want OpenCode to reload the plugin live).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/plugin/session-mirror.ts"
CLI_SRC="$SCRIPT_DIR/bin/opencode-mirror"

MODE="copy"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --link      Symlink instead of copy (edit the repo and the plugin reloads live).
  --dry-run   Show what would be done, without changing anything.
  -h, --help  Show this help.

Installs:
  plugin/session-mirror.ts -> ${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/session-mirror.ts
  bin/opencode-mirror      -> ${XDG_BIN_HOME:-$HOME/.local/bin}/opencode-mirror
EOF
}

for arg in "$@"; do
  case "$arg" in
    --link)    MODE="link" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$CONFIG_DIR/plugins"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
PLUGIN_DST="$PLUGIN_DIR/session-mirror.ts"
CLI_DST="$BIN_DIR/opencode-mirror"

do_mkdir() { if [ "$DRY_RUN" -eq 1 ]; then printf '  [dry-run] mkdir -p %s\n' "$1"; else mkdir -p "$1"; fi; }
do_cp()    { if [ "$DRY_RUN" -eq 1 ]; then printf '  [dry-run] cp %s -> %s\n' "$1" "$2"; else cp -f "$1" "$2"; fi; }
do_ln()    { if [ "$DRY_RUN" -eq 1 ]; then printf '  [dry-run] ln -sfn %s -> %s\n' "$1" "$2"; else ln -sfn "$1" "$2"; fi; }
do_chmod() { if [ "$DRY_RUN" -eq 1 ]; then printf '  [dry-run] chmod +x %s\n' "$1"; else chmod +x "$1"; fi; }

echo "session-mirror installer"
echo "  plugin -> $PLUGIN_DST"
echo "  cli    -> $CLI_DST"
echo "  mode   -> $MODE"
echo

[ -f "$PLUGIN_SRC" ] || { echo "ERROR: missing $PLUGIN_SRC" >&2; exit 1; }
[ -f "$CLI_SRC" ]    || { echo "ERROR: missing $CLI_SRC" >&2; exit 1; }

for c in opencode python3 git; do
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "WARNING: '$c' not found in PATH (required for full functionality)" >&2
  fi
done

do_mkdir "$PLUGIN_DIR"
do_mkdir "$BIN_DIR"

# Back up existing regular files (never follow/clobber a symlink we do not own).
for dst in "$PLUGIN_DST" "$CLI_DST"; do
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    do_cp "$dst" "$dst.bak"
  fi
done

if [ "$MODE" = "link" ]; then
  do_ln "$PLUGIN_SRC" "$PLUGIN_DST"
  do_ln "$CLI_SRC" "$CLI_DST"
  do_chmod "$CLI_SRC"
else
  do_cp "$PLUGIN_SRC" "$PLUGIN_DST"
  do_cp "$CLI_SRC" "$CLI_DST"
  do_chmod "$CLI_DST"
fi

echo
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "NOTE: $BIN_DIR is not in your PATH. Add this to your shell profile:"
     echo "      export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

echo "Done. OpenCode auto-discovers plugins in $PLUGIN_DIR (no restart needed)."
echo "Try:  opencode-mirror status"
