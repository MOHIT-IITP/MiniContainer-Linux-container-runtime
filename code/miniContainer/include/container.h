#pragma once
#include <string>
#include <vector>
#include "cgroup.h"
#include "network.h"

struct ContainerConfig {
    std::string hostname = "container";
    std::string rootfs;              // empty = no pivot_root (phase 1 mode)
    std::vector<std::string> argv;   // command to exec, e.g. {"/bin/sh"}
    bool newPid = true;
    bool newNs = true;   // mount
    bool newUts = true;
    bool newIpc = true;
    CgroupLimits limits;
    NetConfig net;
};

int container_run(const ContainerConfig& cfg);
