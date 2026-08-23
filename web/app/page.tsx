"use client"
import React, { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Cpu,
  HardDrive,
  Network as NetworkIcon,
  Shield,
  GitBranch,
  Box,
  Server,
  Activity,
  BookOpen,
  Layers,
  Lock,
  Gauge,
  ChevronRight,
  ChevronDown,
  Fingerprint,
  FolderTree,
  Workflow,
} from "lucide-react";

/* ============================================================================
   MiniContainer — systems engineering portfolio site
   Single-file React component. No external CSS files required — all styling
   lives in the <style> block at the bottom of this component so it can be
   dropped into any React project as-is.
============================================================================ */

/* ---------------------------------- data --------------------------------- */

type ArchNode = {
  id: string;
  label: string;
  sub?: string;
  desc: string;
  syscall?: string;
};

const ARCH_ROOT: ArchNode = {
  id: "process",
  label: "Container Process",
  desc:
    "The entry point. clone() forks a new process directly into a fresh set of namespaces, before execve() replaces its image with the requested binary.",
  syscall: "clone(CLONE_NEWPID | CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWNET)",
};

const ARCH_NAMESPACES: ArchNode[] = [
  {
    id: "pid",
    label: "PID NS",
    desc:
      "The container sees itself as PID 1. Processes outside the namespace are invisible — ps, top, and /proc only ever show what's inside.",
    syscall: "CLONE_NEWPID",
  },
  {
    id: "mount",
    label: "Mount NS",
    desc:
      "A private mount table. pivot_root() swaps the container's / without ever touching the host's filesystem or mount points.",
    syscall: "CLONE_NEWNS",
  },
  {
    id: "uts",
    label: "UTS NS",
    desc:
      "An isolated hostname and domain name. sethostname() inside the container has zero effect on the host.",
    syscall: "CLONE_NEWUTS",
  },
  {
    id: "net",
    label: "NET NS",
    desc:
      "A private network stack — its own loopback, interfaces, routing table, and iptables rules, reachable only through a veth pair.",
    syscall: "CLONE_NEWNET",
  },
];

const ARCH_LEAVES: ArchNode[] = [
  {
    id: "process-iso",
    label: "Process Isolation",
    desc: "An isolated process tree, its own /proc, and a PID 1 that owns the container's lifecycle.",
  },
  {
    id: "rootfs-iso",
    label: "RootFS Isolation",
    desc: "chroot / pivot_root gives the container a dedicated root filesystem the host can't see into.",
  },
  {
    id: "hostname-iso",
    label: "Hostname Isolation",
    desc: "A container-local hostname, set once at boot and scoped entirely to the UTS namespace.",
  },
  {
    id: "veth-net",
    label: "veth Network",
    desc: "A virtual ethernet pair wires the container's eth0 to a bridge port on the host.",
  },
];

const LIFECYCLE = [
  { title: "User Command", desc: "You run minicontainer run ubuntu /bin/bash from a shell." },
  { title: "minicontainer run", desc: "The runtime parses the image root, command, and resource flags." },
  { title: "fork / clone", desc: "clone() spawns a child directly inside new namespace flags — one syscall, four namespaces." },
  { title: "Create namespaces", desc: "PID, mount, UTS, and network namespaces are established for the child before it runs anything." },
  { title: "Configure filesystem", desc: "pivot_root() swaps in the container's rootfs; /proc is remounted for the new PID namespace." },
  { title: "Apply cgroup limits", desc: "The child's PID is written into a cgroup with CPU, memory, and pids.max limits." },
  { title: "Configure networking", desc: "A veth pair is created, one end moved into the namespace, the other attached to bridge0." },
  { title: "execve()", desc: "The container's own image replaces the runtime's process image entirely." },
  { title: "Isolated Process", desc: "PID 1 runs, fully isolated, fully limited, fully alive inside its namespaces." },
];

const FEATURES: {
  icon: React.ElementType;
  title: string;
  desc: string;
  api: string;
}[] = [
  { icon: Fingerprint, title: "PID Isolation", desc: "Container processes get their own PID tree, numbered from 1.", api: "CLONE_NEWPID" },
  { icon: FolderTree, title: "Filesystem Isolation", desc: "A dedicated root filesystem, invisible to the host and other containers.", api: "pivot_root(2)" },
  { icon: Server, title: "UTS Isolation", desc: "Independent hostname and domain, set once and scoped to the container.", api: "CLONE_NEWUTS" },
  { icon: NetworkIcon, title: "Network Isolation", desc: "A private network namespace reachable only through a veth pair.", api: "CLONE_NEWNET" },
  { icon: Gauge, title: "Cgroups", desc: "Hard limits on CPU shares, memory, and process count per container.", api: "cgroup v2" },
  { icon: Workflow, title: "Process Management", desc: "Full lifecycle control — spawn, wait, signal, and reap container processes.", api: "fork / waitpid" },
  { icon: GitBranch, title: "Virtual Networking", desc: "veth pairs and a Linux bridge give containers routable IPs on a private subnet.", api: "veth + bridge" },
  { icon: Shield, title: "Security", desc: "Dropped capabilities and a seccomp filter narrow the container's syscall surface.", api: "capset / seccomp" },
];

const PRIMITIVES: { name: string; sig: string; desc: string }[] = [
  { name: "fork()", sig: "pid_t fork(void);", desc: "Duplicates the calling process. The classic building block MiniContainer layers namespace creation on top of." },
  { name: "clone()", sig: "int clone(fn, stack, flags, arg);", desc: "The real workhorse — a single call that can create a child process and place it into new namespaces atomically." },
  { name: "execve()", sig: "int execve(path, argv, envp);", desc: "Replaces the calling process's image. This is how the container's PID 1 becomes the requested binary." },
  { name: "mount()", sig: "int mount(src, target, fs, flags, data);", desc: "Builds the container's private mount table inside its mount namespace." },
  { name: "pivot_root()", sig: "int pivot_root(new_root, put_old);", desc: "Swaps the process's root filesystem, making the container's rootfs the only one visible from inside." },
  { name: "namespaces", sig: "man 7 namespaces", desc: "Kernel-level partitioning of global resources — PID, mount, UTS, and network — so each container sees its own view." },
  { name: "cgroups", sig: "/sys/fs/cgroup/…", desc: "The kernel's resource accounting and limiting mechanism. MiniContainer writes CPU, memory, and pids controllers per container." },
  { name: "veth", sig: "ip link add veth0 type veth peer name veth1", desc: "A virtual ethernet cable — one end lives in the container's netns, the other attaches to the host bridge." },
  { name: "Linux bridge", sig: "ip link add bridge0 type bridge", desc: "A software switch on the host that connects every container's veth-host end to the outside network." },
  { name: "seccomp", sig: "prctl(PR_SET_SECCOMP, …);", desc: "A syscall filter that restricts which syscalls a container is even allowed to make." },
];

const COMPARISON: { label: string; proc: string; mini: string }[] = [
  { label: "Process visibility", proc: "Sees every process on the host", mini: "Sees only its own PID namespace" },
  { label: "Filesystem", proc: "Shares the host root filesystem", mini: "Dedicated rootfs via pivot_root()" },
  { label: "Network", proc: "Uses the host network stack directly", mini: "Private netns behind a veth + bridge" },
  { label: "Resource limits", proc: "Unbounded by default", mini: "CPU / memory / pids capped by cgroups" },
  { label: "Hostname", proc: "Reads the host's hostname", mini: "Independent hostname via UTS namespace" },
  { label: "Isolation", proc: "None — a peer of every other process", mini: "Namespaced, cgrouped, capability-dropped" },
];

const TECH = ["C++", "Linux", "System Calls", "Namespaces", "Cgroups", "Networking", "CMake", "Linux Tooling"];

const HIGHLIGHTS = [
  { icon: Layers, stat: "4", label: "Namespaces isolated", sub: "PID · Mount · UTS · NET" },
  { icon: Gauge, stat: "3", label: "Cgroup controllers", sub: "cpu · memory · pids" },
  { icon: NetworkIcon, stat: "1:1", label: "veth pairs per container", sub: "bridged to bridge0" },
  { icon: Lock, stat: "seccomp", label: "Syscall filtering", sub: "restricted default profile" },
];

const BOOT_LOG = [
  { t: "$ minicontainer run ubuntu /bin/bash", c: "cmd" },
  { t: "→ creating namespaces (pid, mount, uts, net)", c: "out" },
  { t: "→ pivot_root → /var/lib/minicontainer/rootfs/ubuntu", c: "out" },
  { t: "→ cgroup: cpu=0.5 mem=512M pids=64", c: "out" },
  { t: "→ veth0 ⇄ veth1 attached to bridge0", c: "out" },
  { t: "container@mini:~$ hostname", c: "cmd" },
  { t: "mini-container", c: "out" },
  { t: "container@mini:~$ ps", c: "cmd" },
  { t: "PID   COMMAND", c: "out" },
  { t: "1     /bin/bash", c: "out" },
  { t: "8     ps", c: "out" },
  { t: "container@mini:~$ ip addr show eth0", c: "cmd" },
  { t: "eth0: 172.18.0.2/24", c: "out" },
  { t: "container@mini:~$ exit", c: "cmd" },
];

/* ------------------------------- component -------------------------------- */

export default function MiniContainerSite() {
  const [activeNode, setActiveNode] = useState<ArchNode>(ARCH_ROOT);
  const [step, setStep] = useState(0);
  const [openPrimitive, setOpenPrimitive] = useState<string | null>("clone()");
  const [typedLines, setTypedLines] = useState<number>(0);
  const [meters, setMeters] = useState({ cpu: 0, mem: 0, proc: 0 });
  const termRef = useRef<HTMLDivElement>(null);

  // typewriter effect for the live-demo terminal
  useEffect(() => {
    if (typedLines >= BOOT_LOG.length) return;
    const t = setTimeout(() => setTypedLines((n) => n + 1), typedLines === 0 ? 400 : 480);
    return () => clearTimeout(t);
  }, [typedLines]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [typedLines]);

  // animate resource meters up to target once, on mount
  useEffect(() => {
    const targets = { cpu: 70, mem: 51, proc: 24 };
    const id = setInterval(() => {
      setMeters((m) => ({
        cpu: Math.min(targets.cpu, m.cpu + 3),
        mem: Math.min(targets.mem, m.mem + 2),
        proc: Math.min(targets.proc, m.proc + 1),
      }));
    }, 24);
    return () => clearInterval(id);
  }, []);

  // auto-advance lifecycle stepper
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % LIFECYCLE.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mc-root">
      <style>{CSS}</style>

      {/* -------------------------------- nav -------------------------------- */}
      <header className="mc-nav">
        <div className="mc-nav-inner">
          <a href="#top" className="mc-brand">
            <Box size={18} strokeWidth={2.25} />
            <span>MiniContainer</span>
          </a>
          <nav className="mc-nav-links">
            <a href="#architecture">Architecture</a>
            <a href="#lifecycle">Lifecycle</a>
            <a href="#features">Features</a>
            <a href="#primitives">Primitives</a>
            <a href="#network">Networking</a>
            <a href="#demo">Demo</a>
          </nav>
        </div>
      </header>

      {/* -------------------------------- hero -------------------------------- */}
      <section id="top" className="mc-hero">
        <div className="mc-grid-bg" aria-hidden="true" />
        <div className="mc-hero-inner">
          <div className="mc-hero-copy">
            <div className="mc-eyebrow">
              <span className="mc-dot" /> built from scratch in C++
            </div>
            <h1 className="mc-h1">MiniContainer</h1>
            <p className="mc-sub">A lightweight Linux container runtime built from scratch in C++.</p>
            <p className="mc-desc">
              MiniContainer uses raw Linux kernel primitives — namespaces, cgroups, virtual ethernet pairs,
              and a handful of syscalls — to isolate a process into something that behaves like a container.
              No Docker daemon underneath, no OCI runtime, no abstraction layer that wasn't written by hand.
            </p>
            <div className="mc-cta-row">
              <a href="#architecture" className="mc-btn mc-btn-primary">
                Explore Architecture <ChevronRight size={16} />
              </a>
            </div>
          </div>

          <div className="mc-hero-term">
            <TerminalChrome label="mini@host:~">
              <div className="mc-term-line">
                <span className="mc-prompt">$</span> minicontainer run /bin/bash
              </div>
              <div className="mc-term-line mc-term-out">→ creating namespaces (pid, mount, uts, net)…</div>
              <div className="mc-term-line mc-term-out">→ execve → /bin/bash</div>
              <div className="mc-term-line">
                <span className="mc-prompt mc-prompt-alt">container@mini:~$</span> ps
              </div>
              <div className="mc-term-line mc-term-out">PID&nbsp;&nbsp;COMMAND</div>
              <div className="mc-term-line mc-term-out">1&nbsp;&nbsp;&nbsp;&nbsp;/bin/bash</div>
              <div className="mc-term-line mc-cursor-line">
                <span className="mc-prompt mc-prompt-alt">container@mini:~$</span>
                <span className="mc-cursor" />
              </div>
            </TerminalChrome>
          </div>
        </div>
      </section>

      {/* ---------------------------- architecture ---------------------------- */}
      <Section
        id="architecture"
        eyebrow="Centerpiece"
        title="Runtime architecture"
        desc="Every container is one process, wrapped in four namespaces, given a filesystem of its own, and handed a private path to the network. Click any node to see what it actually does."
      >
        <div className="mc-arch">
          <div className="mc-arch-diagram">
            <div className="tree-root-row">
              <ArchBox node={ARCH_ROOT} active={activeNode.id === ARCH_ROOT.id} onSelect={setActiveNode} kind="root" />
            </div>

            <div className="tree-children">
              {ARCH_NAMESPACES.map((n) => (
                <div className="tree-child" key={n.id}>
                  <ArchBox node={n} active={activeNode.id === n.id} onSelect={setActiveNode} kind="ns" />
                </div>
              ))}
            </div>

            <div className="tree-children">
              {ARCH_LEAVES.map((n) => (
                <div className="tree-child" key={n.id}>
                  <ArchBox node={n} active={activeNode.id === n.id} onSelect={setActiveNode} kind="leaf" />
                </div>
              ))}
            </div>

            <div className="tree-continue">
              <span>NET NS continues to bridge0 → host network</span>
              <a href="#network">see the network path <ChevronRight size={13} /></a>
            </div>
          </div>

          <div className="mc-arch-detail">
            <div className="mc-arch-detail-label">selected node</div>
            <div className="mc-arch-detail-title">{activeNode.label}</div>
            <p className="mc-arch-detail-desc">{activeNode.desc}</p>
            {activeNode.syscall && <code className="mc-arch-detail-code">{activeNode.syscall}</code>}
          </div>
        </div>
      </Section>

      {/* ------------------------------ lifecycle ------------------------------ */}
      <Section
        id="lifecycle"
        eyebrow="Sequence"
        title="How a container comes up"
        desc="One command triggers nine ordered steps between the shell and an isolated, running process."
      >
        <div className="mc-lifecycle">
          <div className="mc-lifecycle-rail">
            {LIFECYCLE.map((s, i) => (
              <button
                key={s.title}
                className={"mc-lifecycle-node" + (i === step ? " active" : i < step ? " done" : "")}
                onClick={() => setStep(i)}
              >
                <span className="mc-lifecycle-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="mc-lifecycle-title">{s.title}</span>
              </button>
            ))}
          </div>
          <div className="mc-lifecycle-panel">
            <div className="mc-lifecycle-panel-num">{String(step + 1).padStart(2, "0")} / {LIFECYCLE.length}</div>
            <div className="mc-lifecycle-panel-title">{LIFECYCLE[step].title}</div>
            <p className="mc-lifecycle-panel-desc">{LIFECYCLE[step].desc}</p>
          </div>
        </div>
      </Section>

      {/* ------------------------------- features ------------------------------ */}
      <Section
        id="features"
        eyebrow="Capabilities"
        title="What the runtime does"
        desc="Eight primitives combine to make a process behave like a container."
      >
        <div className="mc-features-grid">
          {FEATURES.map((f) => (
            <div className="mc-feature-card" key={f.title}>
              <div className="mc-feature-icon">
                <f.icon size={18} strokeWidth={2} />
              </div>
              <div className="mc-feature-title">{f.title}</div>
              <p className="mc-feature-desc">{f.desc}</p>
              <code className="mc-feature-api">{f.api}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------ primitives ------------------------------ */}
      <Section
        id="primitives"
        eyebrow="Reference"
        title="Linux primitives used"
        desc="The kernel interfaces MiniContainer is actually built on — not marketing terms, the real calls."
      >
        <div className="mc-primitives">
          {PRIMITIVES.map((p) => {
            const open = openPrimitive === p.name;
            return (
              <div className={"mc-primitive" + (open ? " open" : "")} key={p.name}>
                <button className="mc-primitive-head" onClick={() => setOpenPrimitive(open ? null : p.name)}>
                  <span className="mc-primitive-name">{p.name}</span>
                  <ChevronDown size={16} className="mc-primitive-chevron" />
                </button>
                {open && (
                  <div className="mc-primitive-body">
                    <code className="mc-primitive-sig">{p.sig}</code>
                    <p>{p.desc}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* -------------------------------- network -------------------------------- */}
      <Section
        id="network"
        eyebrow="Networking"
        title="Container network path"
        desc="A packet leaving the container crosses a veth pair and a bridge before it ever touches the host's interface."
      >
        <NetworkDiagram />
      </Section>

      {/* ---------------------------- resource limits ---------------------------- */}
      <Section
        id="limits"
        eyebrow="Cgroups"
        title="Resource limits, enforced by the kernel"
        desc="Every container is written into a cgroup at boot. These aren't soft suggestions — the kernel enforces them."
      >
        <div className="mc-meters">
          <Meter icon={Cpu} label="CPU" value={meters.cpu} display="70%" />
          <Meter icon={HardDrive} label="Memory" value={meters.mem} display="512 MB / 1 GB" />
          <Meter icon={Activity} label="Processes" value={meters.proc} display="12 / 50" />
        </div>
      </Section>

      {/* --------------------------------- demo --------------------------------- */}
      <Section
        id="demo"
        eyebrow="Live demo"
        title="A full run, start to exit"
        desc="The same commands from a real MiniContainer session."
      >
        <TerminalChrome label="mini@host:~" wide>
          <div className="mc-term-scroll" ref={termRef}>
            {BOOT_LOG.slice(0, typedLines).map((l, i) => (
              <div key={i} className={"mc-term-line" + (l.c === "out" ? " mc-term-out" : "")}>
                {l.t}
              </div>
            ))}
            {typedLines < BOOT_LOG.length && (
              <div className="mc-term-line mc-cursor-line">
                <span className="mc-cursor" />
              </div>
            )}
          </div>
        </TerminalChrome>
      </Section>

      {/* ------------------------------ comparison ------------------------------ */}
      <Section
        id="comparison"
        eyebrow="Before / after"
        title="A process vs. a MiniContainer process"
        desc="Same binary, same kernel — the difference is entirely in what the process can see."
      >
        <div className="mc-compare">
          <div className="mc-compare-head">
            <div />
            <div className="mc-compare-col-h">Traditional Process</div>
            <div className="mc-compare-col-h mini">MiniContainer</div>
          </div>
          {COMPARISON.map((c) => (
            <div className="mc-compare-row" key={c.label}>
              <div className="mc-compare-label">{c.label}</div>
              <div className="mc-compare-val">{c.proc}</div>
              <div className="mc-compare-val mini">{c.mini}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------- tech stack ------------------------------- */}
      <Section id="stack" eyebrow="Built with" title="Tech stack" desc="">
        <div className="mc-stack-row">
          {TECH.map((t) => (
            <span className="mc-chip" key={t}>
              {t}
            </span>
          ))}
        </div>
      </Section>

      {/* ------------------------------- highlights ------------------------------- */}
      <Section id="highlights" eyebrow="At a glance" title="Project highlights" desc="">
        <div className="mc-highlights">
          {HIGHLIGHTS.map((h) => (
            <div className="mc-highlight" key={h.label}>
              <h.icon size={18} className="mc-highlight-icon" />
              <div className="mc-highlight-stat">{h.stat}</div>
              <div className="mc-highlight-label">{h.label}</div>
              <div className="mc-highlight-sub">{h.sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* -------------------------------- footer -------------------------------- */}
      <footer className="mc-footer">
        <div className="mc-footer-inner">
          <div className="mc-footer-brand">
            <Box size={18} />
            <span>MiniContainer</span>
          </div>
          <p className="mc-footer-tag">Containers, built from Linux primitives.</p>
          <div className="mc-footer-links">
            <a href="#" className="mc-btn mc-btn-ghost small">
              <BookOpen size={15} /> Documentation
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------ sub-components ----------------------------- */

function Section({
  id,
  eyebrow,
  title,
  desc,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mc-section">
      <div className="mc-section-inner">
        <div className="mc-section-head">
          <div className="mc-eyebrow small">{eyebrow}</div>
          <h2 className="mc-h2">{title}</h2>
          {desc && <p className="mc-section-desc">{desc}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function TerminalChrome({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={"mc-terminal" + (wide ? " wide" : "")}>
      <div className="mc-terminal-bar">
        <span className="mc-tdot red" />
        <span className="mc-tdot amber" />
        <span className="mc-tdot green" />
        <span className="mc-terminal-label">{label}</span>
      </div>
      <div className="mc-terminal-body">{children}</div>
    </div>
  );
}

function ArchBox({
  node,
  active,
  onSelect,
  kind,
}: {
  node: ArchNode;
  active: boolean;
  onSelect: (n: ArchNode) => void;
  kind: "root" | "ns" | "leaf";
}) {
  return (
    <button
      className={"arch-box " + kind + (active ? " active" : "")}
      onMouseEnter={() => onSelect(node)}
      onFocus={() => onSelect(node)}
      onClick={() => onSelect(node)}
    >
      {node.label}
    </button>
  );
}

function Meter({
  icon: Icon,
  label,
  value,
  display,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  display: string;
}) {
  return (
    <div className="mc-meter">
      <div className="mc-meter-head">
        <span className="mc-meter-label">
          <Icon size={15} /> {label}
        </span>
        <span className="mc-meter-display">{display}</span>
      </div>
      <div className="mc-meter-track">
        <div className="mc-meter-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function NetworkDiagram() {
  const hops = ["Host", "bridge0", "veth-host", "veth-container", "eth0", "Container · 172.18.0.2"];
  return (
    <div className="mc-net">
      <svg viewBox="0 0 900 120" className="mc-net-svg" preserveAspectRatio="xMidYMid meet">
        <line x1="60" y1="60" x2="840" y2="60" className="mc-net-line" />
        <circle r="5" className="mc-packet" fill="var(--accent-blue)">
          <animateMotion dur="3.2s" repeatCount="indefinite" path="M60,60 L840,60" />
        </circle>
        <circle r="5" className="mc-packet" fill="var(--accent-green)" opacity="0.75">
          <animateMotion dur="3.2s" begin="1.6s" repeatCount="indefinite" path="M840,60 L60,60" />
        </circle>
        {hops.map((h, i) => {
          const x = 60 + (i * 780) / (hops.length - 1);
          return (
            <g key={h} transform={`translate(${x},60)`}>
              <circle r="6" className="mc-net-node" />
            </g>
          );
        })}
      </svg>
      <div className="mc-net-labels">
        {hops.map((h) => (
          <div className="mc-net-label" key={h}>
            {h}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- styles --------------------------------- */

const CSS = `
:root{
  --bg:#0a0c0f;
  --bg-alt:#0d0f13;
  --panel:#12151b;
  --panel-2:#161a21;
  --border:#242932;
  --border-soft:#1c2028;
  --text:#e7eaef;
  --text-dim:#98a1b0;
  --text-faint:#5a6270;
  --accent-green:#33d489;
  --accent-blue:#4c8dff;
  --accent-amber:#f0b429;
  --mono: ui-monospace, "JetBrains Mono", "Fira Code", "SFMono-Regular", Menlo, Consolas, monospace;
  --sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.mc-root{
  background:var(--bg);
  color:var(--text);
  font-family:var(--sans);
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
.mc-root *{box-sizing:border-box;}
.mc-root a{color:inherit;text-decoration:none;}
.mc-root button{font-family:inherit;cursor:pointer;background:none;border:none;color:inherit;}

/* nav */
.mc-nav{position:sticky;top:0;z-index:40;background:rgba(10,12,15,0.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border-soft);}
.mc-nav-inner{max-width:1180px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:28px;}
.mc-brand{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-weight:600;font-size:14px;color:var(--accent-green);margin-right:auto;}
.mc-nav-links{display:flex;gap:22px;font-size:13px;color:var(--text-dim);}
.mc-nav-links a:hover{color:var(--text);}
.mc-nav-github{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim);border:1px solid var(--border);padding:6px 12px;border-radius:6px;}
.mc-nav-github:hover{color:var(--text);border-color:var(--text-faint);}
@media (max-width:780px){.mc-nav-links{display:none;}}

/* hero */
.mc-hero{position:relative;overflow:hidden;padding:80px 24px 60px;}
.mc-grid-bg{position:absolute;inset:0;
  background-image:linear-gradient(var(--border-soft) 1px, transparent 1px), linear-gradient(90deg, var(--border-soft) 1px, transparent 1px);
  background-size:42px 42px;
  mask-image:radial-gradient(ellipse 70% 60% at 50% 20%, black 10%, transparent 75%);
  opacity:0.5;
}
.mc-hero-inner{position:relative;max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1.05fr 0.95fr;gap:56px;align-items:center;}
@media (max-width:900px){.mc-hero-inner{grid-template-columns:1fr;}}
.mc-eyebrow{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:var(--accent-green);margin-bottom:18px;}
.mc-eyebrow.small{margin-bottom:10px;}
.mc-dot{width:6px;height:6px;border-radius:50%;background:var(--accent-green);box-shadow:0 0 0 3px rgba(51,212,137,0.15);}
.mc-h1{font-family:var(--mono);font-size:clamp(38px,6vw,64px);font-weight:700;letter-spacing:-0.02em;margin:0 0 14px;}
.mc-sub{font-size:19px;color:var(--text);opacity:0.92;margin:0 0 14px;font-weight:500;}
.mc-desc{font-size:15px;color:var(--text-dim);max-width:52ch;margin:0 0 28px;}
.mc-cta-row{display:flex;gap:12px;flex-wrap:wrap;}
.mc-btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:7px;font-size:14px;font-weight:600;border:1px solid transparent;transition:transform .15s ease, border-color .15s ease, background .15s ease;}
.mc-btn:hover{transform:translateY(-1px);}
.mc-btn-primary{background:var(--accent-green);color:#08130d;}
.mc-btn-primary:hover{background:#3fe697;}
.mc-btn-ghost{border-color:var(--border);color:var(--text);}
.mc-btn-ghost:hover{border-color:var(--text-faint);}
.mc-btn.small{padding:8px 14px;font-size:13px;}

/* terminal */
.mc-terminal{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(0,0,0,0.6);}
.mc-terminal-bar{display:flex;align-items:center;gap:7px;padding:10px 14px;border-bottom:1px solid var(--border-soft);background:var(--panel-2);}
.mc-tdot{width:10px;height:10px;border-radius:50%;}
.mc-tdot.red{background:#ef5350;}
.mc-tdot.amber{background:#f0b429;}
.mc-tdot.green{background:#33d489;}
.mc-terminal-label{margin-left:8px;font-family:var(--mono);font-size:12px;color:var(--text-faint);}
.mc-terminal-body{padding:20px;font-family:var(--mono);font-size:13.5px;min-height:200px;}
.mc-terminal.wide .mc-terminal-body{min-height:280px;}
.mc-term-scroll{max-height:320px;overflow-y:auto;}
.mc-term-line{padding:3px 0;color:var(--text);white-space:pre-wrap;word-break:break-word;}
.mc-term-out{color:var(--text-dim);}
.mc-prompt{color:var(--accent-green);margin-right:8px;}
.mc-prompt-alt{color:var(--accent-blue);margin-right:8px;}
.mc-cursor-line{display:flex;align-items:center;}
.mc-cursor{display:inline-block;width:8px;height:15px;background:var(--accent-green);animation:blink 1s step-end infinite;margin-left:2px;}
@keyframes blink{50%{opacity:0;}}

/* section shell */
.mc-section{padding:88px 24px;border-top:1px solid var(--border-soft);}
.mc-section-inner{max-width:1180px;margin:0 auto;}
.mc-section-head{max-width:640px;margin-bottom:44px;}
.mc-h2{font-family:var(--mono);font-size:clamp(24px,3.4vw,32px);margin:0 0 10px;letter-spacing:-0.01em;}
.mc-section-desc{color:var(--text-dim);font-size:15px;margin:0;}

/* architecture tree */
.mc-arch{display:grid;grid-template-columns:1.5fr 1fr;gap:40px;align-items:start;}
@media (max-width:900px){.mc-arch{grid-template-columns:1fr;}}
.mc-arch-diagram{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:36px 24px 26px;}
.tree-root-row{display:flex;justify-content:center;}
.tree-children{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:36px;margin-top:36px;position:relative;}
.tree-child{position:relative;}
.tree-child::before{content:"";position:absolute;top:-36px;left:50%;width:1px;height:36px;background:var(--border);transform:translateX(-50%);}
.arch-box{font-family:var(--mono);font-size:12.5px;font-weight:600;padding:12px 14px;border-radius:8px;border:1px solid var(--border);background:var(--panel-2);color:var(--text-dim);transition:all .15s ease;white-space:nowrap;}
.arch-box.root{font-size:14px;padding:14px 22px;color:var(--text);}
.arch-box:hover, .arch-box.active{border-color:var(--accent-green);color:var(--accent-green);background:rgba(51,212,137,0.06);}
.tree-continue{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding-top:18px;border-top:1px dashed var(--border-soft);font-family:var(--mono);font-size:12px;color:var(--text-faint);flex-wrap:wrap;gap:8px;}
.tree-continue a{display:inline-flex;align-items:center;gap:4px;color:var(--accent-blue);}
.mc-arch-detail{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:26px;position:sticky;top:80px;}
.mc-arch-detail-label{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);margin-bottom:10px;}
.mc-arch-detail-title{font-family:var(--mono);font-size:19px;color:var(--accent-green);margin-bottom:12px;}
.mc-arch-detail-desc{color:var(--text-dim);font-size:14px;margin:0 0 16px;}
.mc-arch-detail-code{display:block;font-family:var(--mono);font-size:12px;color:var(--accent-blue);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:6px;padding:10px 12px;word-break:break-word;}

/* lifecycle */
.mc-lifecycle{display:grid;grid-template-columns:1fr 1.2fr;gap:40px;}
@media (max-width:900px){.mc-lifecycle{grid-template-columns:1fr;}}
.mc-lifecycle-rail{display:flex;flex-direction:column;border-left:2px solid var(--border);}
.mc-lifecycle-node{display:flex;align-items:center;gap:14px;text-align:left;padding:11px 0 11px 20px;margin-left:-2px;border-left:2px solid transparent;color:var(--text-faint);transition:color .15s ease;}
.mc-lifecycle-node.done{color:var(--text-dim);border-left-color:var(--border);}
.mc-lifecycle-node.active{color:var(--accent-green);border-left-color:var(--accent-green);}
.mc-lifecycle-num{font-family:var(--mono);font-size:11px;opacity:0.7;}
.mc-lifecycle-title{font-family:var(--mono);font-size:13.5px;}
.mc-lifecycle-panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:28px;align-self:start;}
.mc-lifecycle-panel-num{font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:10px;}
.mc-lifecycle-panel-title{font-family:var(--mono);font-size:20px;color:var(--accent-green);margin-bottom:12px;}
.mc-lifecycle-panel-desc{color:var(--text-dim);font-size:14.5px;margin:0;}

/* features */
.mc-features-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
@media (max-width:900px){.mc-features-grid{grid-template-columns:repeat(2,1fr);}}
@media (max-width:520px){.mc-features-grid{grid-template-columns:1fr;}}
.mc-feature-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:20px;transition:border-color .15s ease, transform .15s ease;}
.mc-feature-card:hover{border-color:var(--accent-green);transform:translateY(-2px);}
.mc-feature-icon{width:34px;height:34px;border-radius:8px;background:var(--panel-2);border:1px solid var(--border-soft);display:flex;align-items:center;justify-content:center;color:var(--accent-green);margin-bottom:14px;}
.mc-feature-title{font-weight:600;font-size:14.5px;margin-bottom:6px;}
.mc-feature-desc{color:var(--text-dim);font-size:13px;margin:0 0 14px;}
.mc-feature-api{font-family:var(--mono);font-size:11.5px;color:var(--accent-blue);}

/* primitives */
.mc-primitives{display:flex;flex-direction:column;border-top:1px solid var(--border-soft);}
.mc-primitive{border-bottom:1px solid var(--border-soft);}
.mc-primitive-head{width:100%;display:flex;justify-content:space-between;align-items:center;padding:16px 4px;}
.mc-primitive-name{font-family:var(--mono);font-size:15px;color:var(--text);}
.mc-primitive.open .mc-primitive-name{color:var(--accent-green);}
.mc-primitive-chevron{color:var(--text-faint);transition:transform .15s ease;}
.mc-primitive.open .mc-primitive-chevron{transform:rotate(180deg);color:var(--accent-green);}
.mc-primitive-body{padding:0 4px 20px;max-width:70ch;}
.mc-primitive-sig{display:inline-block;font-family:var(--mono);font-size:12.5px;color:var(--accent-blue);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:6px;padding:6px 10px;margin-bottom:10px;}
.mc-primitive-body p{color:var(--text-dim);font-size:14px;margin:0;}

/* network */
.mc-net{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:26px 20px 14px;}
.mc-net-svg{width:100%;height:80px;overflow:visible;}
.mc-net-line{stroke:var(--border);stroke-width:1.5;}
.mc-net-node{fill:var(--panel-2);stroke:var(--text-faint);stroke-width:1.5;}
.mc-packet{filter:drop-shadow(0 0 5px currentColor);}
.mc-net-labels{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:6px;}
.mc-net-label{font-family:var(--mono);font-size:10.5px;color:var(--text-faint);text-align:center;word-break:break-word;}
@media (max-width:700px){.mc-net-labels{grid-template-columns:repeat(3,1fr);}}

/* meters */
.mc-meters{display:flex;flex-direction:column;gap:22px;max-width:640px;}
.mc-meter-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-family:var(--mono);font-size:12.5px;}
.mc-meter-label{display:flex;align-items:center;gap:8px;color:var(--text);}
.mc-meter-display{color:var(--text-faint);}
.mc-meter-track{height:9px;border-radius:5px;background:var(--panel-2);border:1px solid var(--border-soft);overflow:hidden;}
.mc-meter-fill{height:100%;background:linear-gradient(90deg,var(--accent-green),var(--accent-blue));border-radius:5px;transition:width .3s ease;}

/* comparison */
.mc-compare{border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.mc-compare-head,.mc-compare-row{display:grid;grid-template-columns:1fr 1.2fr 1.2fr;}
.mc-compare-head{background:var(--panel-2);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-faint);}
.mc-compare-col-h{padding:14px;}
.mc-compare-col-h.mini{color:var(--accent-green);}
.mc-compare-row{border-top:1px solid var(--border-soft);}
.mc-compare-label{padding:16px 14px;font-size:13.5px;color:var(--text-dim);font-weight:500;background:var(--panel);}
.mc-compare-val{padding:16px 14px;font-size:13.5px;color:var(--text-dim);border-left:1px solid var(--border-soft);}
.mc-compare-val.mini{color:var(--text);}
@media (max-width:700px){
  .mc-compare-head,.mc-compare-row{grid-template-columns:1fr;}
  .mc-compare-val{border-left:none;border-top:1px solid var(--border-soft);}
}

/* stack + highlights */
.mc-stack-row{display:flex;flex-wrap:wrap;gap:10px;}
.mc-chip{font-family:var(--mono);font-size:12.5px;padding:8px 14px;border:1px solid var(--border);border-radius:20px;color:var(--text-dim);}
.mc-highlights{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
@media (max-width:700px){.mc-highlights{grid-template-columns:repeat(2,1fr);}}
.mc-highlight{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:22px;}
.mc-highlight-icon{color:var(--accent-green);margin-bottom:14px;}
.mc-highlight-stat{font-family:var(--mono);font-size:26px;color:var(--text);margin-bottom:4px;}
.mc-highlight-label{font-size:13px;color:var(--text);margin-bottom:2px;}
.mc-highlight-sub{font-family:var(--mono);font-size:11px;color:var(--text-faint);}

/* footer */
.mc-footer{border-top:1px solid var(--border-soft);padding:48px 24px 60px;}
.mc-footer-inner{max-width:1180px;margin:0 auto;text-align:center;}
.mc-footer-brand{display:flex;align-items:center;justify-content:center;gap:8px;font-family:var(--mono);font-weight:600;color:var(--accent-green);margin-bottom:8px;}
.mc-footer-tag{color:var(--text-faint);font-size:13.5px;margin:0 0 22px;}
.mc-footer-links{display:flex;justify-content:center;gap:10px;}
`;
