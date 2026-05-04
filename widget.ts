import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import type { ContainerRuntime, ContainerInfo } from "./runtime";
import { listContainers } from "./runtime";

const WIDGET_ID = "container-dashboard";

/**
 * Update the widget in pi's UI with current container info.
 */
export async function updateWidget(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  runtime: ContainerRuntime,
  runtimeName: string,
): Promise<void> {
  if (!ctx.hasUI) return;

  const containers = await listContainers(pi, runtime, false);
  const allContainers = await listContainers(pi, runtime, true);

  const runningCount = containers.length;
  const totalCount = allContainers.length;

  if (!runtime) {
    ctx.ui.setWidget(WIDGET_ID, ["🐳  No container runtime detected"]);
    return;
  }

  const runtimeIcon =
    runtime === "docker" ? "🐳" : runtime === "podman" ? "🟣" : "📦";
  const statusLine = `${runtimeIcon} ${runtimeName}  |  ▶ ${runningCount} running  |  ● ${totalCount} total`;

  ctx.ui.setWidget(WIDGET_ID, [statusLine]);
}

/**
 * Render a detailed table of containers (for /ps and tool output).
 */
export function renderContainerTable(
  containers: ContainerInfo[],
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  const statusColor = (status: string) => {
    switch (status) {
      case "running":
        return theme.fg("success", status);
      case "exited":
        return theme.fg("error", status);
      case "paused":
        return theme.fg("warning", status);
      default:
        return theme.fg("dim", status);
    }
  };

  lines.push("");
  lines.push(theme.fg("accent", " Containers "));
  lines.push("");

  if (containers.length === 0) {
    lines.push(theme.fg("dim", "  No containers found."));
    lines.push("");
    return lines;
  }

  // Header
  lines.push(
    theme.fg(
      "muted",
      formatRow("CONTAINER ID", "NAME", "IMAGE", "STATUS", "PORTS"),
    ),
  );
  lines.push(theme.fg("borderMuted", "─".repeat(Math.min(width, 80))));

  for (const c of containers) {
    const id = theme.fg("dim", c.id);
    const name = theme.fg("text", truncateMiddle(c.name, 20));
    const image = theme.fg("accent", truncateMiddle(c.image, 30));
    const status = statusColor(c.status);
    const ports =
      c.ports && c.ports !== "" && c.ports !== "—"
        ? theme.fg("muted", truncateMiddle(c.ports, 15))
        : theme.fg("dim", "—");
    lines.push(formatRow(id, name, image, status, ports));
  }

  lines.push("");
  return lines;
}

function formatRow(...parts: string[]): string {
  return "  " + parts.join("  ");
}

function truncateMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const half = Math.floor((maxLen - 3) / 2);
  return s.slice(0, half) + "..." + s.slice(s.length - half);
}
