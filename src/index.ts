#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?timeout=300`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }

    let message: string;
    switch (response.status) {
      case 400:
        message = `The ${actorLabel} run was rejected as invalid input.${detail}`;
        break;
      case 401:
        message = "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
        break;
      case 402:
        message =
          "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
        break;
      case 408:
        message = `The ${actorLabel} run timed out after 300 seconds. Ask for less per call, or run the actor on Apify directly for larger jobs.`;
        break;
      default:
        message = `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  // A 2xx from run-sync-get-dataset-items normally carries the dataset array.
  // Anything else on this path is a failure the caller must see, never an empty
  // success: surfacing it here is what keeps a failed run from reading as "no
  // results found".
  let items: unknown;
  try {
    items = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-linkedin-post-engager-capture",
  version: pkg.version,
});

// LinkedIn Post Tracker and Comment Capture (immutable actor ID oiGLNPuaf5BRaz9K5)
server.registerTool(
  "capture_linkedin_posts_and_commenters",
  {
    title: "Capture LinkedIn Posts and Commenters",
    description:
      "Point it at LinkedIn person profiles or company pages and it returns their recent posts as flat rows, with the real reaction and comment counts on every one, plus the commenters LinkedIn shows publicly. No cookies, no LinkedIn account, no credentials of any kind. One dataset carries three row types told apart by row_type: post, engager and notice, so filter on row_type before loading a table. post_id is the numeric activity URN and is stable across runs and across both permalink spellings, which makes it safe as a primary key and as a have-I-already-seen-this check. Read the limits before relying on the commenters: LinkedIn renders about ten top-level comments to a logged-out visitor whatever the real total, measured whole-run coverage was 3.7 percent, and roughly 30 percent of comment rows carry no timestamp. Reactor identities are not served to a logged-out visitor at all, so every post row carries the real reaction_count and reactors_status says unavailable_without_login. Every row carries degraded and degradation_reason: filter on degraded before you trust an absence. Requires an APIFY_TOKEN and consumes Apify credits. Read only.",
    annotations: {
      title: "Capture LinkedIn Posts and Commenters",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
    profile_urls: z.array(z.string()).optional().describe("LinkedIn person profile URLs whose recent posts you want, for example https://www.linkedin.com/in/williamhgates. Country subdomains such as uk.linkedin.com are fine. Supply this, company_urls, or both."),
    company_urls: z.array(z.string()).optional().describe("LinkedIn company page URLs whose recent posts you want, for example https://www.linkedin.com/company/microsoft. Supply this, profile_urls, or both."),
    posted_since: z.string().optional().describe("ISO date or timestamp, for example 2026-08-01. Posts published before this are skipped BEFORE anything is charged, so a scheduled run that finds nothing new costs the actor start and nothing else. Leave empty to take everything the page advertises."),
    collect_commenters: z.boolean().optional().describe("Return one row per person who commented, with name, profile URL, comment text and comment likes. Turn it off to collect posts only, in which case commenters_collected comes back null rather than 0, because the actor did not look. Default: true."),
    collect_reactors: z.boolean().optional().describe("LinkedIn serves no reactor identities to a logged-out visitor, so this returns no reaction rows whatever you set. It exists so the limit is visible rather than silent, and it adds one notice row per run. Set it to false to suppress that row. Default: true."),
    max_engagers_per_post: z.number().int().min(0).max(100).optional().describe("Caps the engager rows charged per post. LinkedIn shows about ten comments to a logged-out visitor, so ten is the platform ceiling and raising this above ten does nothing. Set it to 0 to pay for posts only. Default: 10."),
    use_residential_proxy: z.boolean().optional().describe("Off by default, which is what the pricing assumes and what was measured. Turn it on only if LinkedIn starts refusing the platform's datacenter addresses. Apify bills residential bandwidth on top of this actor's events. Default: false."),
    },
  },
  async (args) =>
    runActor("oiGLNPuaf5BRaz9K5", "LinkedIn Post Tracker and Comment Capture", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
