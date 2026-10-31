#!/usr/bin/env bash
# Start or stop the Toon Studio helper and open the app in your browser.
#
#   ./run.sh         start (or reopen the browser if already running)
#   ./run.sh stop    stop
#   ./run.sh status  show whether it is running
#
# The helper binds 127.0.0.1 only and contains no code that can make outbound
# connections (tests/test_serve.py checks both). Set TOON_PORT to change the
# port and TOON_NO_BROWSER=1 to skip opening a browser tab.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${TOON_PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"
PIDFILE=".toon-studio.pid"
LOGFILE="toon-studio.log"

is_up() {
    # bash's own /dev/tcp: a connect test with no extra tools
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null
}

open_browser() {
    echo "Toon Studio is at ${URL}"
    if [[ -n "${TOON_NO_BROWSER:-}" ]]; then
        return
    fi
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
    fi
}

start() {
    if is_up; then
        echo "Already running."
        open_browser
        return
    fi
    TOON_PORT="$PORT" nohup python3 serve.py >"$LOGFILE" 2>&1 &
    echo $! >"$PIDFILE"
    for _ in $(seq 1 50); do
        if is_up; then
            echo "Started (process $(cat "$PIDFILE"), log in ${LOGFILE})."
            open_browser
            return
        fi
        sleep 0.1
    done
    echo "The helper did not come up. See ${LOGFILE}." >&2
    exit 1
}

stop() {
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        kill "$(cat "$PIDFILE")"
        rm -f "$PIDFILE"
        echo "Stopped."
        return
    fi
    rm -f "$PIDFILE"
    echo "Not running."
}

status() {
    if is_up; then
        echo "Running at ${URL}"
    else
        echo "Not running."
    fi
}

case "${1:-start}" in
    start)  start ;;
    stop)   stop ;;
    status) status ;;
    *)      echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
