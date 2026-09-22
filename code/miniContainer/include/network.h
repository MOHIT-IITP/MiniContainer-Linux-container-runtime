#pragma once
#include <string>

enum class NetMode { Host, Isolated, Bridge };

struct NetConfig {
    NetMode mode = NetMode::Host;
    std::string bridge = "mcbr0";      // bridge mode only
    std::string containerIp;           // e.g. "10.88.0.2/16", bridge mode
    std::string gateway = "10.88.0.1"; // bridge mode
    std::string hostIf;                // auto: vethH<pid>
    std::string contIf = "eth0";       // name inside container
};

// Parent side (host ns): create veth pair, attach to bridge, move peer into
// child netns. No-op for Host/Isolated. Returns false + err on failure.
// Requires CAP_NET_ADMIN in host ns (i.e. root) for Bridge mode.
bool net_setup_host(int childPid, NetConfig& cfg, std::string& err);

// Child side (inside new netns): bring up lo; in Bridge mode configure eth0
// + default route. Best-effort warnings, returns true unless lo fails.
bool net_setup_child(const NetConfig& cfg);

// Ensure bridge exists with gateway IP (root only). Called by net_setup_host.
bool net_ensure_bridge(const NetConfig& cfg, std::string& err);

NetMode parse_net_mode(const std::string& s, bool& ok);
