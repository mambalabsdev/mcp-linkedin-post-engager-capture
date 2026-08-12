# LinkedIn Post Tracker and Comment Capture MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-linkedin-post-engager-capture)](https://smithery.ai/servers/mambabuilt/mcp-linkedin-post-engager-capture) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-linkedin-post-engager-capture/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-linkedin-post-engager-capture) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-linkedin-post-engager-capture%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-linkedin-post-engager-capture&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-linkedin-post-engager-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-linkedin-post-engager-capture) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-linkedin-post-engager-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-linkedin-post-engager-capture) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-linkedin-post-engager-capture)](https://github.com/mambalabsdev/mcp-linkedin-post-engager-capture/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-linkedin-post-engager-capture)

MCP server for the Mamba Labs [LinkedIn Post Tracker and Comment Capture](https://apify.com/mambalabs/linkedin-post-engager-capture) actor on Apify.

Point it at LinkedIn person profiles or company pages. It returns their recent posts as flat rows, with the real reaction and comment counts on every one, plus the commenters LinkedIn shows publicly. No cookies, no LinkedIn account, no credentials of any kind.

## Install

```bash
npx -y @mambalabsdev/mcp-linkedin-post-engager-capture
```

### Claude Desktop

```json
{
  "mcpServers": {
    "mamba-linkedin-post-engager-capture": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-linkedin-post-engager-capture"],
      "env": { "APIFY_TOKEN": "your-apify-token" }
    }
  }
}
```

Get an Apify token at [console.apify.com/account/integrations](https://console.apify.com/account/integrations).

## Tool

### `capture_linkedin_posts_and_commenters`

LinkedIn profiles and company pages in, their recent posts and public commenters out.

| Input | Type | Required | Notes |
| --- | --- | --- | --- |
| `profile_urls` | array | no | Person profiles, for example `https://www.linkedin.com/in/williamhgates`. Country subdomains are fine. Supply this, `company_urls`, or both. |
| `company_urls` | array | no | Company pages, for example `https://www.linkedin.com/company/microsoft`. Supply this, `profile_urls`, or both. |
| `posted_since` | string | no | ISO date, for example 2026-08-01. Posts older than this are skipped **before anything is charged**. |
| `collect_commenters` | boolean | no | One row per public commenter. Turn it off to collect posts only. Default `true`. |
| `collect_reactors` | boolean | no | Returns no reaction rows whatever you set, because LinkedIn serves no reactor identities to a logged-out visitor. Present so the limit is visible rather than silent. Default `true`. |
| `max_engagers_per_post` | integer | no | 0 to 100. Ten is LinkedIn's own ceiling for a logged-out visitor, so raising it above 10 does nothing. Set it to 0 to pay for posts only. Default `10`. |
| `use_residential_proxy` | boolean | no | Off by default, which is what the pricing assumes. Apify bills residential bandwidth on top of this actor's events. Default `false`. |

Nothing is required. A call with neither URL list comes back as a `no_input` notice row rather than an error, which mirrors the actor exactly.

## Reading the output

One dataset carries three row types, told apart by `row_type`. **Filter on it before loading a table.**

- `post` is one row per LinkedIn post.
- `engager` is one row per public commenter, joined to the post on `post_id`.
- `notice` is a run-level or source-level message.

`post_id` is the numeric part of LinkedIn's activity URN. It is stable across runs, across country subdomains and across both permalink spellings, so it is safe as a primary key and safe as the "have I already posted this to Slack" check.

**The commenter limits are real and they are not small.** LinkedIn renders about ten top-level comments to a logged-out visitor whatever the true total. Measured whole-run coverage was 178 commenters out of 4,857 that existed, which is 3.7 percent. About 30 percent of comment rows carry no timestamp. Every post row carries `commenters_collected` beside `commenters_available` so the coverage on any given post is a number you can read rather than something you infer.

**Reactor identities are not available at all** to a logged-out visitor. Every post row still carries the real `reaction_count`, and `reactors_status` says `unavailable_without_login`.

Every row carries `degraded` and `degradation_reason`. `false` means the actor looked; `null` on a field means it could not. Filter on `degraded` before you trust an absence. Two things that look like failures are deliberately not degraded, because both are measurements: `reactors_unavailable` is how logged-out LinkedIn works, and `no_posts_found` on a page that loaded is a real absence.

## Billing

You are charged per post collected and per commenter collected, plus a small actor start fee. Notice rows are free. `posted_since` filters before anything is charged, so a scheduled run that finds nothing new costs the actor start and nothing else.

There is no result cache: every run refetches, which is the right behavior for an actor whose job is to notice new posts. Pricing is on the [actor's Apify page](https://apify.com/mambalabs/linkedin-post-engager-capture). Running this server consumes Apify credits.

## What this server does and does not do

It is a thin client for the Apify actor. It passes your input through and returns the actor's output unchanged. Every behavior described above lives in the actor, not here.

It reads only what LinkedIn serves to a logged-out visitor. It holds no session cookie, uses no LinkedIn account, and reads nothing behind a login.

**Commenter rows are named people.** When you run this you are the data controller for the personal data it returns and Apify is the processor. Your lawful basis is yours to establish; nothing here is legal advice.

This actor is **unofficial** and is not affiliated with, sponsored by or endorsed by LinkedIn or Microsoft.

Errors are surfaced, never swallowed. An invalid input, an invalid token, an exhausted balance, a timeout, or a run that returns anything other than a dataset all come back as an explicit tool error rather than as an empty result.

## Source

The actor is on the [Apify Store](https://apify.com/mambalabs/linkedin-post-engager-capture). This wrapper is [MIT licensed](LICENSE).

Built by [Mamba Labs](https://apify.com/mambalabs)
