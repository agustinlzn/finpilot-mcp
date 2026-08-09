/**
 * Guards for the two URLs the *server* gets to choose.
 *
 * `verification_uri_complete` is handed to the OS to open, and `finpilot.mcp_url`
 * is written into `.mcp.json`, where an MCP client will send the bearer token on
 * every call from then on. Both arrive in a response body, so whoever answers
 * `--api-url` decides them — a hostile or compromised instance, or a typo'd host
 * someone was talked into passing.
 *
 * Two concrete things this stops:
 *   - Pointing the MCP client at an attacker's endpoint, which would forward a
 *     90-day read token on every tool call, silently, forever.
 *   - Windows argument injection: `openBrowser` shells out through
 *     `cmd /c start "" <url>`, and cmd re-parses its arguments, so a quote in a
 *     server-controlled string is a known hazard. Rejecting anything that is not
 *     a plain same-origin http(s) URL removes the input entirely.
 *
 * Same-origin against the API base is the whole rule. It is deliberately
 * stricter than "is this a valid URL": we already know which host we are talking
 * to, so there is no reason to accept a redirect to any other one.
 */

/**
 * Return `candidate` when it is a well-formed http(s) URL on the same origin as
 * `base`, otherwise null. Callers decide whether that is fatal or a fallback.
 */
export function sameOriginUrl(
  candidate: string | undefined,
  base: string
): string | null {
  if (!candidate) return null

  let url: URL
  let baseUrl: URL
  try {
    url = new URL(candidate)
    baseUrl = new URL(base)
  } catch {
    return null
  }

  // Anything that is not http(s) is out: `file:`, `javascript:` and friends have
  // no business being passed to the OS opener.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.origin !== baseUrl.origin) return null

  // Credentials in a URL (`https://user:pass@host/`) are both a phishing aid and
  // a way to smuggle characters past a naive host check.
  if (url.username || url.password) return null

  return url.toString()
}
