/**
 * Non-destructive editing of a project's `.mcp.json`.
 *
 * This file belongs to the user, not to us: it routinely holds several unrelated
 * MCP servers, and clobbering it would be a genuinely bad first impression for a
 * tool whose whole job is a one-command setup. So the rule is patch exactly one
 * key — `mcpServers.finpilot` — and leave every other byte of intent alone.
 *
 * The merge is deliberately kept as a pure string→string function so it can be
 * tested exhaustively without touching a filesystem.
 */

export const SERVER_KEY = "finpilot"

export interface McpServerEntry {
  type: "http"
  url: string
  headers: Record<string, string>
}

export function buildServerEntry(mcpUrl: string, token: string): McpServerEntry {
  return {
    type: "http",
    url: mcpUrl,
    headers: { Authorization: `Bearer ${token}` },
  }
}

export interface MergeResult {
  content: string
  /** True when a `finpilot` entry was already present and got replaced. */
  replaced: boolean
  /** Names of the other servers left untouched — surfaced so the user sees them. */
  preserved: string[]
}

/**
 * Merge our server entry into existing `.mcp.json` text.
 *
 * `existing` may be null (no file), empty, or malformed. Malformed is the
 * interesting case: rather than silently overwrite something the user hand-wrote
 * and broke, we throw, so the caller can tell them to fix it. Losing an unrelated
 * server config is worse than failing loudly.
 */
export function mergeMcpJson(
  existing: string | null,
  entry: McpServerEntry
): MergeResult {
  let root: Record<string, unknown> = {}

  const trimmed = existing?.trim()
  if (trimmed) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(
        ".mcp.json exists but is not valid JSON. Fix or remove it, then run this again."
      )
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(".mcp.json must contain a JSON object.")
    }
    root = parsed as Record<string, unknown>
  }

  const rawServers = root.mcpServers
  const servers: Record<string, unknown> =
    rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)
      ? { ...(rawServers as Record<string, unknown>) }
      : {}

  const replaced = Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)
  const preserved = Object.keys(servers).filter((k) => k !== SERVER_KEY)

  servers[SERVER_KEY] = entry

  const next = { ...root, mcpServers: servers }
  return {
    content: `${JSON.stringify(next, null, 2)}\n`,
    replaced,
    preserved,
  }
}

/**
 * Whether `.mcp.json` looks ignored by git.
 *
 * We are about to write a bearer credential into a file in their repo. If it is
 * tracked, saying so is the difference between a convenience and a leaked
 * token in a public commit.
 */
export function isIgnoredByGit(gitignoreContent: string | null): boolean {
  if (!gitignoreContent) return false
  return gitignoreContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => {
      const normalized = line.replace(/^\/+/, "").replace(/\/+$/, "")
      return normalized === ".mcp.json" || normalized === "*.json"
    })
}
