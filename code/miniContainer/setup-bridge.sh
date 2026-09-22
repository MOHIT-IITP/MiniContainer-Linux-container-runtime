#!/bin/sh
# Create the host bridge for --net bridge (needs root).
# Usage: sudo ./setup-bridge.sh [BRIDGE] [GATEWAY/CIDR]
set -eu
BR="${1:-mcbr0}"
GW="${2:-10.88.0.1/16}"
if [ "$(id -u)" != "0" ]; then echo "run as root: sudo $0" >&2; exit 1; fi
ip link show "$BR" >/dev/null 2>&1 || {
  ip link add "$BR" type bridge
  ip addr add "$GW" dev "$BR"
  ip link set "$BR" up
}
iptables -t nat -C POSTROUTING -s 10.88.0.0/16 ! -o "$BR" -j MASQUERADE 2>/dev/null || \
iptables -t nat -A POSTROUTING -s 10.88.0.0/16 ! -o "$BR" -j MASQUERADE
echo "bridge $BR ready ($GW)"
echo "demo (two terminals, as root):"
echo "  ./build/miniContainer run --net bridge --ip 10.88.0.2/16 --rootfs ./rootfs -- /bin/sh"
echo "  ./build/miniContainer run --net bridge --ip 10.88.0.3/16 --rootfs ./rootfs -- /bin/sh"
echo "then inside container 1: /bin/ping 10.88.0.3"
