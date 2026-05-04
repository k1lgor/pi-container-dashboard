import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { ContainerRuntime } from "./runtime";
import { detectRuntime } from "./runtime";
import { updateWidget } from "./widget";
import { registerCommands } from "./commands";
import { registerTools } from "./tools";

export default function (pi: ExtensionAPI) {
  let currentRuntime: ContainerRuntime = null;
  let currentRuntimeName = "none";

  const getRuntime = () => currentRuntime;
  const getRuntimeName = () => currentRuntimeName;

  async function refreshRuntime(ctx?: ExtensionContext): Promise<boolean> {
    const state = await detectRuntime(pi);
    currentRuntime = state.runtime;
    currentRuntimeName = formatRuntimeName(state.runtime, state.version);
    if (ctx?.hasUI) {
      await updateWidget(pi, ctx, currentRuntime, currentRuntimeName);
    }
    return state.available;
  }

  function formatRuntimeName(
    runtime: ContainerRuntime,
    version: string,
  ): string {
    if (!runtime) return "none";
    const name =
      runtime === "docker"
        ? "Docker"
        : runtime === "podman"
          ? "Podman"
          : "Nerdctl";
    return `${name} v${version || "?"}`;
  }

  // Session start: detect runtime and show widget
  pi.on("session_start", async (_event, ctx) => {
    const available = await refreshRuntime(ctx);
    if (ctx.hasUI && available) {
      ctx.ui.notify(
        `\u{1F433} Container Dashboard: ${currentRuntimeName}`,
        "info",
      );
    }
  });

  // Turn end: refresh widget (only if runtime already detected)
  pi.on("turn_end", async (_event, ctx) => {
    try {
      if (ctx.hasUI && currentRuntime) {
        await updateWidget(pi, ctx, currentRuntime, currentRuntimeName);
      }
    } catch {
      // ctx may be stale after session end in print mode
    }
  });

  // Permission gate: block dangerous container commands
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command || "";
    const dangerousPatterns: Array<{ pattern: RegExp; warning: string }> = [
      {
        pattern: /(?:docker|podman|nerdctl)\s+(?:rm|container\s+rm)\s+-f/i,
        warning: "Force-removing a running container",
      },
      {
        pattern: /(?:docker|podman|nerdctl)\s+system\s+prune\s+-a/i,
        warning: "Wiping ALL unused containers, images, and networks",
      },
      {
        pattern: /(?:docker|podman|nerdctl)\s+(?:rmi|image\s+rm)\s+-f/i,
        warning: "Force-removing a container image",
      },
      {
        pattern:
          /(?:docker|podman|nerdctl)\s+stop\s+\$\((?:docker|podman|nerdctl)\s+ps\s+-aq\)/i,
        warning: "Stopping ALL containers at once",
      },
    ];
    for (const { pattern, warning } of dangerousPatterns) {
      if (pattern.test(cmd)) {
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `${warning} blocked \u2014 requires interactive mode to confirm.`,
          };
        }
        const ok = await ctx.ui.confirm(
          "\u26A0\uFE0F  Dangerous Command",
          `${warning}\n\nCommand: ${cmd}\n\nAllow?`,
        );
        if (!ok) {
          return { block: true, reason: `${warning} blocked by user.` };
        }
        break;
      }
    }
  });

  // Register commands and tools
  registerCommands(pi, getRuntime, getRuntimeName, refreshRuntime);
  registerTools(pi, getRuntime, getRuntimeName);
}
