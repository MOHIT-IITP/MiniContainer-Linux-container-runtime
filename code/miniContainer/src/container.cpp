#include "container.h"
#include "network.h"

#include <array>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sched.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdlib.h>

// 1 MB stack for clone() child (stack grows down, pass top)
static constexpr size_t kStackSize = 1024 * 1024;

struct ChildArgs {
    const ContainerConfig* cfg;
    int syncFd; // read-end of pipe: parent signals uid_map is ready
};

static bool write_file_str(const std::string& path, const std::string& content,
                           std::string& err) {
    int fd = open(path.c_str(), O_WRONLY);
    if (fd < 0) { err = std::string("open ") + path + ": " + strerror(errno); return false; }
    ssize_t n = write(fd, content.c_str(), content.size());
    int e = errno;
    close(fd);
    if (n != (ssize_t)content.size()) { err = std::string("write ") + path + ": " + strerror(e); return false; }
    return true;
}

static void mkdir_p(const char* p) {
    mkdir(p, 0755); // best-effort; ignore EEXIST
}

static int do_mount(const char* src, const char* tgt, const char* fstype,
                    unsigned long flags, const char* data) {
    mkdir_p(tgt);
    if (mount(src, tgt, fstype, flags, data) != 0) {
        std::string m = std::string("mount ") + tgt + ": " + strerror(errno);
        perror(m.c_str());
        return -1;
    }
    return 0;
}

static int setup_rootfs(const std::string& rootfs) {
    char abs[PATH_MAX];
    if (!realpath(rootfs.c_str(), abs)) { perror("realpath --rootfs"); return -1; }
    std::string newRoot = abs;

    // pivot_root requires new_root to be a mount point.
    if (mount(newRoot.c_str(), newRoot.c_str(), nullptr, MS_BIND | MS_REC, nullptr) != 0) {
        perror("mount --bind rootfs");
        return -1;
    }
    mkdir_p((newRoot + "/oldroot").c_str());
    if (syscall(SYS_pivot_root, newRoot.c_str(), (newRoot + "/oldroot").c_str()) != 0) {
        perror("pivot_root");
        return -1;
    }
    if (chdir("/") != 0) { perror("chdir /"); return -1; }

    // Essential pseudo-filesystems inside the container.
    if (do_mount("proc", "/proc", "proc", MS_NOSUID | MS_NOEXEC | MS_NODEV, nullptr)) return -1;
    // sysfs mount is denied in unprivileged user ns on most kernels -> fallback.
    if (do_mount("sysfs", "/sys", "sysfs", MS_RDONLY | MS_NOSUID | MS_NOEXEC | MS_NODEV, nullptr) != 0) {
        perror("warn: sysfs denied, using empty stub");
        mkdir_p("/sys");
        // tmpfs must be writable at mount time; remount ro is optional (ignore errors).
        if (do_mount("tmpfs", "/sys", "tmpfs", MS_NOSUID | MS_NOEXEC | MS_NODEV, "mode=755") == 0) {
            mount(nullptr, "/sys", nullptr, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NOEXEC | MS_NODEV, nullptr);
        }
    }
    if (do_mount("tmpfs", "/dev", "tmpfs", MS_NOSUID, "mode=755")) return -1;
    mkdir_p("/dev/pts");
    mkdir_p("/dev/shm");
    mkdir_p("/tmp");
    if (do_mount("devpts", "/dev/pts", "devpts", MS_NOSUID | MS_NOEXEC, "newinstance,ptmxmode=0666,mode=0620")) {
        // Fallback without newinstance for older kernels.
        do_mount("devpts", "/dev/pts", "devpts", MS_NOSUID | MS_NOEXEC, "ptmxmode=0666,mode=0620");
    }
    do_mount("tmpfs", "/tmp", "tmpfs", MS_NOSUID | MS_NODEV, "mode=1777");
    do_mount("tmpfs", "/dev/shm", "tmpfs", MS_NOSUID | MS_NODEV, "mode=1777");

    // Bind essential device nodes from old root (rootless-safe, no mknod).
    const char* devs[] = {"null", "zero", "full", "random", "urandom", "tty", nullptr};
    for (int i = 0; devs[i]; ++i) {
        std::string src = std::string("/oldroot/dev/") + devs[i];
        std::string dst = std::string("/dev/") + devs[i];
        int fd = open(dst.c_str(), O_CREAT | O_RDWR, 0666);
        if (fd >= 0) close(fd);
        if (mount(src.c_str(), dst.c_str(), nullptr, MS_BIND, nullptr) != 0) {
            // Non-fatal: warn and continue (e.g. /dev/tty may be absent).
            std::string m = std::string("mount ") + dst + " (warn)";
            perror(m.c_str());
        }
    }

    if (umount2("/oldroot", MNT_DETACH) != 0) { perror("umount /oldroot"); return -1; }
    rmdir("/oldroot");
    return 0;
}

static volatile pid_t g_child = -1;

static void forward_signal(int sig) {
    pid_t c = g_child;
    if (c > 0) kill(c, sig);
}

static void install_forwarding(pid_t child) {
    g_child = child;
    struct sigaction sa{};
    sa.sa_handler = forward_signal;
    sigemptyset(&sa.sa_mask);
    // Don't restart waitpid; we want EINTR-free reap via loop below.
    sa.sa_flags = 0;
    sigaction(SIGINT, &sa, nullptr);
    sigaction(SIGTERM, &sa, nullptr);
    // SIGCHLD default; ignore SIGPIPE from `ip` helpers.
    signal(SIGPIPE, SIG_IGN);
}

static int child_func(void* arg) {
    ChildArgs* a = static_cast<ChildArgs*>(arg);
    const ContainerConfig& cfg = *a->cfg;

    // Wait for parent to install uid/gid map. Until then we have no caps.
    char b = 0;
    if (read(a->syncFd, &b, 1) != 1) {
        perror("sync pipe");
        return 1;
    }
    close(a->syncFd);

    // Don't propagate mounts to host.
    if (mount(nullptr, "/", nullptr, MS_REC | MS_PRIVATE, nullptr) != 0) {
        perror("mount MS_PRIVATE");
        return 1;
    }

    if (cfg.newUts) {
        if (sethostname(cfg.hostname.c_str(), cfg.hostname.size()) != 0) {
            perror("sethostname");
            return 1;
        }
    }

    // Net must be configured BEFORE pivot_root: host `ip` binary is hidden after.
    // lo/veth setup uses the new netns (we are inside it when mode != Host).
    net_setup_child(cfg.net);

    if (!cfg.rootfs.empty()) {
        if (setup_rootfs(cfg.rootfs) != 0) return 1;
    } else if (cfg.newNs) {
        // Fresh /proc so tools see only container PIDs (mount ns is private).
        if (mount("proc", "/proc", "proc", MS_NOSUID | MS_NOEXEC | MS_NODEV, nullptr) != 0) {
            perror("mount /proc");
            return 1;
        }
    }

    // Build C-style argv for execvp.
    std::vector<char*> cargv;
    cargv.reserve(cfg.argv.size() + 1);
    for (auto& s : cfg.argv) cargv.push_back(const_cast<char*>(s.c_str()));
    cargv.push_back(nullptr);

    execvp(cargv[0], cargv.data());
    perror("execvp");
    return 1;
}

int container_run(const ContainerConfig& cfg) {
    if (cfg.argv.empty()) {
        std::cerr << "miniContainer: no command given\n";
        return 1;
    }

    uid_t hostUid = getuid();
    gid_t hostGid = getgid();

    int syncPipe[2];
    if (pipe(syncPipe) != 0) { perror("pipe"); return 1; }
    // Don't leak pipe into exec'd program.
    fcntl(syncPipe[0], F_SETFD, FD_CLOEXEC);
    fcntl(syncPipe[1], F_SETFD, FD_CLOEXEC);

    ChildArgs args{nullptr, syncPipe[0]};

    std::array<char, kStackSize> stack{};
    // Make a mutable copy for host-side net setup (assigns IPs/iface names).
    ContainerConfig live = cfg;
    // Pre-compute container IP BEFORE clone: child has a COW copy of memory,
    // so post-clone parent edits are invisible to it. Child only needs
    // containerIp/gateway/contIf, all fixed here.
    if (live.net.mode == NetMode::Bridge && live.net.containerIp.empty()) {
        int host = 2 + (getpid() % 250);
        live.net.containerIp = "10.88.0." + std::to_string(host) + "/16";
    }
    args.cfg = &live;
    int flags = SIGCHLD | CLONE_NEWUSER;
    if (live.newPid) flags |= CLONE_NEWPID;
    if (live.newNs)  flags |= CLONE_NEWNS;
    if (live.newUts) flags |= CLONE_NEWUTS;
    if (live.newIpc) flags |= CLONE_NEWIPC;
    bool wantNet = live.net.mode != NetMode::Host;
    if (wantNet) flags |= CLONE_NEWNET;

    pid_t child = clone(child_func, stack.data() + stack.size(), flags, &args);
    if (child < 0) {
        perror("clone");
        std::cerr << "hint: needs user ns support\n";
        return 1;
    }
    close(syncPipe[0]); // parent keeps write-end

    // Parent installs the uid/gid map for the child (root inside <-> user outside).
    char map[64];
    snprintf(map, sizeof(map), "0 %d 1\n", (int)hostUid);
    std::string err;
    std::string dir = "/proc/" + std::to_string(child) + "/";
    bool ok = write_file_str(dir + "setgroups", "deny", err)
           && write_file_str(dir + "uid_map", map, err);
    if (ok) {
        snprintf(map, sizeof(map), "0 %d 1\n", (int)hostGid);
        ok = write_file_str(dir + "gid_map", map, err);
    }
    if (!ok) {
        std::cerr << "miniContainer: " << err << "\n";
        // Wake child so it exits instead of hanging, then reap.
        char c = 0;
        [[maybe_unused]] auto w = write(syncPipe[1], &c, 1);
        close(syncPipe[1]);
        int st = 0;
        waitpid(child, &st, 0);
        return 1;
    }

    // Host-side networking (veth+bridge; needs root). Must run while child
    // waits on the sync pipe, before it configures its side + execs.
    if (live.net.mode == NetMode::Bridge) {
        std::string nerr;
        if (!net_setup_host(child, live.net, nerr)) {
            std::cerr << "miniContainer: net: " << nerr << "\n";
            char c = 0;
            [[maybe_unused]] auto w = write(syncPipe[1], &c, 1);
            close(syncPipe[1]);
            int st = 0;
            waitpid(child, &st, 0);
            return 1;
        }
    }

    // Cgroups: create + join before waking child so limits apply from exec.
    std::string cgPath, cgWarn;
    if (live.limits.enabled()) {
        cgPath = cgroup_create_for_pid(child, live.limits, cgWarn);
        if (cgPath.empty()) {
            std::cerr << "miniContainer: cgroup: " << cgWarn << "\n";
        } else if (!cgWarn.empty()) {
            std::cerr << "miniContainer: cgroup warn: " << cgWarn << "\n";
        }
    }

    // Maps + net ready -> let child continue.
    char c = 0;
    if (write(syncPipe[1], &c, 1) != 1) { perror("sync write"); return 1; }
    close(syncPipe[1]);

    install_forwarding(child);
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {
        if (errno == EINTR) continue; // forwarded signal interrupted us
        perror("waitpid");
        return 1;
    }
    g_child = -1;
    cgroup_cleanup(cgPath);
    if (live.net.mode == NetMode::Bridge && !live.net.hostIf.empty()) {
        // Best-effort veth cleanup (bridge stays for reuse).
        std::string cmd = "ip link del " + live.net.hostIf + " 2>/dev/null";
        [[maybe_unused]] int r = system(cmd.c_str());
    }
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 1;
}
