/**
 * Client half of the OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Kept free of any console output or timers-by-side-effect so the polling state
 * machine can be tested against a fake fetch and a fake clock. The command layer
 * owns all the pretty printing.
 *
 * Two hard rules, both security-relevant:
 *   - `device_code` never leaves this module except in a request body. It is not
 *     logged, not written to disk, and not put in a URL.
 *   - `slow_down` always widens the interval. A client that ignores it is
 *     indistinguishable from an attacker hammering the endpoint.
 */

export const CLIENT_ID = "finpilot-mcp"
export const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  finpilot?: { mcp_url?: string }
}

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = "DeviceFlowError"
  }
}

/** Human copy for the terminal error codes we can actually hit. */
function describe(code: string, description?: string): string {
  switch (code) {
    case "access_denied":
      return "You denied the request in the browser. Nothing was shared."
    case "expired_token":
      return "The code expired before it was approved. Run `finpilot-mcp login` again."
    case "invalid_grant":
      return "This login is no longer valid. Run `finpilot-mcp login` again."
    case "invalid_scope":
      return description ?? "Those permissions aren't available to the CLI."
    case "invalid_client":
      return "This CLI version isn't recognized by the server. Try updating it."
    case "temporarily_unavailable":
      return "Finpilot is unavailable right now. Try again in a moment."
    case "server_error":
      return "Finpilot hit an error issuing the token. Try again."
    default:
      return description ?? `Login failed (${code}).`
  }
}

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    // A non-JSON body (a proxy error page, say) is still a failure we describe.
  }
  return { status: res.status, json }
}

export interface FlowDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Step 1: ask for a code. */
export async function requestDeviceCode(
  apiUrl: string,
  scopes: readonly string[],
  deps: FlowDeps = {}
): Promise<DeviceCodeResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const { status, json } = await postJson(
    `${apiUrl}/api/device/code`,
    { client_id: CLIENT_ID, scope: scopes.join(" ") },
    fetchImpl
  )

  if (status !== 200) {
    const code = typeof json.error === "string" ? json.error : "unknown_error"
    throw new DeviceFlowError(
      describe(code, json.error_description as string | undefined),
      code
    )
  }
  return json as unknown as DeviceCodeResponse
}

/**
 * Step 2: poll until approved, denied, or expired.
 *
 * `onPending` fires on every tick so the caller can keep a spinner honest
 * without this module importing a UI library.
 */
export async function pollForToken(
  apiUrl: string,
  device: DeviceCodeResponse,
  deps: FlowDeps & { onPending?: (secondsLeft: number) => void } = {}
): Promise<TokenResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => Date.now())

  const startedAt = now()
  const deadline = startedAt + device.expires_in * 1000
  let interval = Math.max(device.interval, 1)

  for (;;) {
    if (now() >= deadline) {
      throw new DeviceFlowError(describe("expired_token"), "expired_token")
    }

    await sleep(interval * 1000)

    const { status, json } = await postJson(
      `${apiUrl}/api/device/token`,
      { client_id: CLIENT_ID, device_code: device.device_code, grant_type: GRANT_TYPE },
      fetchImpl
    )

    if (status === 200) return json as unknown as TokenResponse

    const code = typeof json.error === "string" ? json.error : "unknown_error"

    if (code === "authorization_pending") {
      deps.onPending?.(Math.max(0, Math.round((deadline - now()) / 1000)))
      continue
    }

    if (code === "slow_down") {
      // Honour the server's number when it sends one, otherwise apply the
      // RFC's +5s. Never poll faster than we were just told to.
      const suggested = typeof json.interval === "number" ? json.interval : interval + 5
      interval = Math.max(interval + 5, suggested)
      deps.onPending?.(Math.max(0, Math.round((deadline - now()) / 1000)))
      continue
    }

    throw new DeviceFlowError(
      describe(code, json.error_description as string | undefined),
      code
    )
  }
}
