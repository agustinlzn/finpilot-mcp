import { describe, expect, it, vi } from "vitest"

import {
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  type DeviceCodeResponse,
} from "./device-flow"

/**
 * The polling loop, driven by a fake fetch and a fake clock so the whole state
 * machine runs in microseconds and nothing depends on wall time.
 *
 * The `slow_down` cases matter most: a client that ignores the server's backoff
 * looks exactly like an attacker hammering an unauthenticated endpoint.
 */

const API = "https://finpilot.test"

const device: DeviceCodeResponse = {
  device_code: "d".repeat(64),
  user_code: "BCDF-GHJK",
  verification_uri: `${API}/device`,
  verification_uri_complete: `${API}/device?code=BCDF-GHJK`,
  expires_in: 600,
  interval: 5,
}

/** Replays a scripted list of responses, one per call. */
function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0
  const calls: Array<{ url: string; body: unknown }> = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const step = responses[Math.min(i, responses.length - 1)]!
    i += 1
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return {
      status: step.status,
      json: async () => step.body,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls, callCount: () => i }
}

/** A clock that advances only when the code under test sleeps. */
function fakeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe("requestDeviceCode", () => {
  it("posts the client id and space-joined scopes", async () => {
    const f = fakeFetch([{ status: 200, body: device }])
    const result = await requestDeviceCode(
      API,
      ["portfolios:read", "wealth:read"],
      { fetchImpl: f.impl }
    )

    expect(result.user_code).toBe("BCDF-GHJK")
    expect(f.calls[0]!.url).toBe(`${API}/api/device/code`)
    expect(f.calls[0]!.body).toMatchObject({
      client_id: "finpilot-mcp",
      scope: "portfolios:read wealth:read",
    })
  })

  it("turns invalid_scope into an actionable message", async () => {
    const f = fakeFetch([
      {
        status: 400,
        body: { error: "invalid_scope", error_description: "Scope not available: x:write" },
      },
    ])

    await expect(
      requestDeviceCode(API, ["x:write"], { fetchImpl: f.impl })
    ).rejects.toThrow(/Scope not available/)
  })

  it("surfaces the error code for programmatic handling", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "invalid_client" } }])
    await expect(
      requestDeviceCode(API, [], { fetchImpl: f.impl })
    ).rejects.toMatchObject({ code: "invalid_client" })
  })

  it("does not crash when the error body is not JSON", async () => {
    const impl = (async () =>
      ({
        status: 502,
        json: async () => {
          throw new Error("not json")
        },
      }) as unknown as Response) as unknown as typeof fetch

    await expect(requestDeviceCode(API, [], { fetchImpl: impl })).rejects.toBeInstanceOf(
      DeviceFlowError
    )
  })
})

describe("pollForToken", () => {
  it("returns the token once the user approves", async () => {
    const f = fakeFetch([
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "authorization_pending" } },
      {
        status: 200,
        body: {
          access_token: "fp_pat_a_b",
          token_type: "Bearer",
          scope: "portfolios:read",
          expires_in: 7776000,
          finpilot: { mcp_url: `${API}/api/mcp` },
        },
      },
    ])
    const clock = fakeClock()

    const token = await pollForToken(API, device, {
      fetchImpl: f.impl,
      sleep: clock.sleep,
      now: clock.now,
    })

    expect(token.access_token).toBe("fp_pat_a_b")
    expect(f.callCount()).toBe(3)
  })

  it("sends the device code in the body and never in the URL", async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()

    await pollForToken(API, device, {
      fetchImpl: f.impl,
      sleep: clock.sleep,
      now: clock.now,
    })

    expect(f.calls[0]!.url).toBe(`${API}/api/device/token`)
    expect(f.calls[0]!.url).not.toContain(device.device_code)
    expect(f.calls[0]!.body).toMatchObject({
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
  })

  it("waits the advertised interval before the first poll", async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()
    const sleep = vi.fn(clock.sleep)

    await pollForToken(API, device, { fetchImpl: f.impl, sleep, now: clock.now })

    expect(sleep).toHaveBeenCalledWith(5000)
  })

  it("widens the interval on slow_down, honouring the server's number", async () => {
    const f = fakeFetch([
      { status: 400, body: { error: "slow_down", interval: 15 } },
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()
    const sleep = vi.fn(clock.sleep)

    await pollForToken(API, device, { fetchImpl: f.impl, sleep, now: clock.now })

    expect(sleep).toHaveBeenNthCalledWith(1, 5000)
    expect(sleep).toHaveBeenNthCalledWith(2, 15000)
  })

  it("still backs off when slow_down carries no interval", async () => {
    const f = fakeFetch([
      { status: 400, body: { error: "slow_down" } },
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()
    const sleep = vi.fn(clock.sleep)

    await pollForToken(API, device, { fetchImpl: f.impl, sleep, now: clock.now })

    // RFC 8628's +5s default.
    expect(sleep).toHaveBeenNthCalledWith(2, 10000)
  })

  it("never polls faster than the previous interval", async () => {
    // A server that returns a *smaller* interval must not speed us up.
    const f = fakeFetch([
      { status: 400, body: { error: "slow_down", interval: 1 } },
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()
    const sleep = vi.fn(clock.sleep)

    await pollForToken(API, device, { fetchImpl: f.impl, sleep, now: clock.now })

    expect(sleep).toHaveBeenNthCalledWith(2, 10000)
  })

  it("stops immediately when the user denies", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "access_denied" } }])
    const clock = fakeClock()

    await expect(
      pollForToken(API, device, { fetchImpl: f.impl, sleep: clock.sleep, now: clock.now })
    ).rejects.toMatchObject({ code: "access_denied" })
    expect(f.callCount()).toBe(1)
  })

  it("stops on expired_token and invalid_grant", async () => {
    for (const code of ["expired_token", "invalid_grant"]) {
      const f = fakeFetch([{ status: 400, body: { error: code } }])
      const clock = fakeClock()
      await expect(
        pollForToken(API, device, {
          fetchImpl: f.impl,
          sleep: clock.sleep,
          now: clock.now,
        })
      ).rejects.toMatchObject({ code })
    }
  })

  it("gives up locally once the code's own lifetime elapses", async () => {
    // Guards against polling forever if the server keeps saying "pending".
    const f = fakeFetch([{ status: 400, body: { error: "authorization_pending" } }])
    const clock = fakeClock()

    await expect(
      pollForToken(
        API,
        { ...device, expires_in: 12 },
        { fetchImpl: f.impl, sleep: clock.sleep, now: clock.now }
      )
    ).rejects.toMatchObject({ code: "expired_token" })
  })

  it("reports remaining seconds through onPending", async () => {
    const f = fakeFetch([
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: { access_token: "t", token_type: "Bearer", scope: "", expires_in: 1 } },
    ])
    const clock = fakeClock()
    const onPending = vi.fn()

    await pollForToken(API, device, {
      fetchImpl: f.impl,
      sleep: clock.sleep,
      now: clock.now,
      onPending,
    })

    expect(onPending).toHaveBeenCalledTimes(1)
    expect(onPending.mock.calls[0]![0]).toBe(595) // 600 - one 5s interval
  })
})
