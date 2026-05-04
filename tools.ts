import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ContainerRuntime } from "./runtime";
import {
  listContainers,
  getContainerLogs,
  pruneContainers,
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
  pruneImages,
  pruneSystem,
} from "./runtime";

type ToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError?: boolean;
};

export function registerTools(
  pi: ExtensionAPI,
  getRuntime: () => ContainerRuntime,
  getRuntimeName: () => string,
): void {
  const rt = () => getRuntimeName() || "none";

  // ── container_ps ─────────────────────────────────────────
  pi.registerTool({
    name: "container_ps",
    label: "Container PS",
    description:
      "List containers from the detected runtime (docker/podman/nerdctl). Returns id, name, image, status, ports.",
    promptSnippet: "List containers using the detected container runtime",
    promptGuidelines: [
      "Use container_ps when asked to list or check containers",
      "Set all=true to include stopped containers, runningOnly=true for only running ones",
    ],
    parameters: Type.Object({
      all: Type.Optional(
        Type.Boolean({
          description: "Include stopped containers (default: false)",
        }),
      ),
      runningOnly: Type.Optional(
        Type.Boolean({
          description: "Show only running containers (default: false)",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { all?: boolean; runningOnly?: boolean },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime detected." }],
          details: { runtime: rt() },
        };
      }

      const containers = await listContainers(pi, runtime, params.all ?? false);
      const displayed = params.runningOnly
        ? containers.filter((c) => c.status === "running")
        : containers;

      if (displayed.length === 0) {
        return {
          content: [{ type: "text", text: "No containers found." }],
          details: { runtime: rt(), count: 0 },
        };
      }

      const rows = displayed.map(
        (c) => `${c.id}\t${c.name}\t${c.image}\t${c.status}\t${c.ports || "—"}`,
      );
      const header = "ID\tNAME\tIMAGE\tSTATUS\tPORTS";
      return {
        content: [
          {
            type: "text",
            text: `Runtime: ${rt()}\n\n${[header, ...rows].join("\n")}`,
          },
        ],
        details: {
          runtime: rt(),
          count: displayed.length,
          total: containers.length,
        },
      };
    },
  });

  // ── container_logs ───────────────────────────────────────
  pi.registerTool({
    name: "container_logs",
    label: "Container Logs",
    description: "Get logs from a container by name or ID.",
    promptSnippet: "Fetch container logs by name or ID",
    promptGuidelines: [
      "Use container_logs when asked to check container logs or debug a container",
      "Provide the container name or ID as seen in container_ps output",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID" }),
      lines: Type.Optional(
        Type.Number({ description: "Number of lines to fetch (default: 50)" }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string; lines?: number },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            {
              type: "text",
              text: `Container "${params.id}" not found. Use container_ps to see available containers.`,
            },
          ],
          details: { runtime: rt(), searchId: params.id, found: false },
        };
      }

      const logOutput = await getContainerLogs(
        pi,
        runtime,
        container.id,
        params.lines ?? 50,
      );
      return {
        content: [
          {
            type: "text",
            text: `Logs for ${container.name} (${container.id}):\n\n${logOutput}`,
          },
        ],
        details: {
          runtime: rt(),
          container: container.name,
          containerId: container.id,
          lines: params.lines ?? 50,
        },
      };
    },
  });

  // ── container_prune ─────────────────────────────────────
  pi.registerTool({
    name: "container_prune",
    label: "Container Prune",
    description: "Remove all stopped containers.",
    promptSnippet: "Remove stopped containers to free up disk space",
    promptGuidelines: [
      "Use container_prune when asked to clean up containers or free disk space",
      "This only removes stopped containers, never running ones",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const result = await pruneContainers(pi, runtime);
      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Pruned stopped containers. Freed: ${result.freed}`,
            },
          ],
          details: { runtime: rt(), freed: result.freed, success: true },
        };
      }

      return {
        content: [{ type: "text", text: `Prune failed: ${result.output}` }],
        details: { runtime: rt(), success: false, output: result.output },
        isError: true,
      };
    },
  });

  // ── container_prune_images ─────────────────────────────
  pi.registerTool({
    name: "container_prune_images",
    label: "Container Prune Images",
    description: "Remove all unused container images.",
    promptSnippet: "Remove unused container images to free disk space",
    promptGuidelines: [
      "Use container_prune_images when asked to remove old images or free disk space",
      "This only removes unused images, never running containers",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }
      const result = await pruneImages(pi, runtime);
      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Pruned unused images. Freed: ${result.freed}`,
            },
          ],
          details: { runtime: rt(), freed: result.freed, success: true },
        };
      }
      return {
        content: [{ type: "text", text: `Prune failed: ${result.output}` }],
        details: { runtime: rt(), error: result.output },
        isError: true,
      };
    },
  });

  // ── container_prune_system ────────────────────────────
  pi.registerTool({
    name: "container_prune_system",
    label: "Container System Prune",
    description: "Remove all stopped containers AND unused images.",
    promptSnippet: "Clean everything — stopped containers and unused images",
    promptGuidelines: [
      "Use container_prune_system when asked to clean everything or do a deep clean",
      "This removes both stopped containers and unused images",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }
      const result = await pruneSystem(pi, runtime);
      if (result.success) {
        return {
          content: [
            { type: "text", text: `System pruned! Freed: ${result.freed}` },
          ],
          details: { runtime: rt(), freed: result.freed, success: true },
        };
      }
      return {
        content: [{ type: "text", text: `Prune failed: ${result.output}` }],
        details: { runtime: rt(), error: result.output },
        isError: true,
      };
    },
  });

  // ── container_images ────────────────────────────────────
  pi.registerTool({
    name: "container_images",
    label: "Container Images",
    description: "List container images.",
    promptSnippet: "List pulled container images",
    parameters: Type.Object({}),
    async execute(): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const images = await listImages(pi, runtime);
      if (images.length === 0) {
        return {
          content: [{ type: "text", text: "No images found." }],
          details: { runtime: rt(), count: 0 },
        };
      }

      const rows = images.map(
        (img) =>
          `${img.id}\t${img.repository}:${img.tag}\t${img.size}\t${img.created}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Images (${images.length}):\n\nID\tREPOSITORY:TAG\tSIZE\tCREATED\n${rows.join("\n")}`,
          },
        ],
        details: { runtime: rt(), count: images.length },
      };
    },
  });

  // ── container_stop ──────────────────────────────────────
  pi.registerTool({
    name: "container_stop",
    label: "Container Stop",
    description: "Stop a running container by name or ID.",
    promptSnippet: "Stop a running container",
    promptGuidelines: [
      "Use container_stop when asked to stop a container",
      "Provide the container name or ID",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID to stop" }),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            { type: "text", text: `Container "${params.id}" not found.` },
          ],
          details: { runtime: rt(), found: false },
        };
      }
      if (container.status !== "running") {
        return {
          content: [
            { type: "text", text: `${container.name} is already stopped.` },
          ],
          details: {
            runtime: rt(),
            container: container.name,
            status: container.status,
          },
        };
      }

      const result = await stopContainer(pi, runtime, container.id);
      if (result.success) {
        return {
          content: [{ type: "text", text: `Stopped ${container.name}.` }],
          details: { runtime: rt(), container: container.name, success: true },
        };
      }
      return {
        content: [{ type: "text", text: `Failed to stop: ${result.output}` }],
        details: {
          runtime: rt(),
          container: container.name,
          error: result.output,
        },
        isError: true,
      };
    },
  });

  // ── container_start ─────────────────────────────────────
  pi.registerTool({
    name: "container_start",
    label: "Container Start",
    description: "Start a stopped container by name or ID.",
    promptSnippet: "Start a stopped container",
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID to start" }),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            { type: "text", text: `Container "${params.id}" not found.` },
          ],
          details: { runtime: rt(), found: false },
        };
      }
      if (container.status === "running") {
        return {
          content: [
            { type: "text", text: `${container.name} is already running.` },
          ],
          details: {
            runtime: rt(),
            container: container.name,
            status: container.status,
          },
        };
      }

      const result = await startContainer(pi, runtime, container.id);
      if (result.success) {
        return {
          content: [{ type: "text", text: `Started ${container.name}.` }],
          details: { runtime: rt(), container: container.name, success: true },
        };
      }
      return {
        content: [{ type: "text", text: `Failed to start: ${result.output}` }],
        details: {
          runtime: rt(),
          container: container.name,
          error: result.output,
        },
        isError: true,
      };
    },
  });

  // ── container_restart ───────────────────────────────────
  pi.registerTool({
    name: "container_restart",
    label: "Container Restart",
    description: "Restart a container by name or ID.",
    promptSnippet: "Restart a container",
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID to restart" }),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            { type: "text", text: `Container "${params.id}" not found.` },
          ],
          details: { runtime: rt(), found: false },
        };
      }

      const result = await restartContainer(pi, runtime, container.id);
      if (result.success) {
        return {
          content: [{ type: "text", text: `Restarted ${container.name}.` }],
          details: { runtime: rt(), container: container.name, success: true },
        };
      }
      return {
        content: [
          { type: "text", text: `Failed to restart: ${result.output}` },
        ],
        details: {
          runtime: rt(),
          container: container.name,
          error: result.output,
        },
        isError: true,
      };
    },
  });

  // ── container_stats ─────────────────────────────────────
  pi.registerTool({
    name: "container_stats",
    label: "Container Stats",
    description:
      "Show live resource usage (CPU, memory, network) for running containers.",
    promptSnippet: "View container resource usage",
    parameters: Type.Object({}),
    async execute(): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const stats = await getContainerStats(pi, runtime);
      if (stats.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No running containers or stats unavailable.",
            },
          ],
          details: { runtime: rt(), count: 0 },
        };
      }

      const rows = stats.map(
        (s) =>
          `${s.name}\t${s.cpuPercent}\t${s.memoryUsage}\t${s.memoryPercent}\t${s.netIO}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Container Stats:\n\nNAME\tCPU %\tMEM USAGE\tMEM %\tNET IO\n${rows.join("\n")}`,
          },
        ],
        details: { runtime: rt(), count: stats.length },
      };
    },
  });

  // ── container_inspect ───────────────────────────────────
  pi.registerTool({
    name: "container_inspect",
    label: "Container Inspect",
    description: "Get detailed configuration info about a container.",
    promptSnippet: "Inspect a container's details",
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID to inspect" }),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            { type: "text", text: `Container "${params.id}" not found.` },
          ],
          details: { runtime: rt(), found: false },
        };
      }

      const result = await inspectContainer(pi, runtime, container.id);
      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Inspect ${container.name}:\n\n${result.data}`,
            },
          ],
          details: { runtime: rt(), container: container.name },
        };
      }
      return {
        content: [{ type: "text", text: `Inspect failed: ${result.data}` }],
        details: {
          runtime: rt(),
          container: container.name,
          error: result.data,
        },
        isError: true,
      };
    },
  });

  // ── container_rm ───────────────────────────────────────
  pi.registerTool({
    name: "container_rm",
    label: "Container Remove",
    description:
      "Remove a container or image by name or ID. For running containers, use force=true.",
    promptSnippet: "Remove a container or image",
    promptGuidelines: [
      "Use container_rm when asked to remove a container or image",
      "Set force=true to remove a running container",
      "Provide the name or ID as seen in container_ps or container_images output",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Container or image name/ID to remove" }),
      force: Type.Optional(
        Type.Boolean({
          description: "Force remove running container (default: false)",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string; force?: boolean },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      // Try as container first
      const container = await findContainer(pi, runtime, params.id);
      if (container) {
        if (container.status === "running" && !params.force) {
          return {
            content: [
              {
                type: "text",
                text: `${container.name} is running. Use force=true to remove it, or stop it first.`,
              },
            ],
            details: {
              runtime: rt(),
              container: container.name,
              status: container.status,
              hint: "use force=true",
            },
          };
        }

        const result = await removeContainer(
          pi,
          runtime,
          container.id,
          params.force || container.status === "running",
        );
        if (result.success) {
          return {
            content: [
              { type: "text", text: `Removed container ${container.name}.` },
            ],
            details: {
              runtime: rt(),
              container: container.name,
              removed: true,
            },
          };
        }
        return {
          content: [
            { type: "text", text: `Failed to remove: ${result.output}` },
          ],
          details: { runtime: rt(), error: result.output },
          isError: true,
        };
      }

      // Not a container — try as image
      const image = await findImage(pi, runtime, params.id);
      if (image) {
        const result = await removeImage(
          pi,
          runtime,
          `${image.repository}:${image.tag}`,
        );
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Removed image ${image.repository}:${image.tag}${result.freed ? " (" + result.freed + " freed)" : ""}.`,
              },
            ],
            details: {
              runtime: rt(),
              image: `${image.repository}:${image.tag}`,
              removed: true,
            },
          };
        }
        return {
          content: [
            { type: "text", text: `Failed to remove image: ${result.output}` },
          ],
          details: { runtime: rt(), error: result.output },
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `No container or image found matching "${params.id}".`,
          },
        ],
        details: { runtime: rt(), found: false },
      };
    },
  });

  // ── container_top ───────────────────────────────────────
  pi.registerTool({
    name: "container_top",
    label: "Container Top",
    description: "Show running processes inside a container.",
    promptSnippet: "View processes inside a container",
    parameters: Type.Object({
      id: Type.String({ description: "Container name or ID" }),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string },
    ): Promise<ToolResult> {
      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text", text: "No container runtime available." }],
          details: { runtime: rt() },
        };
      }

      const container = await findContainer(pi, runtime, params.id);
      if (!container) {
        return {
          content: [
            { type: "text", text: `Container "${params.id}" not found.` },
          ],
          details: { runtime: rt(), found: false },
        };
      }
      if (container.status !== "running") {
        return {
          content: [
            {
              type: "text",
              text: `${container.name} is not running. Start it first.`,
            },
          ],
          details: {
            runtime: rt(),
            container: container.name,
            status: container.status,
          },
        };
      }

      const result = await getContainerTop(pi, runtime, container.id);
      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Processes in ${container.name}:\n\n${result.output}`,
            },
          ],
          details: { runtime: rt(), container: container.name },
        };
      }
      return {
        content: [{ type: "text", text: `Failed: ${result.output}` }],
        details: {
          runtime: rt(),
          container: container.name,
          error: result.output,
        },
        isError: true,
      };
    },
  });
}
