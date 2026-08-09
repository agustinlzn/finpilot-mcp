import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  buildServerEntry,
  isIgnoredByGit,
  mergeMcpJson,
  type MergeResult,
} from "./mcp-json"

/**
 * Write the `finpilot` MCP server entry into a project's `.mcp.json`.
 *
 * Split from the command layer so the risky part — reading, merging, and
 * writing someone else's config — is one testable function with an explicit
 * result, instead of prose interleaved with `console.log`.
 */

export interface InstallResult extends MergeResult {
  file: string
  /** True when `.mcp.json` does NOT appear to be gitignored. */
  commitRisk: boolean
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return null
  }
}

export async function installMcpEntry(opts: {
  cwd: string
  mcpUrl: string
  token: string
}): Promise<InstallResult> {
  const file = path.join(opts.cwd, ".mcp.json")

  const existing = await readIfPresent(file)
  const merged = mergeMcpJson(existing, buildServerEntry(opts.mcpUrl, opts.token))

  await writeFile(file, merged.content, { mode: 0o600 })
  // `writeFile`'s `mode` is honoured only when it CREATES the file, and this one
  // usually exists already — so the common path used to leave a bearer token in
  // whatever bits the file happened to have, typically 0644. Same re-assertion
  // `config.ts` makes for `~/.finpilot/config.json`.
  await chmod(file, 0o600)

  const gitignore = await readIfPresent(path.join(opts.cwd, ".gitignore"))

  return {
    ...merged,
    file,
    // We just wrote a bearer token into a file in their working tree. If git is
    // not already ignoring it, that is worth one loud line — a leaked token in
    // a public commit is a much worse outcome than a redundant warning.
    commitRisk: !isIgnoredByGit(gitignore),
  }
}
