# 🐳 Container Dashboard

A **pi coding agent** extension for managing Docker and Podman containers without leaving your terminal.

![](https://img.shields.io/badge/pi-0.70%2B-blue)
![](https://img.shields.io/badge/docker-supported-2496ED)
![](https://img.shields.io/badge/podman-supported-892CA0)
![](https://img.shields.io/badge/nerdctl-supported-green)

---

## ✨ Features

### 📊 TUI Widget

Live container count in pi's sidebar — always know what's running at a glance.

### 🎯 Commands

| Command                  | What it does                       |
| ------------------------ | ---------------------------------- |
| `/docker:ps`             | List containers                    |
| `/docker:logs <name>`    | Tail container logs                |
| `/docker:prune`          | Remove stopped containers          |
| `/docker:prune --images` | Remove unused images               |
| `/docker:prune --all`    | System prune (containers + images) |
| `/docker:images`         | List pulled images                 |
| `/docker:stop <name>`    | Stop a container                   |
| `/docker:start <name>`   | Start a container                  |
| `/docker:restart <name>` | Restart a container                |
| `/docker:stats`          | Show CPU/memory/network usage      |
| `/docker:inspect <name>` | Show detailed container config     |
| `/docker:top <name>`     | Show processes inside a container  |
| `/docker:rm <name>`      | Remove a container or image        |
| `/docker:detect`         | Re-detect the container runtime    |
| `/docker:runtime`        | Show detected runtime info         |

### 🤖 LLM Tools

Pi can also manage containers via these tools:
`container_ps`, `container_logs`, `container_prune`, `container_prune_images`, `container_prune_system`, `container_images`, `container_stop`, `container_start`, `container_restart`, `container_stats`, `container_inspect`, `container_top`, `container_rm`

### 🛡️ Safety

Dangerous commands (`rm -f`, `system prune -a`, etc.) are intercepted with a confirmation dialog before execution.

---

## 🔧 Requirements

- **pi** v0.70+ — [pi coding agent](https://github.com/mariozechner/pi-coding-agent)
- **Docker** or **Podman** or **Nerdctl** installed and running

---

## 📦 Installation

```bash
# From the project root
pi install container-dashboard/

# Or manually load
pi -e ./container-dashboard/index.ts
```

The extension auto-detects `docker` → `podman` → `nerdctl` at startup.

---

## 🚀 Quick Start

```bash
# Start pi
pi

# See your containers
/docker:ps

# Check resource usage
/docker:stats

# Clean up
/docker:prune --all
```

---

## 🧱 Project Structure

```
container-dashboard/
├── index.ts       # Entry point, permission gates
├── runtime.ts     # Runtime detection, CLI abstraction
├── commands.ts    # /docker:* commands
├── tools.ts       # LLM tools
├── widget.ts      # TUI widget
├── PLAN.md        # Original design doc
└── README.md      # This file
```

---

## 📄 License

MIT
