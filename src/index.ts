import { parseArgs } from "node:util"

import { cancel, confirm, intro, isCancel, log, note, outro, spinner } from "@clack/prompts"
import pc from "picocolors"

import { openBrowser } from "./browser"
import {
  clearConfig,
  configPath,
  DEFAULT_API_URL,
  readConfig,
  writeConfig,
} from "./config"
import {
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
} from "./device-flow"
import { installMcpEntry } from "./install"
import { sameOriginUrl } from "./safe-url"
import { AVAILABLE_SCOPES, DEFAULT_SCOPES, parseScopes, type Scope } from "./scopes"

const VERSION = "0.1.0"

const HELP = `
${pc.bold("finpilot-mcp")} — connect your Finpilot portfolios to Claude Code and other MCP clients.

${pc.bold("USAGE")}
  npx @agustinlzn/finpilot-mcp <command> [options]

${pc.bold("COMMANDS")}
  login       Authorize this machine in your browser and save the token
  install     Write the MCP entry into this project's .mcp.json
  status      Show the saved credential and what it can read
  logout      Delete the saved credential from this machine

${pc.bold("OPTIONS")}
  --scopes <list>   Comma or space separated. Default:
                    ${DEFAULT_SCOPES.join(", ")}
  --api-url <url>   Finpilot instance. Default: ${DEFAULT_API_URL}
  --no-open         Print the URL instead of opening a browser
  --no-install      Skip writing ./.mcp.json (login only)
  -h, --help        Show this help
  -v, --version     Show the version

${pc.bold("AVAILABLE SCOPES")} ${pc.dim("(read-only — write access needs a token made in the app)")}
  ${AVAILABLE_SCOPES.join("\n  ")}
`

function fail(message: string): never {
  log.error(message)
  process.exit(1)
}

async function commandLogin(opts: {
  apiUrl: string
  scopes: readonly Scope[]
  open: boolean
  install: boolean
}) {
  intro(pc.bold("finpilot-mcp login"))

  const s = spinner()
  s.start("Requesting a device code")

  let device
  try {
    device = await requestDeviceCode(opts.apiUrl, opts.scopes)
  } catch (error) {
    s.stop("Could not start the login", 1)
    fail(error instanceof DeviceFlowError ? error.message : String(error))
  }

  s.stop("Device code ready")

  // The server picks this URL, so it is checked before it reaches the OS opener
  // or the user's eyes. Falling back to a URL we build ourselves means a server
  // returning something off-origin degrades to "type the code in" rather than
  // sending anyone somewhere unexpected.
  const url =
    sameOriginUrl(device.verification_uri_complete, opts.apiUrl) ??
    sameOriginUrl(device.verification_uri, opts.apiUrl) ??
    `${opts.apiUrl}/device?code=${encodeURIComponent(device.user_code)}`

  // Always print the code and URL, even when the browser opens: a spawn that
  // "succeeds" is no guarantee a window appeared, and over SSH there is no
  // browser at all.
  note(
    `${pc.dim("Code")}  ${pc.bold(pc.cyan(device.user_code))}\n${pc.dim("Open")}  ${url}`,
    "Approve in your browser"
  )

  if (opts.open) {
    const shouldOpen = await confirm({
      message: "Open this URL in your browser now?",
    })
    if (isCancel(shouldOpen)) {
      cancel("Login cancelled.")
      process.exit(1)
    }
    if (shouldOpen) {
      const opened = await openBrowser(url)
      if (!opened) log.warn("Couldn't open a browser — use the URL above.")
    } else {
      log.info("Open the URL above manually when you're ready.")
    }
  }

  const poll = spinner()
  poll.start("Waiting for approval")

  let token
  try {
    token = await pollForToken(opts.apiUrl, device, {
      onPending: (secondsLeft) =>
        poll.message(`Waiting for approval ${pc.dim(`(${secondsLeft}s left)`)}`),
    })
  } catch (error) {
    poll.stop("Not authorized", 1)
    fail(error instanceof DeviceFlowError ? error.message : String(error))
  }

  poll.stop("Approved")

  // Whatever we accept here is where an MCP client will send this bearer token
  // on every future call, so an off-origin suggestion is discarded rather than
  // trusted — the canonical path on the instance we authenticated against is
  // always the safe answer.
  const mcpUrl =
    sameOriginUrl(token.finpilot?.mcp_url, opts.apiUrl) ?? `${opts.apiUrl}/api/mcp`
  const file = await writeConfig({
    apiUrl: opts.apiUrl,
    token: token.access_token,
    mcpUrl,
    scopes: token.scope ? token.scope.split(" ") : [...opts.scopes],
    createdAt: new Date().toISOString(),
  })
  log.success(`Saved credentials to ${pc.dim(file)}`)

  if (opts.install) {
    await runInstall(mcpUrl, token.access_token)
  }

  outro(
    `Done. Restart your MCP client and ask it ${pc.italic('"how are my portfolios doing?"')}`
  )
}

async function runInstall(mcpUrl: string, token: string) {
  try {
    const result = await installMcpEntry({ cwd: process.cwd(), mcpUrl, token })
    log.success(
      `${result.replaced ? "Updated" : "Added"} the ${pc.bold("finpilot")} server in ${pc.dim(result.file)}`
    )
    if (result.preserved.length > 0) {
      log.info(`Left untouched: ${result.preserved.join(", ")}`)
    }
    if (result.commitRisk) {
      log.warn(
        `${pc.bold(".mcp.json now contains an access token")} and does not look gitignored.\n` +
          `  Add ${pc.cyan(".mcp.json")} to .gitignore before committing.`
      )
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error))
    log.info("Your token is still saved — fix .mcp.json and run `npx @agustinlzn/finpilot-mcp install`.")
  }
}

async function commandInstall() {
  intro(pc.bold("finpilot-mcp install"))
  const config = await readConfig()
  if (!config) fail("No saved credentials. Run `npx @agustinlzn/finpilot-mcp login` first.")
  await runInstall(config.mcpUrl, config.token)
  outro("Restart your MCP client to pick it up.")
}

async function commandStatus() {
  const config = await readConfig()
  if (!config) {
    log.warn("Not logged in. Run `npx @agustinlzn/finpilot-mcp login`.")
    return
  }
  // Never print the token. `status` is the command people paste into issues.
  note(
    [
      `${pc.dim("Instance")}  ${config.apiUrl}`,
      `${pc.dim("MCP URL ")}  ${config.mcpUrl}`,
      `${pc.dim("Scopes  ")}  ${config.scopes.join(", ") || "(none recorded)"}`,
      `${pc.dim("Saved   ")}  ${new Date(config.createdAt).toLocaleString()}`,
      `${pc.dim("Config  ")}  ${configPath()}`,
    ].join("\n"),
    "Logged in"
  )
}

async function commandLogout() {
  const removed = await clearConfig()
  if (removed) {
    log.success("Removed the saved credential from this machine.")
    log.info(
      "The token still exists server-side — revoke it at /settings/personal-access-tokens."
    )
  } else {
    log.info("Nothing to remove.")
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      scopes: { type: "string" },
      "api-url": { type: "string" },
      open: { type: "boolean", default: true },
      install: { type: "boolean", default: true },
    },
  })

  if (values.version) {
    console.log(VERSION)
    return
  }

  const command = positionals[0]

  if (!command || values.help) {
    console.log(HELP)
    return
  }

  const apiUrl = (
    (values["api-url"] as string | undefined) ??
    process.env.FINPILOT_API_URL ??
    DEFAULT_API_URL
  ).replace(/\/+$/, "")

  let scopes: readonly Scope[] = DEFAULT_SCOPES
  if (typeof values.scopes === "string") {
    const parsed = parseScopes(values.scopes)
    if (!parsed.ok) {
      fail(
        `Unknown scope: ${parsed.invalid.join(", ")}\nAvailable: ${AVAILABLE_SCOPES.join(", ")}`
      )
    }
    scopes = parsed.scopes
  }

  switch (command) {
    case "login":
      await commandLogin({
        apiUrl,
        scopes,
        open: values.open !== false,
        install: values.install !== false,
      })
      return
    case "install":
      await commandInstall()
      return
    case "status":
      await commandStatus()
      return
    case "logout":
      await commandLogout()
      return
    default:
      console.log(HELP)
      fail(`Unknown command: ${command}`)
  }
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
