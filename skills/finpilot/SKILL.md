---
name: finpilot
description: Query the user's Finpilot investment portfolios — net worth, holdings, allocation, performance, and their stated investor profile — through the Finpilot MCP server. Use when the user asks how their portfolio, net worth, positions, or investments are doing, or asks to set up / connect Finpilot.
---

# Finpilot

Finpilot exposes the user's own portfolio data over a remote MCP server. This
skill covers connecting it and, more importantly, reading the numbers correctly
once connected.

## Connecting

If the Finpilot tools are not available, the user needs to link their account:

```bash
npx @agustinlzn/finpilot-mcp login
```

That opens a browser, they approve the request, and the CLI writes a `finpilot`
entry into `./.mcp.json`. They must restart their MCP client afterwards. To add
it to another project later, `npx @agustinlzn/finpilot-mcp install` reuses the saved
credential — no second login.

The grant is **read-only**. If the user wants write access, they create a token
by hand at `/settings/personal-access-tokens`; the CLI cannot request one.

`.mcp.json` will contain a bearer token after this. If it is not gitignored, say
so before they commit.

## Which tool to call

Six read-only tools. `get_overview` answers most questions on its own — reach
for it first and only drill down if the answer genuinely needs more.

| Question | Tool |
| --- | --- |
| "How am I doing?", net worth, today's movers | `get_overview` |
| "What do I hold?", allocation by sector/class/currency | `get_positions` |
| List of portfolios with per-portfolio P&L | `get_portfolios` |
| One portfolio's holdings and per-holding P&L | `get_portfolio` |
| Return over a period, drawdown, volatility | `get_performance` |
| Risk tolerance, goals, preferences | `get_investor_profile` |

The PAT is rate limited to 30 requests per 60 seconds across every tool, so
avoid speculative fan-out calls — one `get_overview` beats six drill-downs.

## Reading the numbers correctly

These are the mistakes that produce confidently wrong answers:

- **Everything is already USD.** ARS positions are converted at the `mep` rate
  before you see them. Never convert again.
- **`returnPct` vs `navChangePct`** in `get_performance` are not interchangeable.
  `returnPct` is the true time-weighted return and is the one to quote for "how
  did I do". `navChangePct` includes deposits and withdrawals — if the user added
  money it looks like a huge gain. Never present it as performance.
- **`realizedPnl` vs `closedPnl`** answer different questions. `realizedPnl`
  covers every sale including partial ones; `closedPnl` covers only symbols now
  fully exited. The second is not a subset of the first in the way it looks.
- **`null` means unpriced, not zero.** Say the value is unavailable rather than
  reporting zero.
- **`degraded: true`** means at least one holding has no live quote, so that
  portfolio's totals are incomplete. Flag it instead of presenting the number as
  authoritative.
- **`omitted`** in `get_overview` lists what the token's scopes excluded. If it
  contains `externals`, the net worth figure covers portfolios only and is *not*
  the user's true net worth — say so.

## Boundaries

`get_investor_profile` returns what the user said about their own risk appetite
and goals. Reflect it back; do not turn it into personalized investment advice or
a recommendation to buy or sell anything. If they ask what to invest in, describe
what they hold and point them at a licensed advisor for the rest.

## Troubleshooting

- **Tools missing after login** — the MCP client needs a restart to read
  `.mcp.json`.
- **"token lacks the X scope"** — the grant is read-only and scoped. Re-run
  `npx @agustinlzn/finpilot-mcp login --scopes portfolios:read,wealth:read,strategy:read,profile:read`,
  or create a token in the app for anything broader.
- **"Rate limited"** — 30 requests per minute per token. Wait and batch.
- **Auth failure** — the token expires 90 days after login. `npx @agustinlzn/finpilot-mcp login`
  again. `npx @agustinlzn/finpilot-mcp status` shows what is currently saved.
