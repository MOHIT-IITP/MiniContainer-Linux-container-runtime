#!/bin/sh
# Rootless test suite for miniContainer. Asserts isolation + limits.
# Usage: ./tests/run_tests.sh  (--net bridge / cgroup cpu.mem need root or delegation)
set -u
BIN=./build/miniContainer
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

[ -x "$BIN" ] || { echo "build first: cmake -S . -B build && cmake --build build -j"; exit 1; }
[ -d ./rootfs/bin ] || { echo "provision rootfs first: ./setup-rootfs.sh"; exit 1; }

# 1. basic exec + exit code
[ "$("$BIN" run -- /bin/echo hi)" = "hi" ] && ok "basic exec" || bad "basic exec"
"$BIN" run -- /bin/sh -c 'exit 42'; [ $? -eq 42 ] && ok "exit code" || bad "exit code"

# 2. UTS isolation
[ "$("$BIN" run -h testbox -- cat /proc/sys/kernel/hostname)" = "testbox" ] && ok "uts" || bad "uts"

# 3. PID isolation (container init is pid 1, only 1-2 pids visible)
PID=$("$BIN" run -- /bin/sh -c 'echo $$') ; [ "$PID" = "1" ] && ok "pid ns" || bad "pid ns ($PID)"

# 4. mount/fs isolation via pivot_root
OUT=$("$BIN" run --rootfs ./rootfs -h box -- /bin/sh -c '/bin/hostname; /bin/ls /' 2>/dev/null)
echo "$OUT" | grep -q '^box$' && echo "$OUT" | grep -q '^bin$' && ! echo "$OUT" | grep -q '^usr$' \
  && ok "pivot_root" || bad "pivot_root ($OUT)"
"$BIN" run --rootfs ./rootfs -- /bin/sh -c '/bin/touch /T_iso_xyz' 2>/dev/null
[ -f ./rootfs/T_iso_xyz ] && ! [ -f /T_iso_xyz ] && ok "fs containment" || bad "fs containment"
rm -f ./rootfs/T_iso_xyz

# 5. old root gone
"$BIN" run --rootfs ./rootfs -- /bin/sh -c '/bin/ls /oldroot' >/dev/null 2>&1 \
  && bad "oldroot removed" || ok "oldroot removed"

# 6. net isolated: only lo visible
NICS=$("$BIN" run --net isolated -- /bin/sh -c 'cat /proc/net/dev' | awk -F: 'NR>2{print $1}' | tr -d ' ')
[ "$NICS" = "lo" ] && ok "net isolated" || bad "net isolated ($NICS)"

# 7. net bridge fails gracefully rootless (needs root on host)
if [ "$(id -u)" != "0" ]; then
  "$BIN" run --net bridge -- /bin/echo hi >/dev/null 2>&1 \
    && bad "bridge graceful (rootless should fail)" || ok "bridge graceful"
fi

# 8. cgroup pids limit enforced (needs delegation; best effort here)
if systemd-run --user --scope -p Delegate=yes -- true 2>/dev/null; then
  LIM=$(systemd-run --user --scope -p Delegate=yes -- "$BIN" run --pids 50 -- \
    /bin/sh -c 'CG=$(cat /proc/self/cgroup | cut -d: -f3); cat /sys/fs/cgroup$CG/pids.max' 2>/dev/null | tail -1)
  [ "$LIM" = "50" ] && ok "cgroup pids" || bad "cgroup pids ($LIM)"
else
  echo "SKIP: cgroup (no systemd delegation)"
fi

echo "--- $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
