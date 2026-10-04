#!/bin/zsh
set -eu
cd "$(dirname "$0")"
task_port=$(python3 - <<'PY'
import socket
for port in range(8767,8800):
    s=socket.socket()
    try:
        s.bind(('127.0.0.1',port))
        print(port)
        break
    except OSError:
        pass
    finally:
        s.close()
else:
    raise SystemExit('Нет свободного локального порта')
PY
)
python3 -m http.server "$task_port" --bind 127.0.0.1 &
task_server_pid=$!
trap 'kill "$task_server_pid" 2>/dev/null || true' EXIT INT TERM
python3 - "$task_port" <<'PY'
import sys,time,urllib.request
url='http://127.0.0.1:'+sys.argv[1]+'/'
for i in range(40):
    try:
        urllib.request.urlopen(url,timeout=1).close()
        break
    except OSError:
        time.sleep(.1)
PY
open "http://127.0.0.1:$task_port/"
printf '\nМодель теплицы открыта. Оставьте это окно открытым.\nДля завершения нажмите Ctrl+C.\n'
wait "$task_server_pid"
