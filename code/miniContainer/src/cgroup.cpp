#include "cgroup.h"

#include <cerrno>
#include <cstring>
#include <fstream>
#include <sstream>
#include <sys/stat.h>
#include <unistd.h>

static std::string read_first_line(const char* path) {
    std::ifstream f(path);
    std::string s;
    std::getline(f, s);
    if (!s.empty() && s.back() == '\n') s.pop_back();
    return s;
}

static bool write_str(const std::string& path, const std::string& val, std::string& err) {
    std::ofstream f(path);
    if (!f) { err = path + ": " + strerror(errno); return false; }
    f << val;
    f.flush();
    if (!f) { err = path + ": " + strerror(errno); return false; }
    return true;
}

static std::string current_cgroup_dir() {
    // /proc/self/cgroup v2 format: "0::/user.slice/..."
    std::string line = read_first_line("/proc/self/cgroup");
    auto pos = line.rfind(':');
    std::string rel = (pos == std::string::npos) ? "/" : line.substr(pos + 1);
    if (rel.empty() || rel == "/") return "/sys/fs/cgroup";
    return "/sys/fs/cgroup" + rel;
}

std::string cgroup_create_for_pid(int pid, const CgroupLimits& lim, std::string& err) {
    std::string parent = current_cgroup_dir();
    std::string dir = parent + "/mini-ct-" + std::to_string(pid);

    // 1. Enable controllers in parent FIRST: children born after this inherit
    //    availability; enabling later flips existing children to invalid.
    //    One-by-one: a combined write fails atomically if any single
    //    controller (e.g. memory) is unavailable, disabling all.
    for (const char* c : {"memory", "pids", "cpu"}) {
        std::string dummy;
        write_str(parent + "/cgroup.subtree_control", std::string("+") + c, dummy);
    }

    if (mkdir(dir.c_str(), 0755) != 0 && errno != EEXIST) {
        err = "mkdir " + dir + ": " + strerror(errno);
        return "";
    }

    // 2. systemd user scopes are often "domain threaded": children are born
    //    "domain invalid" and reject migration (EOPNOTSUPP) until flipped.
    {
        std::string t = read_first_line((dir + "/cgroup.type").c_str());
        if (t != "domain" && t != "threaded") {
            std::string dummy;
            if (!write_str(dir + "/cgroup.type", "threaded", dummy)) {
                err = "cgroup.type: " + dummy;
                rmdir(dir.c_str());
                return "";
            }
        }
    }

    if (!lim.memoryMax.empty()) {
        std::string e;
        if (!write_str(dir + "/memory.max", lim.memoryMax, e)) {
            err = "memory.max: " + e + " (rootless? only memory+pids delegated here)";
            // continue: apply what we can
        }
    }
    if (!lim.cpuMax.empty()) {
        std::string e;
        if (!write_str(dir + "/cpu.max", lim.cpuMax, e)) {
            if (!err.empty()) err += "; ";
            err += "cpu.max: " + e + " (cpu controller not delegated rootless)";
        }
    }
    if (!lim.pidsMax.empty()) {
        std::string e;
        if (!write_str(dir + "/pids.max", lim.pidsMax, e)) {
            if (!err.empty()) err += "; ";
            err += "pids.max: " + e;
        }
    }

    std::string e2;
    if (!write_str(dir + "/cgroup.procs", std::to_string(pid), e2)) {
        err = "cgroup.procs: " + e2;
        rmdir(dir.c_str());
        return "";
    }
    return dir;
}

void cgroup_cleanup(const std::string& path) {
    if (path.empty()) return;
    rmdir(path.c_str()); // fails if not empty; best effort
}

bool parse_mem_limit(const std::string& in, std::string& outBytes, std::string& err) {
    if (in == "max") { outBytes = "max"; return true; }
    size_t n = 0;
    while (n < in.size() && (isdigit((unsigned char)in[n]))) ++n;
    if (n == 0) { err = "bad --mem '" + in + "' (want e.g. 100M, 1G, 67108864)"; return false; }
    long long v = std::stoll(in.substr(0, n));
    std::string suf = in.substr(n);
    long long mult = 1;
    if (suf.empty() || suf == "B") mult = 1;
    else if (suf == "K" || suf == "KB") mult = 1024LL;
    else if (suf == "M" || suf == "MB") mult = 1024LL * 1024;
    else if (suf == "G" || suf == "GB") mult = 1024LL * 1024 * 1024;
    else { err = "bad --mem suffix '" + suf + "' (use K/M/G)"; return false; }
    outBytes = std::to_string(v * mult);
    return true;
}

bool parse_cpu_limit(const std::string& in, std::string& outCpuMax, std::string& err) {
    // Accept fractional CPUs ("0.5", "2") -> "$QUOTA 100000".
    try {
        double cpus = std::stod(in);
        if (cpus <= 0 || cpus > 64) { err = "bad --cpu '" + in + "' (want 0.1..64)"; return false; }
        long long quota = (long long)(cpus * 100000.0);
        outCpuMax = std::to_string(quota) + " 100000";
        return true;
    } catch (...) {
        err = "bad --cpu '" + in + "' (want e.g. 0.5)";
        return false;
    }
}
