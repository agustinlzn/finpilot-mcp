/**
 * The read scopes the device grant can mint, mirroring the SQL allowlist in
 * `device_auth_start`. Kept here so `--scopes` can be validated before a
 * round-trip, and so `--help` can list them; the server is the enforcing copy.
 */
export const AVAILABLE_SCOPES = [
  "portfolios:read",
  "wealth:read",
  "market:read",
  "strategy:read",
  "profile:read",
] as const

export type Scope = (typeof AVAILABLE_SCOPES)[number]

/** What `login` asks for when the user does not narrow it. */
export const DEFAULT_SCOPES: readonly Scope[] = [
  "portfolios:read",
  "wealth:read",
  "strategy:read",
  "profile:read",
]

const KNOWN = new Set<string>(AVAILABLE_SCOPES)

export type ScopeParse =
  | { ok: true; scopes: Scope[] }
  | { ok: false; invalid: string[] }

/** Parse a `--scopes a,b` / `--scopes "a b"` value. */
export function parseScopes(raw: string): ScopeParse {
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const invalid = parts.filter((p) => !KNOWN.has(p))
  if (invalid.length > 0) return { ok: false, invalid }

  return { ok: true, scopes: [...new Set(parts)] as Scope[] }
}
