#include "container.h"
#include <iostream>
#include <unistd.h>

static void usage() {
    std::cerr << "usage: miniContainer run [OPTS] -- <cmd> [args...]\n"
              << "  -h, --hostname NAME   container hostname (default container)\n"
              << "      --rootfs PATH     pivot_root into PATH (busybox rootfs)\n"
              << "      --mem LIMIT       memory limit: 100M, 1G (cgroup v2)\n"
              << "      --cpu CPUS        cpu limit: 0.5, 2 (cgroup v2 cpu.max)\n"
              << "      --pids N          max processes (cgroup v2 pids.max)\n"
              << "      --net MODE        host (default) | isolated | bridge\n"
              << "      --ip CIDR         bridge mode IP, e.g. 10.88.0.2/16\n"
              << "      --bridge NAME     bridge name (default mcbr0, needs root)\n"
              << "examples:\n"
              << "  miniContainer run -- /bin/echo hi\n"
              << "  miniContainer run --rootfs ./rootfs -h box -- /bin/sh\n"
              << "  miniContainer run --mem 100M --pids 50 -- /bin/sh\n"
              << "  miniContainer run --net isolated -- /bin/sh\n"
              << "  sudo miniContainer run --net bridge --ip 10.88.0.2/16 --rootfs ./rootfs -- /bin/sh\n";
}

int main(int argc, char* argv[]) {
    if (argc < 2) { usage(); return 1; }
    std::string sub = argv[1];
    if (sub != "run") { usage(); return 1; }

    ContainerConfig cfg;
    std::vector<std::string> cmd;
    bool dashdash = false;
    std::string memIn, cpuIn, pidsIn;
    for (int i = 2; i < argc; ++i) {
        std::string a = argv[i];
        if (!dashdash && a == "--") { dashdash = true; continue; }
        auto need = [&](const char* what) -> const char* {
            if (i + 1 >= argc) { std::cerr << "miniContainer: " << what << " needs a value\n"; exit(1); }
            return argv[++i];
        };
        if (!dashdash && (a == "-h" || a == "--hostname")) { cfg.hostname = need(a.c_str()); continue; }
        if (!dashdash && a == "--rootfs") { cfg.rootfs = need(a.c_str()); continue; }
        if (!dashdash && a == "--mem") { memIn = need(a.c_str()); continue; }
        if (!dashdash && a == "--cpu") { cpuIn = need(a.c_str()); continue; }
        if (!dashdash && a == "--pids") { pidsIn = need(a.c_str()); continue; }
        if (!dashdash && a == "--net") {
            bool ok = false;
            cfg.net.mode = parse_net_mode(need(a.c_str()), ok);
            if (!ok) { std::cerr << "miniContainer: --net want host|isolated|bridge\n"; return 1; }
            continue;
        }
        if (!dashdash && a == "--ip") { cfg.net.containerIp = need(a.c_str()); continue; }
        if (!dashdash && a == "--bridge") { cfg.net.bridge = need(a.c_str()); continue; }
        cmd.push_back(a);
    }
    if (cmd.empty()) { usage(); return 1; }
    cfg.argv = cmd;

    if (!memIn.empty()) {
        std::string err;
        if (!parse_mem_limit(memIn, cfg.limits.memoryMax, err)) { std::cerr << "miniContainer: " << err << "\n"; return 1; }
    }
    if (!cpuIn.empty()) {
        std::string err;
        if (!parse_cpu_limit(cpuIn, cfg.limits.cpuMax, err)) { std::cerr << "miniContainer: " << err << "\n"; return 1; }
    }
    if (!pidsIn.empty()) cfg.limits.pidsMax = pidsIn;
    if (cfg.net.mode == NetMode::Bridge && getuid() != 0)
        std::cerr << "miniContainer: note: --net bridge needs root on host; will fail gracefully rootless\n";

    return container_run(cfg);
}
