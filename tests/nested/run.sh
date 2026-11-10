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
  rm -f "$EXT"/_*.js "$EXT"/utils.js "$EXT"/drawing.js "$EXT"/chamfer.js "$EXT"/imports_*
  # Ship the tracked compiled schema as-is, but fail fast if it is stale
  # (recompiling here used to hide that).
  gjs -m "$ROOT/tests/unit/test_schema_compiled.js" || exit 2
  cp "$ROOT"/tests/nested/probe@search-light-glass.test/* "$TMP/data/gnome-shell/extensions/$PROBE_UUID/"

  export XDG_DATA_HOME="$TMP/data" GSETTINGS_BACKEND=memory
  export PROBE_SCENARIO="$SCENARIO" PROBE_OUT="$OUT"
  export NESTED_INNER=1 NESTED_UUID="$UUID" NESTED_PROBE_UUID="$PROBE_UUID"
  dbus-run-session -- "$0" "$SCENARIO" "$OUT"
  rc=$?
  [ "$rc" = 3 ] && exit 3 # enable failure already reported
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

SHELL_CALL=(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell)
ext_info() { "${SHELL_CALL[@]}" --method org.gnome.Shell.Extensions.GetExtensionInfo "$1" 2>&1; }
# Extension discovery can lag behind shell startup; retry until the extension
# is listed, then require it to reach ACTIVE (state 1).
for u in "$NESTED_UUID" "$NESTED_PROBE_UUID"; do
  state=""
  info=""
  for _ in $(seq 10); do
    "${SHELL_CALL[@]}" --method org.gnome.Shell.Extensions.EnableExtension "$u" >/dev/null 2>&1
    sleep 0.5
    info="$(ext_info "$u")"
    state="$(printf '%s' "$info" | sed -n "s/.*'state': <\([0-9]*\).*/\1/p")"
    [ "$state" = 1 ] && break
    sleep 0.5
  done
  if [ "$state" != 1 ]; then
    err="$(printf '%s' "$info" | sed -n "s/.*'error': <'\([^']*\)'.*/\1/p")"
    echo "FAIL enable: $u state=${state:-unknown} error=${err:-none}"
    exit 3
  fi
done

if [ "$PROBE_SCENARIO" = none ]; then
  wait "$SH"
  exit 0
fi

LIMIT=60
[ "$PROBE_SCENARIO" = all ] && LIMIT=900 # 7.5 minutes
for _ in $(seq $LIMIT); do
  [ -f "$OUT/report.json" ] && break
  kill -0 "$SH" 2>/dev/null || break
  sleep 0.5
done
exit 0
