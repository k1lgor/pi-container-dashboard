import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { ContainerRuntime } from "./runtime";
import {
  listContainers,
  getContainerLogs,
  pruneContainers,
  pruneImages,
  pruneSystem,
  findContainer,
  listImages,
  stopContainer,
  startContainer,
  restartContainer,
  getContainerStats,
  inspectContainer,
  getContainerTop,
  removeContainer,
  removeImage,
  findImage,
} from "./runtime";
import { renderContainerTable, updateWidget } from "./widget";

export function registerCommands(
  pi: ExtensionAPI,
  getRuntime: () => ContainerRuntime,
  getRuntimeName: () => string,
  refreshRuntime?: (ctx?: ExtensionContext) => Promise<boolean>,
): void {
  // ── /ps ──────────────────────────────────────────────────
  pi.registerCommand("docker:ps", {
    description: "List containers. Usage: /docker:ps [--running] [--all]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const showAll = args.includes("--all") || args.includes("-a");
      const runningOnly = args.includes("--running");
      const containers = await listContainers(pi, runtime, showAll);

      if (containers.length === 0) {
        ctx.ui.notify("No containers found", "info");
        return;
      }

      const displayed = runningOnly
        ? containers.filter((c) => c.status === "running")
        : containers;

      if (ctx.hasUI) {
        const theme = ctx.ui.theme;
        const lines = renderContainerTable(displayed, theme, 80);
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  // ── /logs ────────────────────────────────────────────────
  pi.registerCommand("docker:logs", {
    description:
      "Show container logs. Usage: /docker:logs <name|id> [-n lines]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const parts = args.trim().split(/\s+/);
      let lines = 50;
      let containerId: string | undefined;

      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "-n" && i + 1 < parts.length) {
          lines = parseInt(parts[i + 1], 10) || 50;
          i++;
        } else if (parts[i]) {
          containerId = parts[i];
        }
      }

      if (!containerId) {
        ctx.ui.notify("Usage: /logs <container-name|id> [-n lines]", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }

      const logOutput = await getContainerLogs(
        pi,
        runtime,
        container.id,
        lines,
      );
      ctx.ui.notify(
        `📋 Logs for ${container.name} (last ${lines} lines):\n${logOutput}`,
        "info",
      );
    },
  });

  // ── /prune ──────────────────────────────────────────────
  pi.registerCommand("docker:prune", {
    description:
      "Free up disk space. Usage: /docker:prune [--containers] [--images] [--all]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const flags = args.trim().split(/\s+/);
      const pruneImagesFlag =
        flags.includes("--images") || flags.includes("-i");
      const systemPrune = flags.includes("--all") || flags.includes("-a");

      if (systemPrune) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "System Prune",
            "Remove ALL stopped containers AND unused images?\n\nThis cannot be undone.",
          );
          if (!ok) {
            ctx.ui.notify("Prune cancelled", "info");
            return;
          }
        }
        const result = await pruneSystem(pi, runtime);
        if (result.success) {
          ctx.ui.notify("Pruned! Freed: " + result.freed, "info");
        } else {
          ctx.ui.notify("Prune failed: " + result.output, "error");
        }
      } else if (pruneImagesFlag) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Prune images?",
            "Remove ALL unused images?",
          );
          if (!ok) {
            ctx.ui.notify("Prune cancelled", "info");
            return;
          }
        }
        const result = await pruneImages(pi, runtime);
        if (result.success) {
          ctx.ui.notify("Images pruned! Freed: " + result.freed, "info");
        } else {
          ctx.ui.notify("Prune failed: " + result.output, "error");
        }
      } else {
        const all = await listContainers(pi, runtime, true);
        const stopped = all.filter(
          (c) => c.status === "exited" || c.status === "created",
        );
        if (stopped.length === 0) {
          ctx.ui.notify(
            "Nothing to prune. Try --images or --all to free more space.",
            "info",
          );
          return;
        }
        if (ctx.hasUI) {
          const theme = ctx.ui.theme;
          const names = stopped
            .map((c) => "  \u2022 " + theme.fg("dim", c.id) + " " + c.name)
            .join("\n");
          const ok = await ctx.ui.confirm(
            "Prune containers?",
            "Remove " + stopped.length + " stopped container(s)?\n" + names,
          );
          if (!ok) {
            ctx.ui.notify("Prune cancelled", "info");
            return;
          }
        }
        const result = await pruneContainers(pi, runtime);
        if (result.success) {
          ctx.ui.notify("Pruned! Freed: " + result.freed, "info");
        } else {
          ctx.ui.notify("Prune failed: " + result.output, "error");
        }
      }

      await updateWidget(pi, ctx, runtime, getRuntimeName());
    },
  });

  // ── /runtime ────────────────────────────────────────────
  pi.registerCommand("docker:runtime", {
    description: "Show detected container runtime. Usage: /docker:runtime",
    handler: async (_args, ctx) => {
      const runtime = getRuntime();
      const name = getRuntimeName();
      if (runtime) {
        ctx.ui.notify(`✅ Using ${name}`, "info");
      } else {
        ctx.ui.setWidget("container-dashboard", [
          "❌ No container runtime detected.",
          "",
          "Install one of:",
          "  🐳 Docker   - https://docker.com",
          "  🟣 Podman   - https://podman.io",
          "  📦 Nerdctl  - https://github.com/containerd/nerdctl",
        ]);
        ctx.ui.notify(
          "❌ No container runtime detected. Install Docker or Podman.",
          "error",
        );
      }
    },
  });

  // ── /docker:images ─────────────────────────────────────
  pi.registerCommand("docker:images", {
    description: "List images. Usage: /docker:images",
    handler: async (_args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }
      const images = await listImages(pi, runtime);
      if (images.length === 0) {
        ctx.ui.notify("No images found", "info");
        return;
      }

      if (ctx.hasUI) {
        const theme = ctx.ui.theme;
        const lines: string[] = ["", theme.fg("accent", " Images "), ""];
        lines.push(
          theme.fg(
            "muted",
            "  REPOSITORY          TAG          ID             SIZE       CREATED",
          ),
        );
        lines.push(theme.fg("borderMuted", "  " + "─".repeat(68)));
        for (const img of images) {
          const id = theme.fg("dim", img.id);
          const repo = theme.fg(
            "text",
            padRight(truncate(img.repository, 20), 20),
          );
          const tag = theme.fg("accent", padRight(truncate(img.tag, 12), 12));
          const size = theme.fg("warning", padRight(img.size, 10));
          const created = theme.fg("muted", truncate(img.created, 15));
          lines.push(`  ${repo} ${tag} ${id}  ${size} ${created}`);
        }
        lines.push("");
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  // ── /docker:stop ──────────────────────────────────────
  pi.registerCommand("docker:stop", {
    description: "Stop a container. Usage: /docker:stop <name|id> [-t timeout]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const parts = args.trim().split(/\s+/);
      let containerId: string | undefined;
      for (const p of parts) {
        if (p && !p.startsWith("-")) {
          containerId = p;
          break;
        }
      }
      if (!containerId) {
        ctx.ui.notify("Usage: /docker:stop <name|id>", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }
      if (container.status !== "running") {
        ctx.ui.notify(`${container.name} is not running`, "warning");
        return;
      }

      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Stop container?",
          `Stop ${container.name} (${container.id})?`,
        );
        if (!ok) {
          ctx.ui.notify("Stop cancelled", "info");
          return;
        }
      }

      const result = await stopContainer(pi, runtime, container.id);
      if (result.success) {
        ctx.ui.notify(`⏹️ Stopped ${container.name}`, "info");
      } else {
        ctx.ui.notify(`Failed to stop: ${result.output}`, "error");
      }
      await updateWidget(pi, ctx, runtime, getRuntimeName());
    },
  });

  // ── /docker:start ─────────────────────────────────────
  pi.registerCommand("docker:start", {
    description: "Start a stopped container. Usage: /docker:start <name|id>",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const containerId = args.trim().split(/\s+/)[0];
      if (!containerId) {
        ctx.ui.notify("Usage: /docker:start <name|id>", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }
      if (container.status === "running") {
        ctx.ui.notify(`${container.name} is already running`, "info");
        return;
      }

      const result = await startContainer(pi, runtime, container.id);
      if (result.success) {
        ctx.ui.notify(`▶️ Started ${container.name}`, "info");
      } else {
        ctx.ui.notify(`Failed to start: ${result.output}`, "error");
      }
      await updateWidget(pi, ctx, runtime, getRuntimeName());
    },
  });

  // ── /docker:restart ───────────────────────────────────
  pi.registerCommand("docker:restart", {
    description:
      "Restart a container. Usage: /docker:restart <name|id> [-t timeout]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const containerId = args.trim().split(/\s+/)[0];
      if (!containerId) {
        ctx.ui.notify("Usage: /docker:restart <name|id>", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }

      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Restart container?",
          `Restart ${container.name} (${container.id})?`,
        );
        if (!ok) {
          ctx.ui.notify("Restart cancelled", "info");
          return;
        }
      }

      const result = await restartContainer(pi, runtime, container.id);
      if (result.success) {
        ctx.ui.notify(`🔄 Restarted ${container.name}`, "info");
      } else {
        ctx.ui.notify(`Failed to restart: ${result.output}`, "error");
      }
      await updateWidget(pi, ctx, runtime, getRuntimeName());
    },
  });

  // ── /docker:stats ─────────────────────────────────────
  pi.registerCommand("docker:stats", {
    description:
      "Show live resource usage for containers. Usage: /docker:stats",
    handler: async (_args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const stats = await getContainerStats(pi, runtime);
      if (stats.length === 0) {
        ctx.ui.notify("No running containers or stats unavailable", "info");
        return;
      }

      if (ctx.hasUI) {
        const theme = ctx.ui.theme;
        const lines: string[] = [
          "",
          theme.fg("accent", " Container Stats "),
          "",
        ];
        lines.push(
          theme.fg(
            "muted",
            "  NAME          CPU %       MEM USAGE / LIMIT       NET IO",
          ),
        );
        lines.push(theme.fg("borderMuted", "  " + "─".repeat(55)));
        for (const s of stats) {
          const name = theme.fg("text", padRight(truncate(s.name, 14), 14));
          const cpu = theme.fg("success", padRight(s.cpuPercent, 10));
          const mem = theme.fg("warning", padRight(s.memoryUsage, 22));
          const net = theme.fg("muted", s.netIO);
          lines.push(`  ${name} ${cpu} ${mem} ${net}`);
        }
        lines.push("");
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  // ── /docker:inspect ───────────────────────────────────
  pi.registerCommand("docker:inspect", {
    description:
      "Show detailed container config. Usage: /docker:inspect <name|id>",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const containerId = args.trim().split(/\s+/)[0];
      if (!containerId) {
        ctx.ui.notify("Usage: /docker:inspect <name|id>", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }

      const result = await inspectContainer(pi, runtime, container.id);
      if (!result.success) {
        ctx.ui.notify(`Inspect failed: ${result.data}`, "error");
      } else if (ctx.hasUI) {
        const theme = ctx.ui.theme;
        // Pretty-print a summary rather than raw JSON
        try {
          const parsed = JSON.parse(result.data);
          const info = Array.isArray(parsed) ? parsed[0] : parsed;
          const lines: string[] = ["", `📋 ${container.name}`, ""];
          lines.push(`  ID:      ${theme.fg("dim", container.id)}`);
          lines.push(`  Image:   ${theme.fg("accent", container.image)}`);
          lines.push(`  Status:  ${container.status}`);
          lines.push(`  Ports:   ${container.ports || "—"}`);
          if (info.Config?.Cmd)
            lines.push(`  Command: ${info.Config.Cmd.join(" ")}`);
          if (info.Config?.Env)
            lines.push(`  Env:     ${info.Config.Env.length} variables`);
          if (info.NetworkSettings?.IPAddress)
            lines.push(`  IP:      ${info.NetworkSettings.IPAddress}`);
          if (info.Mounts?.length > 0) {
            const vols = info.Mounts.map(
              (m: { Source?: string; Destination?: string }) =>
                `${m.Source || "?"}:${m.Destination || "?"}`,
            ).join(", ");
            lines.push(`  Volumes: ${vols}`);
          }
          lines.push("");
          ctx.ui.notify(lines.join("\n"), "info");
        } catch {
          ctx.ui.notify(
            `Inspect data:\n${result.data.substring(0, 1024)}`,
            "info",
          );
        }
      } else {
        ctx.ui.notify(
          `Inspect result: ${result.data.substring(0, 512)}`,
          "info",
        );
      }
    },
  });

  // ── /docker:top ───────────────────────────────────────
  pi.registerCommand("docker:top", {
    description: "Show processes in a container. Usage: /docker:top <name|id>",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const containerId = args.trim().split(/\s+/)[0];
      if (!containerId) {
        ctx.ui.notify("Usage: /docker:top <name|id>", "error");
        return;
      }

      const container = await findContainer(pi, runtime, containerId);
      if (!container) {
        ctx.ui.notify(`Container "${containerId}" not found`, "error");
        return;
      }
      if (container.status !== "running") {
        ctx.ui.notify(`${container.name} is not running`, "warning");
        return;
      }

      const result = await getContainerTop(pi, runtime, container.id);
      if (result.success) {
        ctx.ui.notify(
          `📊 Processes in ${container.name}:\n${result.output}`,
          "info",
        );
      } else {
        ctx.ui.notify(`Failed: ${result.output}`, "error");
      }
    },
  });

  // ── /docker:rm ────────────────────────────────────────
  pi.registerCommand("docker:rm", {
    description:
      "Remove a container or image. Usage: /docker:rm <name|id> [--force]",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime) {
        ctx.ui.notify("No container runtime detected", "error");
        return;
      }

      const parts = args.trim().split(/\s+/);
      const force = parts.includes("--force") || parts.includes("-f");
      const target = parts.find((p) => p && !p.startsWith("-"));
      if (!target) {
        ctx.ui.notify("Usage: /docker:rm <name|id> [--force]", "error");
        return;
      }

      // Try as container first
      const container = await findContainer(pi, runtime, target);
      if (container) {
        if (container.status === "running" && !force) {
          ctx.ui.notify(
            `${container.name} is running. Use --force to remove it, or stop it first.`,
            "warning",
          );
          return;
        }

        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Remove container?",
            `Remove ${container.name} (${container.id})?${container.status === "running" ? "\n⚠️  It will be force-removed." : ""}`,
          );
          if (!ok) {
            ctx.ui.notify("Removal cancelled", "info");
            return;
          }
        }

        const result = await removeContainer(
          pi,
          runtime,
          container.id,
          force || container.status === "running",
        );
        if (result.success) {
          ctx.ui.notify(`🗑️ Removed container ${container.name}`, "info");
        } else {
          ctx.ui.notify(`Failed: ${result.output}`, "error");
        }
        await updateWidget(pi, ctx, runtime, getRuntimeName());
        return;
      }

      // Not a container — try as image
      const image = await findImage(pi, runtime, target);
      if (image) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Remove image?",
            `Remove image ${image.repository}:${image.tag} (${image.id})?`,
          );
          if (!ok) {
            ctx.ui.notify("Removal cancelled", "info");
            return;
          }
        }

        const result = await removeImage(
          pi,
          runtime,
          `${image.repository}:${image.tag}`,
        );
        if (result.success) {
          ctx.ui.notify(
            `Removed image ${image.repository}:${image.tag}${result.freed ? " (" + result.freed + " freed)" : ""}`,
            "info",
          );
        } else {
          ctx.ui.notify(`Failed: ${result.output}`, "error");
        }
        return;
      }

      ctx.ui.notify(
        `No container or image found matching "${target}"`,
        "error",
      );
    },
  });

  // ── /docker:detect ─────────────────────────────────────
  pi.registerCommand("docker:detect", {
    description:
      "Re-detect the container runtime. Updates the widget silently.",
    handler: async (_args, ctx) => {
      if (refreshRuntime) {
        await refreshRuntime(ctx);
      }
    },
  });
}

// ── Helpers ──────────────────────────────────────────

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.substring(0, maxLen - 3) + "...";
}
