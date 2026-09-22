#include "network.h"

#include <array>
#include <cstdio>
#include <sched.h>
#include <sys/wait.h>
#include <unistd.h>

static bool run_ip(const std::string& args, std::string& out) {
    std::string cmd = "ip " + args + " 2>&1";
    std::array<char, 512> buf{};
    out.clear();
    FILE* p = popen(cmd.c_str(), "r");
    if (!p) { out = "popen failed"; return false; }
    while (fgets(buf.data(), buf.size(), p)) out += buf.data();
    int st = pclose(p);
    return WIFEXITED(st) && WEXITSTATUS(st) == 0;
}

NetMode parse_net_mode(const std::string& s, bool& ok) {
    ok = true;
    if (s == "host") return NetMode::Host;
    if (s == "none" || s == "isolated") return NetMode::Isolated;
    if (s == "bridge") return NetMode::Bridge;
    ok = false;
    return NetMode::Host;
}

bool net_ensure_bridge(const NetConfig& cfg, std::string& err) {
    std::string out;
    // Create bridge if missing (ignore error if it already exists).
    run_ip("link show " + cfg.bridge, out);
    bool exists = out.find(cfg.bridge + ":") != std::string::npos;
    if (!exists) {
        if (!run_ip("link add " + cfg.bridge + " type bridge", out)) {
            err = "create bridge " + cfg.bridge + ": " + out;
            return false;
        }
        if (!run_ip("addr add " + cfg.gateway + "/16 dev " + cfg.bridge, out)) {
            err = "assign gateway " + cfg.gateway + ": " + out;
            return false;
        }
        run_ip("link set " + cfg.bridge + " up", out);
        // NAT for outbound (best effort).
        std::string masq = "iptables -t nat -C POSTROUTING -s 10.88.0.0/16 ! -o " +
                           cfg.bridge + " -j MASQUERADE 2>&1 || iptables -t nat -A POSTROUTING "
                           "-s 10.88.0.0/16 ! -o " + cfg.bridge + " -j MASQUERADE 2>&1";
        FILE* p = popen(masq.c_str(), "r");
        if (p) pclose(p);
    }
    return true;
}

bool net_setup_host(int childPid, NetConfig& cfg, std::string& err) {
    if (cfg.mode != NetMode::Bridge) return true;

    if (cfg.containerIp.empty()) {
        // Default: derive host-unique IP from child pid to allow 2 containers.
        int host = 2 + (childPid % 250);
        cfg.containerIp = "10.88.0." + std::to_string(host) + "/16";
    }
    cfg.hostIf = "mch" + std::to_string(childPid % 100000);
    std::string peer = "mcc" + std::to_string(childPid % 100000);

    if (!net_ensure_bridge(cfg, err)) return false;

    std::string out;
    // Clean stale iface with same name (best effort).
    run_ip("link del " + cfg.hostIf, out);
    if (!run_ip("link add " + cfg.hostIf + " type veth peer name " + peer, out)) {
        err = "create veth: " + out + "(need root/CAP_NET_ADMIN on host)";
        return false;
    }
    if (!run_ip("link set " + cfg.hostIf + " master " + cfg.bridge, out)) {
        err = "attach to bridge: " + out;
        run_ip("link del " + cfg.hostIf, out);
        return false;
    }
    run_ip("link set " + cfg.hostIf + " up", out);
    if (!run_ip("link set " + peer + " netns " + std::to_string(childPid), out)) {
        err = "move peer to netns: " + out;
        run_ip("link del " + cfg.hostIf, out);
        return false;
    }
    // Remember peer name translated to contIf later by child; stash via hostIf mapping:
    // child renames peer -> eth0, so pass peer name through contIf field hack:
    cfg.hostIf = cfg.hostIf; // host end stays
    // Store peer name in gateway-adjacent field? Instead child discovers the only
    // non-lo iface. No extra state needed.
    return true;
}

bool net_setup_child(const NetConfig& cfg) {
    if (cfg.mode == NetMode::Host) return true; // share host net: touch nothing
    std::string out;
    if (!run_ip("link set lo up", out)) {
        fprintf(stderr, "miniContainer: lo up failed: %s\n", out.c_str());
        return false;
    }
    if (cfg.mode == NetMode::Isolated) return true;

    // Bridge mode: find the moved veth (the only non-lo iface), rename to eth0,
    // assign IP, bring up, add default route.
    // List interfaces.
    std::string list;
    run_ip("-o link show", list);
    std::string peer;
    // Parse "IDX: NAME:" lines, skip lo.
    size_t pos = 0;
    while (pos < list.size()) {
        size_t eol = list.find('\n', pos);
        std::string line = list.substr(pos, eol == std::string::npos ? eol : eol - pos);
        auto c1 = line.find(": ");
        if (c1 != std::string::npos) {
            std::string name = line.substr(c1 + 2);
            auto at = name.find('@');
            if (at != std::string::npos) name = name.substr(0, at);
            auto colon = name.find(':');
            if (colon != std::string::npos) name = name.substr(0, colon);
            if (name != "lo" && !name.empty()) { peer = name; break; }
        }
        if (eol == std::string::npos) break;
        pos = eol + 1;
    }
    if (peer.empty()) {
        fprintf(stderr, "miniContainer: no veth found in netns\n");
        return true; // don't fail container over net; parent already reported
    }
    if (peer != cfg.contIf) run_ip("link set " + peer + " name " + cfg.contIf, out);
    if (!cfg.containerIp.empty())
        run_ip("addr add " + cfg.containerIp + " dev " + cfg.contIf, out);
    run_ip("link set " + cfg.contIf + " up", out);
    if (!cfg.gateway.empty())
        run_ip("route add default via " + cfg.gateway + " dev " + cfg.contIf, out);
    return true;
}
