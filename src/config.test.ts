import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { clearConfig, configPath, readConfig, writeConfig } from "./config"

/**
 * The permission assertions are the point of this file. The config holds a
 * bearer token that reads someone's entire financial position; on a shared
 * machine, default permissions would expose it to every other account.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "finpilot-cfg-"))
  process.env.FINPILOT_CONFIG_DIR = dir
})

afterEach(async () => {
  delete process.env.FINPILOT_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

const sample = {
  apiUrl: "https://finpilot.test",
  token: "fp_pat_abc_def",
  mcpUrl: "https://finpilot.test/api/mcp",
  scopes: ["portfolios:read"],
  createdAt: "2026-08-09T00:00:00.000Z",
}

describe("config store", () => {
  it("round-trips what it wrote", async () => {
    await writeConfig(sample)
    expect(await readConfig()).toEqual(sample)
  })

  it("writes the file 0600", async () => {
    const file = await writeConfig(sample)
    const mode = (await stat(file)).mode & 0o777
    expect(mode.toString(8)).toBe("600")
  })

  it("re-asserts 0600 when overwriting an existing file", async () => {
    // writeFile's `mode` applies only on creation, so a second login must
    // actively restore the bits rather than inherit whatever was there.
    await writeConfig(sample)
    await writeConfig({ ...sample, token: "fp_pat_new_one" })
    const mode = (await stat(configPath())).mode & 0o777
    expect(mode.toString(8)).toBe("600")
  })

  it("creates the directory 0700", async () => {
    await writeConfig(sample)
    const mode = (await stat(path.dirname(configPath()))).mode & 0o777
    expect(mode.toString(8)).toBe("700")
  })

  it("returns null when nothing is saved", async () => {
    expect(await readConfig()).toBeNull()
  })

  it("returns null for corrupt JSON rather than throwing", async () => {
    const { writeFile } = await import("node:fs/promises")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir, { recursive: true })
    await writeFile(configPath(), "{ broken")
    expect(await readConfig()).toBeNull()
  })

  it("treats a file with no token as no credential", async () => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(configPath(), JSON.stringify({ apiUrl: "https://x.test" }))
    expect(await readConfig()).toBeNull()
  })

  it("derives mcpUrl when an older config predates the field", async () => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(
      configPath(),
      JSON.stringify({ apiUrl: "https://x.test", token: "fp_pat_a_b" })
    )
    expect((await readConfig())?.mcpUrl).toBe("https://x.test/api/mcp")
  })

  it("clears the credential and reports whether there was one", async () => {
    await writeConfig(sample)
    expect(await clearConfig()).toBe(true)
    expect(await readConfig()).toBeNull()
    expect(await clearConfig()).toBe(false)
  })
})
