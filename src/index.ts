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

// How long the actor run itself is allowed to take, in seconds.
//
// MEASURED, not chosen from the air. Over this actor's own run history in
// actor_runs on 2026-09-08, SUCCEEDED runs only, 18 of them carrying a
// duration: P50 31.6 s, P95 258.6 s, P99 638.1 s, slowest ever 733.0 s.
//
// The wrapper was calling run-sync-get-dataset-items?timeout=300, which sits
// between this actor's P95 and its P99, so a run that takes longer than five
// minutes was cut off and reported as a timeout even though the actor went on
// to finish. 1800 s is 2.5 times the slowest run this actor has ever completed
// and 2.8 times its P99, which is headroom for a slower day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
// MAMBA_MCP_POLL_INTERVAL_MS exists for the test suite, which drives the poll
// loop against a mocked Apify API. Callers never need to set it.
const POLL_INTERVAL_MS = Number(process.env.MAMBA_MCP_POLL_INTERVAL_MS) || 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. This wrapper used
// run-sync-get-dataset-items?timeout=300 and cut off runs the actor completes.
// 300 s sits between this actor's P95 of 258.6 s and its P99 of 638.1 s, so the
// cut-off did not hit the typical call: it hit the long tail, which is exactly
// the call a caller most needs to come back. Its slowest completed run is
// 733.0 s, well past the ceiling.
// Raising that query parameter does not fix it, which is worth stating
// because it is the obvious fix and it is wrong. Apify's synchronous endpoints
// carry a platform ceiling of 300 seconds on the HTTP wait itself and answer
// 408 past it regardless of what `timeout` says. The only way for the wrapper
// to wait as long as the actor needs is to start the run, poll it to a terminal
// status, and then read the dataset.
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

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
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
