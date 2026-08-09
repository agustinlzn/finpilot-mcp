import { describe, expect, it } from "vitest"

import {
  buildServerEntry,
  isIgnoredByGit,
  mergeMcpJson,
  SERVER_KEY,
} from "./mcp-json"

/**
 * `.mcp.json` belongs to the user and routinely holds several unrelated
 * servers. Every test here exists to prove we patch one key and destroy
 * nothing — losing someone's hand-written config would be a far worse first
 * impression than any error message.
 */

const entry = buildServerEntry("https://finpilot.app/api/mcp", "fp_pat_a_b")

const parse = (content: string) =>
  JSON.parse(content) as { mcpServers: Record<string, unknown> }

describe("mergeMcpJson", () => {
  it("creates the structure when there is no file yet", () => {
    const result = mergeMcpJson(null, entry)
    expect(parse(result.content).mcpServers[SERVER_KEY]).toEqual(entry)
    expect(result.replaced).toBe(false)
    expect(result.preserved).toEqual([])
  })

  it("treats an empty or whitespace-only file as absent", () => {
    expect(parse(mergeMcpJson("", entry).content).mcpServers[SERVER_KEY]).toEqual(entry)
    expect(parse(mergeMcpJson("   \n", entry).content).mcpServers[SERVER_KEY]).toEqual(
      entry
    )
  })

  it("preserves every other server untouched", () => {
    const existing = JSON.stringify({
      mcpServers: {
        supabase: { type: "http", url: "https://supabase.example/mcp" },
        postgres: { command: "npx", args: ["-y", "pg-mcp"] },
      },
    })

    const result = mergeMcpJson(existing, entry)
    const servers = parse(result.content).mcpServers

    expect(servers.supabase).toEqual({
      type: "http",
      url: "https://supabase.example/mcp",
    })
    expect(servers.postgres).toEqual({ command: "npx", args: ["-y", "pg-mcp"] })
    expect(result.preserved.sort()).toEqual(["postgres", "supabase"])
  })

  it("preserves unrelated top-level keys", () => {
    const existing = JSON.stringify({ $schema: "./schema.json", mcpServers: {} })
    const result = mergeMcpJson(existing, entry)
    expect(parse(result.content)).toHaveProperty("$schema", "./schema.json")
  })

  it("replaces an existing finpilot entry and reports it", () => {
    const existing = JSON.stringify({
      mcpServers: {
        finpilot: { type: "http", url: "https://old.example/api/mcp", headers: {} },
      },
    })

    const result = mergeMcpJson(existing, entry)
    expect(result.replaced).toBe(true)
    expect(parse(result.content).mcpServers[SERVER_KEY]).toEqual(entry)
  })

  it("does not count finpilot as a preserved server", () => {
    const existing = JSON.stringify({
      mcpServers: { finpilot: {}, supabase: {} },
    })
    expect(mergeMcpJson(existing, entry).preserved).toEqual(["supabase"])
  })

  it("tolerates a file with no mcpServers key", () => {
    const result = mergeMcpJson(JSON.stringify({ other: true }), entry)
    expect(parse(result.content).mcpServers[SERVER_KEY]).toEqual(entry)
    expect(parse(result.content)).toHaveProperty("other", true)
  })

  it("replaces a malformed mcpServers value rather than crashing", () => {
    const result = mergeMcpJson(JSON.stringify({ mcpServers: "nonsense" }), entry)
    expect(parse(result.content).mcpServers[SERVER_KEY]).toEqual(entry)
  })

  it("throws rather than overwriting invalid JSON", () => {
    // Failing loudly is the right call: silently replacing a file the user
    // hand-edited and broke could delete other servers they care about.
    expect(() => mergeMcpJson("{ not json", entry)).toThrow(/not valid JSON/)
  })

  it("throws when the root is a JSON array", () => {
    expect(() => mergeMcpJson("[1,2,3]", entry)).toThrow(/JSON object/)
  })

  it("writes the bearer header the MCP client expects", () => {
    const servers = parse(mergeMcpJson(null, entry).content).mcpServers
    expect(servers[SERVER_KEY]).toMatchObject({
      type: "http",
      headers: { Authorization: "Bearer fp_pat_a_b" },
    })
  })

  it("ends with a trailing newline so the file is diff-friendly", () => {
    expect(mergeMcpJson(null, entry).content.endsWith("\n")).toBe(true)
  })
})

describe("isIgnoredByGit", () => {
  it("detects a plain entry", () => {
    expect(isIgnoredByGit(".mcp.json")).toBe(true)
  })

  it("detects a rooted entry", () => {
    expect(isIgnoredByGit("/.mcp.json")).toBe(true)
  })

  it("finds the entry among other lines and ignores comments", () => {
    expect(isIgnoredByGit("node_modules\n# secrets\n.mcp.json\n.env")).toBe(true)
  })

  it("returns false when absent or when there is no .gitignore", () => {
    expect(isIgnoredByGit("node_modules\n.env")).toBe(false)
    expect(isIgnoredByGit(null)).toBe(false)
    expect(isIgnoredByGit("")).toBe(false)
  })

  it("does not mistake a commented-out entry for a real one", () => {
    expect(isIgnoredByGit("# .mcp.json")).toBe(false)
  })
})
