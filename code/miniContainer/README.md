# miniContainer — Lightweight Linux Container Runtime (C++)

## 1. What this project is about

miniContainer is a from-scratch container runtime in C++ — a minimal Docker-like
tool with no daemon. `miniContainer run -- <cmd>` executes any command in an
isolated Linux container built directly from kernel primitives:

- **Namespaces** — `clone` with user, PID, mount, UTS, IPC (and net) namespaces.
  The container gets its own hostname, sees itself as PID 1, and cannot see host
  processes. Rootless by default via UID/GID mapping (`src/container.cpp`).
- **Filesystem isolation** — `pivot_root` into a minimal busybox rootfs plus fresh
  `proc` / `sys` / `dev` mounts. Host files are invisible; container writes stay
  inside its root.
- **Resource limits** — Linux cgroup v2: `--mem` (`memory.max`), `--cpu`
  (`cpu.max`), `--pids` (`pids.max`). Handles systemd's threaded scopes
  (`src/cgroup.cpp`).
- **Networking** — `--net host` (shared), `isolated` (own netns, only `lo`), or
  `bridge` (veth pair into host bridge `mcbr0` + NAT, so containers can ping each
  other) (`src/network.cpp`, `setup-bridge.sh`).
- **Lifecycle** — `execvp` command execution, exit-code propagation, SIGINT/SIGTERM
  forwarding, and cleanup of cgroups and veth interfaces on exit.

## 2. How to run

Requirements: Linux 5.8+ with user namespaces, `g++`, `cmake`, `ip`
(`iptables` only for bridge mode).

```sh
# build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j

# fetch static busybox and create ./rootfs (once)
./setup-rootfs.sh
```

Examples (all rootless, no sudo):

```sh
./build/miniContainer run -- /bin/echo hi
./build/miniContainer run --rootfs ./rootfs -h mybox -- /bin/sh
./build/miniContainer run --mem 100M --pids 50 -- /bin/sh
./build/miniContainer run --net isolated -- /bin/sh
```

Full flags:

```sh
miniContainer run [OPTS] -- <cmd> [args...]
  -h, --hostname NAME   container hostname
      --rootfs PATH     pivot_root into PATH
      --mem LIMIT       e.g. 100M, 1G
      --cpu CPUS        e.g. 0.5, 2
      --pids N          max processes
      --net MODE        host (default) | isolated | bridge
      --ip CIDR         bridge IP, e.g. 10.88.0.2/16
      --bridge NAME     bridge name (default mcbr0, needs root)
```

Notes:

- Inside a `--rootfs` shell use absolute paths (`/bin/ls /`, `/bin/hostname`),
  host `PATH` has no `/bin`.
- Cgroup limits apply best under delegation, else they warn and continue:
  `systemd-run --user --scope -p Delegate=yes -- ./build/miniContainer run --mem 100M --pids 50 -- /bin/sh`
- Bridge mode needs root:
  `sudo ./setup-bridge.sh`, then
  `sudo ./build/miniContainer run --net bridge --ip 10.88.0.2/16 --rootfs ./rootfs -- /bin/sh`

## 3. How to check it works

Automated suite (10 checks, rootless):

```sh
./tests/run_tests.sh
# --- 10 passed, 0 failed ---
```

What it asserts: basic exec, exit codes, hostname isolation, PID 1 in new PID
namespace, `pivot_root` root contents, write containment (file lands in
`./rootfs`, never `/`), `/oldroot` removal, isolated net shows only `lo`,
bridge fails gracefully without root, cgroup `pids.max` is enforced.

Manual spot checks:

```sh
./build/miniContainer run -h box -- cat /proc/sys/kernel/hostname  # -> box
./build/miniContainer run -- sh -c 'echo pid=$$'                    # -> pid=1
./build/miniContainer run --rootfs ./rootfs -- /bin/sh -c '/bin/ls /'
# -> bin dev etc proc sbin sys tmp   (no host files)
./build/miniContainer run --net isolated -- sh -c 'cat /proc/net/dev'
# -> only lo
```

## Layout

- `src/main.cpp` — CLI parsing
- `src/container.cpp` — namespaces, `pivot_root`, lifecycle (`include/container.h`)
- `src/cgroup.cpp` — cgroup v2 limits (`include/cgroup.h`)
- `src/network.cpp` — netns, veth, bridge (`include/network.h`)
- `setup-rootfs.sh`, `setup-bridge.sh`, `tests/run_tests.sh`
