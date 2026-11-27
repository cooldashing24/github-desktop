#!/bin/sh

SCRIPT_PATH="$(readlink -f "$0")"
APP_DIR="$(dirname "$(dirname "$(dirname "$(dirname "$SCRIPT_PATH")")")")"

case "${1:-}" in
  x-github-*|--cli-*)
    exec "$APP_DIR/desktop" "$@"
    ;;
  *)
    ELECTRON_RUN_AS_NODE=1 exec "$APP_DIR/desktop" "$APP_DIR/resources/app/cli.js" "$@"
    ;;
esac
