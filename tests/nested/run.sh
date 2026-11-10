#!/bin/bash
# Usage: tests/nested/run.sh <scenario> [out_dir]
# Runs a probe scenario inside a nested GNOME Shell with the working tree's
# extension enabled. Exit 0 iff report.json has "ok": true.
# Scenario "none": no probe, no report; the shell stays up until its devkit
# window is closed (for interactive testing).
set -u
SCENARIO="${1:?usage: run.sh <scenario> [out_dir]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(realpath -m "${2:-$(mktemp -d)}")"
mkdir -p "$OUT"
rm -f "$OUT/report.json" "$OUT/report.json.tmp"

if [ "${NESTED_INNER:-}" != 1 ]; then
  TMP="$(mktemp -d)"
  UUID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["uuid"])' "$ROOT/metadata.json")"
  PROBE_UUID="probe@search-light-glass.test"
  EXT="$TMP/data/gnome-shell/extensions/$UUID"
  mkdir -p "$EXT" "$TMP/data/gnome-shell/extensions/$PROBE_UUID"

  cleanup() {
    rm -f /run/user/1000/gnome-shell-disable-extensions
    rm -rf "$TMP" 2>/dev/null || { sleep 1; rm -rf "$TMP" 2>/dev/null; }
  }
  trap cleanup EXIT

  # Same file set as `make publish`.
  (
    cd "$ROOT"
    cp LICENSE metadata.json stylesheet.css "$EXT"/
    cp *.js "$EXT"/
    cp -r ui preferences effects apps schemas "$EXT"/
  )
  rm -f "$EXT"/_*.js "$EXT"/imports_*
  rm -f "$EXT"/schemas/gschemas.compiled
  glib-compile-schemas --strict "$EXT/schemas" || exit 2
  cp "$ROOT"/tests/nested/probe@search-light-glass.test/* "$TMP/data/gnome-shell/extensions/$PROBE_UUID/"

  export XDG_DATA_HOME="$TMP/data" GSETTINGS_BACKEND=memory
  export PROBE_SCENARIO="$SCENARIO" PROBE_OUT="$OUT"
  export NESTED_INNER=1 NESTED_UUID="$UUID" NESTED_PROBE_UUID="$PROBE_UUID"
  dbus-run-session -- "$0" "$SCENARIO" "$OUT"
  rc=$?
  [ "$SCENARIO" = none ] && exit "$rc"
  if [ -f "$OUT/report.json" ]; then
    python3 - "$OUT/report.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
for c in r["checks"]:
    print(("PASS %s" % c["name"]) if c["ok"] else ("FAIL %s: %s" % (c["name"], c["detail"])))
sys.exit(0 if r["ok"] else 1)
PY
    exit $?
  fi
  echo "FAIL no-report: probe did not produce report.json (see $OUT/shell.log)"
  exit 1
fi

# ---- inside dbus-run-session ----
DISPLAY_NAME=slg-test-0
gnome-shell --devkit --wayland --no-x11 --wayland-display=$DISPLAY_NAME >"$OUT/shell.log" 2>&1 &
SH=$!
shell_cleanup() { kill "$SH" 2>/dev/null; wait "$SH" 2>/dev/null; }
trap shell_cleanup EXIT

ready=0
for _ in $(seq 60); do
  if gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$SH" 2>/dev/null || break
  sleep 0.5
done
[ $ready = 1 ] || { echo "nested shell did not start" >&2; exit 1; }

WAYLAND_DISPLAY=$DISPLAY_NAME gnome-text-editor >/dev/null 2>&1 &
sleep 3

enable() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.EnableExtension "$1" >/dev/null
}
# Extension discovery can lag behind shell startup; retry until it is enabled.
for u in "$NESTED_UUID" "$NESTED_PROBE_UUID"; do
  for _ in 1 2 3 4 5 6 7 8; do
    [ "$(enable "$u" 2>&1; gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Extensions.ListExtensions | grep -c "'$u'")" -gt 0 ] && break
    sleep 1
  done
done

if [ "$PROBE_SCENARIO" = none ]; then
  wait "$SH"
  exit 0
fi

for _ in $(seq 60); do
  [ -f "$OUT/report.json" ] && break
  kill -0 "$SH" 2>/dev/null || break
  sleep 0.5
done
exit 0
