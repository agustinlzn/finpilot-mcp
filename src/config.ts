import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

/**
 * The credential store: `~/.finpilot/config.json`, mode 0600.
 *
 * This file holds a bearer token that reads someone's entire financial
 * position, so the permission bits are part of the contract, not a nicety —
 * on a shared machine a world-readable default would hand it to every other
 * account. Both the directory (0700) and the file (0600) are locked down, and
 * the mode is re-applied on every write because `writeFile` only honours the
 * `mode` option when it *creates* the file.
 */

export const DEFAULT_API_URL = "https://finpilot-market.vercel.app"

export interface StoredConfig {
  apiUrl: string
  token: string
  mcpUrl: string
  scopes: string[]
  /** ISO timestamp, for `status` to show how old the credential is. */
  createdAt: string
}

export function configDir(): string {
  return process.env.FINPILOT_CONFIG_DIR ?? path.join(homedir(), ".finpilot")
}

export function configPath(): string {
  return path.join(configDir(), "config.json")
}

export async function readConfig(): Promise<StoredConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<StoredConfig>
    if (!parsed.token || !parsed.apiUrl) return null
    return {
      apiUrl: parsed.apiUrl,
      token: parsed.token,
      mcpUrl: parsed.mcpUrl ?? `${parsed.apiUrl}/api/mcp`,
      scopes: parsed.scopes ?? [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    }
  } catch {
    // Missing or corrupt reads the same: no usable credential.
    return null
  }
}

export async function writeConfig(config: StoredConfig): Promise<string> {
  const dir = configDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = configPath()
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // writeFile's `mode` applies only on creation, so an existing file keeps
  // whatever bits it had. Re-assert them.
  await chmod(file, 0o600)
  return file
}

export async function clearConfig(): Promise<boolean> {
  try {
    await rm(configPath())
    return true
  } catch {
    return false
  }
}
