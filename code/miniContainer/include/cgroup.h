#pragma once
#include <string>

struct CgroupLimits {
    std::string memoryMax; // bytes, e.g. "104857600", empty = unset. CLI accepts 100M/1G.
    std::string cpuMax;    // cgroupv2 cpu.max line, e.g. "50000 100000", empty = unset
    std::string pidsMax;   // e.g. "100", empty = unset
    bool enabled() const { return !memoryMax.empty() || !cpuMax.empty() || !pidsMax.empty(); }
};

// Create a child cgroup under our current cgroup, apply limits, move pid into it.
// Returns cgroup path on success, empty + err on failure.
std::string cgroup_create_for_pid(int pid, const CgroupLimits& lim, std::string& err);
void cgroup_cleanup(const std::string& path);

// CLI helpers: "--mem 100M" -> bytes string; "--cpu 0.5" -> "50000 100000".
bool parse_mem_limit(const std::string& in, std::string& outBytes, std::string& err);
bool parse_cpu_limit(const std::string& in, std::string& outCpuMax, std::string& err);
