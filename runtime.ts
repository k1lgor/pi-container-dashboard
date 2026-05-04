import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type ContainerRuntime = "docker" | "podman" | "nerdctl" | null;

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: "running" | "exited" | "paused" | "created";
  ports: string;
  created: string;
  size?: string;
}

export interface RuntimeState {
  runtime: ContainerRuntime;
  version: string;
  available: boolean;
}

const RUNTIMES = ["docker", "podman", "nerdctl"] as const;

/**
 * Try each container runtime and return the first one that works.
 */
export async function detectRuntime(pi: ExtensionAPI): Promise<RuntimeState> {
  for (const rt of RUNTIMES) {
    try {
      // Use `ps` as the detection command — works on both Docker and Podman
      const result = await pi.exec(rt, ["ps"], { timeout: 5000 });
      if (result.code === 0) {
        // Get version
        let version = "?";
        try {
          const verResult = await pi.exec(
            rt,
            ["version", "--format", "{{.Client.Version}}"],
            {
              timeout: 5000,
            },
          );
          if (verResult.code === 0 && verResult.stdout?.trim()) {
            version = verResult.stdout.trim();
          }
        } catch {
          // fallback
        }
        return { runtime: rt, version, available: true };
      }
    } catch {
      // Runtime not found or not available, try next
    }
  }
  return { runtime: null, version: "", available: false };
}

interface PodmanPort {
  host_ip?: string;
  container_port?: number;
  host_port?: number;
  protocol?: string;
}

interface DockerJson {
  ID?: string;
  Names?: string;
  Image?: string;
  Status?: string;
  Ports?: string;
  CreatedAt?: string;
  Size?: string;
  State?: string;
  [key: string]: unknown;
}

interface PodmanJson {
  Id?: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: PodmanPort[] | null;
  Created?: string;
  CreatedAt?: string;
  Size?: number | null;
  [key: string]: unknown;
}

type ContainerJson = DockerJson | PodmanJson;

/**
 * Parse a container JSON line from either Docker or Podman format.
 */
function parseContainerJson(raw: ContainerJson): ContainerInfo | null {
  // Docker uses ID, Names (string), CreatedAt, Ports (string), State
  // Podman uses Id, Names (array), Created (timestamp), Ports (array), State
  try {
    const id = String(raw.ID || (raw as PodmanJson).Id || "?").substring(0, 12);

    // Names: Docker = string, Podman = string[]
    let name: string;
    if (typeof raw.Names === "string") {
      name = raw.Names.replace(/^\//, ""); // Docker prefixes with /
    } else if (Array.isArray((raw as PodmanJson).Names)) {
      name = (raw as PodmanJson).Names![0] || "?";
    } else {
      name = "?";
    }

    const image = (raw.Image as string | undefined) || "?";

    // Status: Docker uses "Status" + "State", Podman uses "State"
    let statusStr: string;
    const dockerStatus = raw.Status as string | undefined;
    const dockerState = raw.State as string | undefined;
    if (typeof dockerStatus === "string" && dockerStatus.length > 0) {
      statusStr = dockerStatus;
    } else if (typeof dockerState === "string") {
      statusStr = dockerState;
    } else {
      statusStr = "";
    }

    const status = normalizeStatus(statusStr);

    // Ports: Docker = string like "0.0.0.0:8080->80/tcp"
    // Podman = array of objects
    let ports = "";
    if (typeof raw.Ports === "string") {
      ports = raw.Ports;
    } else if (Array.isArray((raw as PodmanJson).Ports)) {
      ports = (raw as PodmanJson)
        .Ports!.map((p) => {
          if (p.host_port && p.container_port) {
            return `${p.host_ip || "0.0.0.0"}:${p.host_port}->${p.container_port}/${p.protocol || "tcp"}`;
          }
          return "";
        })
        .filter(Boolean)
        .join(", ");
    }

    // Created: Docker uses "CreatedAt" (string), Podman uses "Created" (ISO string)
    const created =
      (raw.CreatedAt as string | undefined) ||
      (raw as PodmanJson).Created ||
      "";

    // Size: Docker = string like "1.2MB", Podman = number (bytes) or null
    let size: string | undefined;
    const dockerSize = raw.Size as string | undefined;
    if (typeof dockerSize === "string") {
      size = dockerSize;
    } else if (typeof (raw as PodmanJson).Size === "number") {
      const bytes = (raw as PodmanJson).Size!;
      if (bytes > 0) {
        size =
          bytes > 1024 * 1024
            ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
            : `${(bytes / 1024).toFixed(0)}KB`;
      }
    }

    return { id, name, image, status, ports, created, size };
  } catch {
    return null;
  }
}

/**
 * List containers using the detected runtime.
 */
export async function listContainers(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  all = false,
): Promise<ContainerInfo[]> {
  if (!runtime) return [];

  try {
    const args = ["ps", "--format", "{{json .}}"];
    if (all) args.push("-a");
    const result = await pi.exec(runtime, args, { timeout: 10000 });
    if (result.code !== 0 || !result.stdout?.trim()) return [];

    const lines = result.stdout.trim().split("\n");
    return lines
      .map((line) => {
        try {
          return parseContainerJson(JSON.parse(line) as ContainerJson);
        } catch {
          return null;
        }
      })
      .filter((c): c is ContainerInfo => c !== null);
  } catch {
    return [];
  }
}

/**
 * Normalize docker/podman status string to our enum.
 */
function normalizeStatus(status: string): ContainerInfo["status"] {
  const s = status.toLowerCase();
  if (s.startsWith("up") || s.includes("running")) return "running";
  if (s.startsWith("exited") || s.includes("exit")) return "exited";
  if (s.startsWith("paused") || s.includes("pause")) return "paused";
  if (s.startsWith("created")) return "created";
  return "exited";
}

/**
 * Get logs from a container.
 */
export async function getContainerLogs(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
  lines = 50,
): Promise<string> {
  if (!runtime) return "No container runtime available.";

  try {
    const result = await pi.exec(
      runtime,
      ["logs", "--tail", String(lines), id],
      {
        timeout: 10000,
      },
    );
    if (result.code !== 0) {
      return (
        result.stderr?.trim() || `Failed to get logs (exit code ${result.code})`
      );
    }
    return result.stdout || "(empty log)";
  } catch (err) {
    return `Error getting logs: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Prune stopped containers.
 */
export async function pruneContainers(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<{ success: boolean; freed: string; output: string }> {
  if (!runtime) {
    return {
      success: false,
      freed: "",
      output: "No container runtime available.",
    };
  }

  try {
    const result = await pi.exec(runtime, ["container", "prune", "-f"], {
      timeout: 30000,
    });
    const output = result.stdout || result.stderr || "";
    const freed = extractFreedSpace(output);
    return {
      success: result.code === 0,
      freed,
      output,
    };
  } catch (err) {
    return {
      success: false,
      freed: "",
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Try to extract "Total reclaimed space: X" from prune output.
 */
function extractFreedSpace(output: string): string {
  // Docker: "Total reclaimed space: 63.6MB"
  const dockerMatch = output.match(/Total reclaimed space:\s*(.+)/i);
  if (dockerMatch) return dockerMatch[1].trim();

  // Podman container prune: "Deleted Files: 4.672 MB"
  const podmanFiles = output.match(/Deleted Files:\s*(.+)/i);
  if (podmanFiles) return podmanFiles[1].trim();

  // Generic: "Space reclaimed: X" or "Reclaimed: X"
  const genericMatch = output.match(/(?:Space|Disk)\s+reclaimed:\s*(.+)/i);
  if (genericMatch) return genericMatch[1].trim();

  // Podman image rmi: "Deleted: <id>" but no space info —
  // look for any size pattern like "8.74 MB", "63.6MB", "1.2GB" in the output
  const sizeMatch = output.match(/(\d+[\.\,]?\d*)\s*(MB|MiB|KB|KiB|GB|GiB)/i);
  if (sizeMatch) {
    return `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
  }

  // Fallback: count deleted items if we have "Deleted:" or "deleted:" lines
  const deletedLines = output.match(/^[ \t]*[Dd]eleted:/gm);
  if (deletedLines && deletedLines.length > 0) {
    return `${deletedLines.length} item(s) deleted (size unknown)`;
  }

  return "unknown";
}

/**
 * Prune dangling/unused images.
 */
/**
 * Parse a size string like "63.6MB", "4.5 MB", "8.74 MB", "1.2GB" into bytes.
 */
function parseSizeBytes(size: string): number {
  const match = size.match(/([\d.]+)\s*(MB|MiB|KB|KiB|GB|GiB)/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "kb": case "kib": return num * 1024;
    case "mb": case "mib": return num * 1024 * 1024;
    case "gb": case "gib": return num * 1024 * 1024 * 1024;
    default: return num;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + "GB";
}

async function sumImageBytes(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<number> {
  const images = await listImages(pi, runtime);
  return images.reduce((acc, img) => acc + parseSizeBytes(img.size), 0);
}

export async function pruneImages(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<{ success: boolean; freed: string; output: string }> {
  if (!runtime) {
    return { success: false, freed: "", output: "No container runtime available." };
  }
  try {
    const beforeBytes = await sumImageBytes(pi, runtime);
    const result = await pi.exec(runtime, ["image", "prune", "-f", "--all"], { timeout: 60000 });
    const afterBytes = await sumImageBytes(pi, runtime);
    const freedBytes = beforeBytes - afterBytes;
    const freed = freedBytes > 0
      ? formatBytes(freedBytes)
      : extractFreedSpace(result.stdout || result.stderr || "");
    return { success: result.code === 0, freed, output: result.stdout || result.stderr || "" };
  } catch (err) {
    return { success: false, freed: "", output: "Error: " + (err instanceof Error ? err.message : String(err)) };
  }
}

export async function pruneSystem(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<{ success: boolean; freed: string; output: string }> {
  if (!runtime) {
    return { success: false, freed: "", output: "No container runtime available." };
  }
  try {
    const beforeBytes = await sumImageBytes(pi, runtime);
    const result = await pi.exec(runtime, ["system", "prune", "-f", "--all"], { timeout: 60000 });
    const afterBytes = await sumImageBytes(pi, runtime);
    const freedBytes = beforeBytes - afterBytes;
    const imageFreed = freedBytes > 0 ? formatBytes(freedBytes) : "";
    const cliFreed = extractFreedSpace(result.stdout || result.stderr || "");
    const freed = cliFreed !== "unknown"
      ? cliFreed
      : imageFreed
        ? imageFreed + " (images only)"
        : "unknown";
    return { success: result.code === 0, freed, output: result.stdout || result.stderr || "" };
  } catch (err) {
    return { success: false, freed: "", output: "Error: " + (err instanceof Error ? err.message : String(err)) };
  }
}

export async function findContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  search: string,
): Promise<ContainerInfo | null> {
  const containers = await listContainers(pi, runtime, true);
  return (
    containers.find((c) => c.id.startsWith(search) || c.name === search) || null
  );
}

// ── New Runtime Operations ──────────────────────────────

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

/**
 * List images.
 */
export async function listImages(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<ImageInfo[]> {
  if (!runtime) return [];
  try {
    const result = await pi.exec(
      runtime,
      ["images", "--format", "{{json .}}"],
      {
        timeout: 10000,
      },
    );
    if (result.code !== 0 || !result.stdout?.trim()) return [];

    const lines = result.stdout.trim().split("\n");
    return lines
      .map((line) => {
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          // Docker: Repository, Tag, ID, Size (string), CreatedAt
          // Podman: repository, tag, Id, Size (number), Created (unix ts)
          const repo = String(raw.repository || raw.Repository || "<none>");
          const tag = String(raw.tag || raw.Tag || "<none>");
          const id = String(raw.Id || raw.ID || "?").substring(0, 12);
          const createdAt = String(raw.CreatedAt || raw.Created || "?");

          // Size: Docker = string, Podman = number (bytes)
          let size: string;
          if (typeof raw.Size === "number") {
            size =
              raw.Size > 1024 * 1024
                ? `${(raw.Size / (1024 * 1024)).toFixed(1)}MB`
                : `${(raw.Size / 1024).toFixed(0)}KB`;
          } else {
            size = String(raw.Size || "?");
          }

          return { id, repository: repo, tag, size, created: createdAt };
        } catch {
          return null;
        }
      })
      .filter((img): img is ImageInfo => img !== null);
  } catch {
    return [];
  }
}

/**
 * Stop a container.
 */
export async function stopContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
  timeout?: number,
): Promise<{ success: boolean; output: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available." };
  try {
    const args = ["stop"];
    if (timeout) args.push("-t", String(timeout));
    args.push(id);
    const result = await pi.exec(runtime, args, { timeout: 30000 });
    return {
      success: result.code === 0,
      output: result.stdout?.trim() || result.stderr?.trim() || "",
    };
  } catch (err) {
    return {
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Start a container.
 */
export async function startContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
): Promise<{ success: boolean; output: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available." };
  try {
    const result = await pi.exec(runtime, ["start", id], { timeout: 30000 });
    return {
      success: result.code === 0,
      output: result.stdout?.trim() || result.stderr?.trim() || "",
    };
  } catch (err) {
    return {
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Restart a container.
 */
export async function restartContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
  timeout?: number,
): Promise<{ success: boolean; output: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available." };
  try {
    const args = ["restart"];
    if (timeout) args.push("-t", String(timeout));
    args.push(id);
    const result = await pi.exec(runtime, args, { timeout: 30000 });
    return {
      success: result.code === 0,
      output: result.stdout?.trim() || result.stderr?.trim() || "",
    };
  } catch (err) {
    return {
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get basic resource stats for running containers (CPU, memory).
 */
export interface ContainerStat {
  id: string;
  name: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  memoryPercent: string;
  netIO: string;
}

export async function getContainerStats(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
): Promise<ContainerStat[]> {
  if (!runtime) return [];
  try {
    // Docker: --format "{{json .}}" yields one JSON line per container
    // Podman: --format json yields a JSON array
    // Try ndjson format first (Docker), fallback to array format (Podman)
    const result = await pi.exec(
      runtime,
      ["stats", "--no-stream", "--format", "{{json .}}"],
      {
        timeout: 15000,
      },
    );

    const stdout = result.stdout?.trim();
    if (result.code !== 0 || !stdout) return [];

    // Try parsing as a JSON array (Podman format)
    if (stdout.startsWith("[") || stdout.startsWith("[ ")) {
      try {
        const arr = JSON.parse(stdout) as Array<Record<string, unknown>>;
        return arr
          .map((raw) => parseStatRow(raw))
          .filter((s): s is ContainerStat => s !== null);
      } catch {
        return [];
      }
    }

    // Otherwise parse as newline-delimited JSON (Docker format)
    const lines = stdout.split("\n");
    return lines
      .map((line) => {
        try {
          return parseStatRow(JSON.parse(line) as Record<string, unknown>);
        } catch {
          return null;
        }
      })
      .filter((s): s is ContainerStat => s !== null);
  } catch {
    return [];
  }
}

function parseStatRow(raw: Record<string, unknown>): ContainerStat | null {
  try {
    const id = String(raw.ID || raw.Id || "?").substring(0, 12);
    const name = String(raw.Name || raw.Names || "?");
    return {
      id,
      name,
      cpuPercent: String(raw.CPUPerc || raw.CPUPercent || "?"),
      memoryUsage: String(raw.MemUsage || "?"),
      memoryLimit: String(raw.MemLimit || "?"),
      memoryPercent: String(raw.MemPerc || raw.MemPercent || "?"),
      netIO: String(raw.NetIO || "?"),
    };
  } catch {
    return null;
  }
}

/**
 * Inspect a container (returns JSON string).
 */
export async function inspectContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
): Promise<{ success: boolean; data: string }> {
  if (!runtime)
    return { success: false, data: "No container runtime available." };
  try {
    const result = await pi.exec(runtime, ["inspect", id], { timeout: 10000 });
    if (result.code !== 0) {
      return {
        success: false,
        data: result.stderr?.trim() || `Exit code ${result.code}`,
      };
    }
    return { success: true, data: result.stdout || "{}" };
  } catch (err) {
    return {
      success: false,
      data: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get processes running inside a container.
 */
export async function getContainerTop(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
): Promise<{ success: boolean; output: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available." };
  try {
    const result = await pi.exec(runtime, ["top", id], { timeout: 10000 });
    return {
      success: result.code === 0,
      output:
        result.stdout?.trim() || result.stderr?.trim() || "(no processes)",
    };
  } catch (err) {
    return {
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Remove Operations ────────────────────────────────────

/**
 * Remove a container by ID or name.
 */
export async function removeContainer(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
  force = false,
): Promise<{ success: boolean; output: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available." };
  try {
    const args = ["rm"];
    if (force) args.push("-f");
    args.push(id);
    const result = await pi.exec(runtime, args, { timeout: 15000 });
    return {
      success: result.code === 0,
      output: result.stdout?.trim() || result.stderr?.trim() || "",
    };
  } catch (err) {
    return {
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Remove an image by ID or name.
 */
export async function removeImage(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  id: string,
): Promise<{ success: boolean; output: string; freed: string }> {
  if (!runtime)
    return { success: false, output: "No container runtime available.", freed: "" };
  try {
    // Get image size before removal
    const images = await listImages(pi, runtime);
    const image = images.find(
      (img) =>
        img.id.startsWith(id) ||
        img.repository + ":" + img.tag === id ||
        img.repository === id ||
        img.id === id,
    );
    let freed = "";
    if (image) {
      const match = image.size.match(/([\d.]+)\s*(MB|MiB|KB|KiB|GB|GiB)/i);
      if (match) freed = image.size;
    }

    const result = await pi.exec(runtime, ["rmi", id], { timeout: 30000 });

    // Fallback to CLI output if we couldn't parse the size
    if (!freed) {
      const output = result.stdout || result.stderr || "";
      const sizeMatch = output.match(/([\d.]+)\s*(MB|MiB|KB|KiB|GB|GiB)/i);
      if (sizeMatch) freed = sizeMatch[1] + " " + sizeMatch[2].toUpperCase();
    }

    return {
      success: result.code === 0,
      output: result.stdout?.trim() || result.stderr?.trim() || "",
      freed,
    };
  } catch (err) {
    return {
      success: false,
      output: "Error: " + (err instanceof Error ? err.message : String(err)),
      freed: "",
    };
  }
}

/**
 * Find an image by ID prefix or repo:tag.
 */
export async function findImage(
  pi: ExtensionAPI,
  runtime: ContainerRuntime,
  search: string,
): Promise<{ id: string; repository: string; tag: string } | null> {
  const images = await listImages(pi, runtime);
  return (
    images.find(
      (img) =>
        img.id.startsWith(search) ||
        `${img.repository}:${img.tag}` === search ||
        img.repository === search,
    ) || null
  );
}
