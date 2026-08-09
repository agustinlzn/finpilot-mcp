import { describe, expect, it } from "vitest"

import { sameOriginUrl } from "./safe-url"

const BASE = "https://finpilot-market.vercel.app"

describe("sameOriginUrl", () => {
  it("accepts a same-origin URL and returns it normalized", () => {
    expect(sameOriginUrl(`${BASE}/device?code=BCDF-GHJK`, BASE)).toBe(
      `${BASE}/device?code=BCDF-GHJK`
    )
  })

  it("accepts a same-origin URL when the base carries a trailing path", () => {
    expect(sameOriginUrl(`${BASE}/api/mcp`, `${BASE}/`)).toBe(`${BASE}/api/mcp`)
  })

  it("rejects a different host", () => {
    expect(sameOriginUrl("https://evil.example.com/device", BASE)).toBeNull()
  })

  it("rejects a host that merely starts with the real one", () => {
    // The check is origin equality, not a prefix match, so this class of
    // look-alike never gets a chance.
    expect(
      sameOriginUrl("https://finpilot-market.vercel.app.evil.com/device", BASE)
    ).toBeNull()
  })

  it("rejects a downgrade to http on the same host", () => {
    expect(
      sameOriginUrl("http://finpilot-market.vercel.app/device", BASE)
    ).toBeNull()
  })

  it("rejects a different port on the same host", () => {
    expect(
      sameOriginUrl("https://finpilot-market.vercel.app:8443/device", BASE)
    ).toBeNull()
  })

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
  ])("rejects the non-http scheme %s", (candidate) => {
    expect(sameOriginUrl(candidate, BASE)).toBeNull()
  })

  it("rejects embedded credentials even on the right host", () => {
    expect(
      sameOriginUrl("https://user:pass@finpilot-market.vercel.app/device", BASE)
    ).toBeNull()
  })

  it("rejects a URL whose userinfo smuggles the real host past a naive check", () => {
    expect(
      sameOriginUrl("https://finpilot-market.vercel.app@evil.com/device", BASE)
    ).toBeNull()
  })

  it("rejects undefined, empty, and unparseable input", () => {
    expect(sameOriginUrl(undefined, BASE)).toBeNull()
    expect(sameOriginUrl("", BASE)).toBeNull()
    expect(sameOriginUrl("not a url", BASE)).toBeNull()
    expect(sameOriginUrl("/device?code=BCDF-GHJK", BASE)).toBeNull()
  })

  it("rejects everything when the base itself is unparseable", () => {
    expect(sameOriginUrl(`${BASE}/device`, "not a url")).toBeNull()
  })

  it("never returns a raw quote, which is the Windows cmd hazard", () => {
    // openBrowser shells through `cmd /c start "" <url>` on Windows, and cmd
    // re-parses its arguments. Breaking out of Node's quoting needs a literal
    // `"`. We do not have to reject such a URL — passing it through `new URL`
    // percent-encodes the quote, which is what actually closes the breakout —
    // but the guarantee callers rely on is that the returned string has none.
    const dirty = sameOriginUrl(`${BASE}/device" & calc.exe`, BASE)
    expect(dirty).not.toBeNull()
    expect(dirty).not.toContain('"')
    expect(dirty).toContain("%22")
  })
})
