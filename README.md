# LinkedIn Post Tracker MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-linkedin-post-engager-capture)](https://smithery.ai/servers/mambabuilt/mcp-linkedin-post-engager-capture) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-linkedin-post-engager-capture/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-linkedin-post-engager-capture) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-linkedin-post-engager-capture%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-linkedin-post-engager-capture&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-linkedin-post-engager-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-linkedin-post-engager-capture) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-linkedin-post-engager-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-linkedin-post-engager-capture) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-linkedin-post-engager-capture)](https://github.com/mambalabsdev/mcp-linkedin-post-engager-capture/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-linkedin-post-engager-capture)

MCP server for the Mamba Labs [LinkedIn Post Tracker](https://apify.com/mambalabs/linkedin-post-engager-capture) actor on Apify.

Point it at LinkedIn person profiles or company pages. It returns the posts a search engine has indexed for each one, as flat rows: permalink, author, a text excerpt, and the publish date. No request is sent to LinkedIn, and no cookie, account, or credential is used.

**Changed in 1.3.0.** The actor stopped fetching linkedin.com on 2026-10-12. Commenter rows, reaction and comment counts, media, and the inputs `collect_commenters`, `collect_reactors`, `max_engagers_per_post`, and `use_residential_proxy` are gone. Posts now come from search results, so coverage is what the index holds: posts appear days or weeks after publishing, and many never appear. The tool keeps its name, `capture_linkedin_posts_and_commenters`, so existing clients keep working.

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

LinkedIn profiles and company pages in, the posts a search engine has indexed for them out.

| Input | Type | Required | Meaning |
|---|---|---|---|
| `profile_urls` | array of strings | one of the two | Person profiles, for example `https://www.linkedin.com/in/williamhgates`. |
| `company_urls` | array of strings | one of the two | Company pages, for example `https://www.linkedin.com/company/microsoft`. |
| `posted_since` | string | no | ISO date. Posts published before this are skipped before anything is charged. |
| `max_charge_usd` | number | no | Spend cap for the run, in USD. The run starts no post whose charge would cross it and writes one `max_charge_reached` notice row. |

## Reading the output

- `post` is one row per indexed post: `post_id`, `post_permalink`, `author_name`, `author_url`, `author_type`, `post_text` (the search engine's excerpt), `published_at` (decoded from the post id).
- `notice` is a run-level or source-level message. Filter these out before loading a table.

A post counts only when its permalink names the source, for example `linkedin.com/posts/stripe_...` for `linkedin.com/company/stripe`. A refused search comes back as a degraded notice, never as "no posts".

## Billing

You are charged per post collected, plus a small actor start fee. Notice rows are free. `posted_since` filters before anything is charged.

| Event | Price per event (USD) | Fires when |
| --- | --- | --- |
| `apify-actor-start` | $0.00005 | Charged when the Actor starts running, one event per GB of memory. |
| `post-collected` | $0.002 on the Free plan, down to $0.0017 on higher Apify plans | One LinkedIn post returned from search results, with its permalink, author, text excerpt and publish date. |

The [actor's Apify page](https://apify.com/mambalabs/linkedin-post-engager-capture) carries the current prices.

## What this server does and does not do

It is a thin client for the Apify actor. It passes your input through and returns the actor's output unchanged. Every behavior described above lives in the actor, not here.

It reads only public search engine results. It sends no request to LinkedIn, holds no session cookie, and uses no LinkedIn account.

**Post rows from a person profile name that person.** When you run this you are the data controller for the personal data it returns and Apify is the processor. Your lawful basis is yours to establish; nothing here is legal advice.

This actor is **unofficial** and is not affiliated with, sponsored by or endorsed by LinkedIn or Microsoft.

Errors are surfaced, never swallowed. An invalid input, an invalid token, an exhausted balance, a timeout, or a run that returns anything other than a dataset all come back as an explicit tool error rather than as an empty result.

## Source

The actor is on the [Apify Store](https://apify.com/mambalabs/linkedin-post-engager-capture). This wrapper is [MIT licensed](LICENSE).

Built by [Mamba Labs](https://apify.com/mambalabs)
