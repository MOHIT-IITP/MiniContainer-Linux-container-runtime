#!/bin/sh
# Fetch static busybox and build minimal rootfs for miniContainer phase 2.
set -eu
ROOT="$(dirname "$0")/rootfs"
BUSY_URL="https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox"
mkdir -p "$ROOT"/{bin,sbin,etc,proc,sys,dev,tmp}
curl -fL -o /tmp/opencode/busybox "$BUSY_URL"
chmod +x /tmp/opencode/busybox
cp /tmp/opencode/busybox "$ROOT/bin/busybox"
chmod +x "$ROOT/bin/busybox"
(cd "$ROOT/bin" && for a in sh ls cat echo ps hostname mount umount mkdir touch pwd id uname env grep head tail wc whoami rm cp mv chmod df du sleep; do ln -sf busybox "$a"; done)
echo "nameserver 8.8.8.8" > "$ROOT/etc/resolv.conf"
echo "rootfs ready at $ROOT"
