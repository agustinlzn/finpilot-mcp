# finpilot-mcp

Connect your [Finpilot](https://finpilot-market.vercel.app) portfolios to Claude
Code — or any MCP client — with one command.

```bash
npx finpilot-mcp login
```

That opens your browser, you approve the request, and the CLI writes a
`finpilot` entry into your project's `.mcp.json`. Restart your client and ask it
*"how are my portfolios doing?"*.

No repo to clone, no server to keep running: Finpilot hosts the MCP server, and
this CLI just handles the login.

## What your agent gets

Six read-only tools:

| Tool | Answers |
| --- | --- |
| `get_overview` | Net worth, per-portfolio P&L, asset mix, today's movers. Start here. |
| `get_positions` | What you hold, flat or grouped by sector / class / currency / region |
| `get_portfolios` | Every portfolio with a live valuation summary |
| `get_portfolio` | One portfolio's totals and per-holding P&L |
| `get_performance` | Time-weighted return, drawdown, volatility over a range |
| `get_investor_profile` | Your stated risk appetite, goals and preferences |

## Commands

```bash
npx finpilot-mcp login      # authorize this machine, save the token, write .mcp.json
npx finpilot-mcp install    # write .mcp.json in another project, reusing the saved login
npx finpilot-mcp status     # what's saved and what it can read (never prints the token)
npx finpilot-mcp logout     # delete the saved credential from this machine
```

### Options

| Flag | Default |
| --- | --- |
| `--scopes <list>` | `portfolios:read, wealth:read, strategy:read, profile:read` |
| `--api-url <url>` | `https://finpilot-market.vercel.app` |
| `--no-open` | Print the URL instead of launching a browser — useful over SSH |
| `--no-install` | Log in without touching `.mcp.json` |

Available scopes are `portfolios:read`, `wealth:read`, `market:read`,
`strategy:read` and `profile:read`. Narrow them if you want:

```bash
npx finpilot-mcp login --scopes portfolios:read,market:read
```

## Security

**The login is read-only.** The device flow can only mint read scopes — there is
no flag that grants write access. Anything that can modify your data has to be a
token you create by hand in the app, deliberately. That is the containment for
the attack this kind of flow is exposed to: if someone tricks you into approving
their code, they get a view of your holdings, not the ability to rewrite them.

**Only approve a code you just generated yourself.** The browser shows the code
and the exact permissions being granted — check the code matches your terminal.
If a link arrives from someone else, press Deny.

**Where the token lives.** `~/.finpilot/config.json`, mode `0600`. `login` and
`install` also write it into `./.mcp.json` so your MCP client can read it —
**add `.mcp.json` to `.gitignore`**. The CLI warns you if it isn't already there.

**Lifetime.** Tokens expire 90 days after login. Revoke early at any time from
`/settings/personal-access-tokens`. `logout` clears the local copy but does not
revoke it server-side — do both if a machine is compromised.

Every request is rate limited to 30 per 60 seconds per token.

## Use it as an agent skill

This repo is also a [skills.sh](https://www.skills.sh) skill, teaching an agent
how to connect Finpilot *and* how to read the numbers without the classic
mistakes (quoting NAV change as if it were return, treating `null` as zero,
double-converting ARS):

```bash
npx skills add agustinlozano/finpilot-mcp
```

## Requirements

Node 20 or newer. The published package bundles its dependencies into a single
file, so `npx` is one small download with no install step.

## License

MIT
