/**
 * Regression harness for the update notifier's RPC endpoints in the host half
 * (`lib/index.js`).
 *
 * Since the DSH 0.1.7 audit the plugin mounts three EXACT Fetch routes on the
 * shared `/api` channel (`ctx.connection.fetch.register`) instead of hand-rolling
 * a prefix route plus a node/fetch bridge, so the untrusted edge (trust fence,
 * browser auth, byte-counted body cap, abort signal, backpressure) belongs to
 * DSH. What remains — and what this test pins — is this plugin's own contract:
 *   - the three routes exist with the right path/method/body mode, nothing is
 *     registered on `webServer` any more, and disposal removes them;
 *   - the `client-request` envelope: rpcId is echoed, `method` must equal the
 *     endpoint, malformed envelopes answer `gateway/bad-request`;
 *   - the gateway error taxonomy with the exact reason in `details.reason`;
 *   - a host without the `connection.fetch` seam stays alive and inert instead
 *     of throwing during activation.
 *
 * Usage:
 *   node test/rpc-bridge.mjs [path/to/index.js]
 *
 * Pointing it at a PRE-MIGRATION bundle (e.g. `git show HEAD:lib/index.js > old.js`)
 * fails the route assertions on purpose: that is the protocol change being
 * visible, not a bug reproduction. The pre-migration transport defects (fail-open
 * fence, UTF-16 body cap, flattened error codes) were reproduced against the old
 * bundle before the migration and are recorded in AUDIT-dsh-0.1.7-alpha.1.md §4.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = resolve(args.find((a) => !a.startsWith("--")) || join(here, "..", "lib", "index.js"));
const clientPath = join(here, "..", "lib", "client.js");

const NAMESPACE = "dsh-update-rpc";
const ENDPOINTS = ["getStatus", "checkNow", "compare"];

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}: ${error.message}`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}: ${error.message}`);
  }
}

// ── fake Cordis context ───────────────────────────────────────────────────
function createCtx({ fetchSeam = true, webServer = true } = {}) {
  const fetchRoutes = new Map();
  const prefixRoutes = [];
  const effects = [];
  const warnings = [];
  const ctx = {
    logger: { info() {}, warn: (line) => warnings.push(String(line)) },
    connection: fetchSeam
      ? {
          fetch: {
            register(route) {
              if (fetchRoutes.has(route.path)) throw new Error(`duplicate exact Fetch route ${route.path}`);
              fetchRoutes.set(route.path, route);
              return async () => fetchRoutes.delete(route.path);
            },
          },
        }
      : {},
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label: String(label ?? ""), dispose: typeof dispose === "function" ? dispose : () => {} });
    },
  };
  if (webServer) {
    ctx.webServer = {
      register(definition) {
        prefixRoutes.push(definition);
        return () => {};
      },
    };
  }
  return { ctx, fetchRoutes, prefixRoutes, effects, warnings };
}

/** Activate the bundle and cancel its startup/interval timers. */
function activate(model, harness) {
  model.apply(harness.ctx);
  for (const effect of harness.effects) if (effect.label.includes("timers")) effect.dispose();
}

/** Drive one route the way the /api carrier does: a fetch-shaped Request. */
async function call(fetchRoutes, endpoint, { method = "POST", envelope, raw, headers } = {}) {
  const path = `/api/${NAMESPACE}/${endpoint}`;
  const route = fetchRoutes.get(path);
  assert.ok(route, `no exact Fetch route registered for ${path}`);
  const request = new Request(`http://127.0.0.1:3080${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: raw ?? JSON.stringify(envelope) }),
  });
  const response = await route.fetch(request);
  return { status: response.status, text: await response.text() };
}

function json(outcome) {
  assert.equal(outcome.status, 200, `expected HTTP 200, got ${outcome.status} (${outcome.text})`);
  const parsed = JSON.parse(outcome.text);
  assert.equal(parsed.type, "server-response");
  return parsed;
}

/**
 * The wire `method` is the path BELOW /api — the exact rule the shared channel's
 * `endpointFromPath("/api", pathname)` applies and the browser half sends via
 * `rpc.call("/api", "dsh-update-rpc/getStatus", …)`. It is NOT the bare endpoint
 * name; a host that compares against the short name rejects every real request.
 */
function wireMethod(endpoint) {
  return `${NAMESPACE}/${endpoint}`;
}

function envelope(endpoint, payload = { args: {} }, rpcId = "t-1") {
  return { type: "client-request", rpcId, method: wireMethod(endpoint), payload };
}

const expectedPaths = ENDPOINTS.map((endpoint) => `/api/${NAMESPACE}/${endpoint}`).sort();

// ── run ───────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network access is not expected in this test");
};

let model;
try {
  model = await import(pathToFileURL(target).href);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`bundle: ${target}`);

// ── the mounted surface ───────────────────────────────────────────────────
const main = createCtx();
activate(model, main);

check("exactly the three namespaced /api routes are registered", () => {
  assert.deepEqual([...main.fetchRoutes.keys()].sort(), expectedPaths);
});

check("every route is POST-only, buffered, and fetch-shaped", () => {
  for (const [path, route] of main.fetchRoutes) {
    assert.deepEqual(route.methods, ["POST"], `${path} methods`);
    assert.equal(route.requestBody, "buffered", `${path} requestBody`);
    assert.equal(typeof route.fetch, "function", `${path} fetch`);
  }
});

check("nothing is registered on webServer any more; connection is the only inject", () => {
  assert.deepEqual(main.prefixRoutes, []);
  assert.deepEqual(model.inject, ["connection"]);
});

check("route paths satisfy the shared channel's own path rule", () => {
  // Mirrors `endpointFromPath("/api", path)` in dsh-client-connection: the path
  // must sit under /api and every segment must match [A-Za-z0-9_$.-]+.
  const SEGMENT = /^[A-Za-z0-9_$.-]+$/;
  assert.ok(/^\/[A-Za-z0-9._~-]+$/.test("/api"), "the /api channel itself must match the channel pattern");
  for (const path of main.fetchRoutes.keys()) {
    assert.ok(path.startsWith("/api/"), `${path} must live under /api`);
    const segments = path.slice("/api/".length).split("/");
    assert.ok(
      segments.every((s) => s !== "" && s !== "." && s !== ".." && SEGMENT.test(s)),
      `${path} has a segment DSH would reject`
    );
  }
});

// ── envelope + dispatch ───────────────────────────────────────────────────
await checkAsync("getStatus answers a server-response envelope with the rpcId echoed", async () => {
  const parsed = json(await call(main.fetchRoutes, "getStatus", { envelope: envelope("getStatus") }));
  assert.equal(parsed.rpcId, "t-1");
  assert.equal(parsed.result.ok, true);
});

await checkAsync("compare endpoint returns ok + result", async () => {
  const cmp = json(await call(main.fetchRoutes, "compare", { envelope: envelope("compare", { args: { a: "0.1.5-rc.2", b: "0.1.6-alpha.1" } }) }));
  assert.equal(cmp.result.ok, true);
  assert.equal(cmp.result.value.result, -1);
});

// ── cross-half contract: replay what the browser half actually sends ──────
//
// 0.5.0 shipped a host that compared `envelope.method` against the short
// dispatch key while the browser half correctly sent the /api-relative path, so
// every real request was rejected. The two halves are separate handwritten
// files, so this reads the browser half's literals and feeds the resulting
// envelope to the real route — drift on either side fails here.
{
  const client = readFileSync(clientPath, "utf8");
  const channel = /var RPC_CHANNEL = "([^"]+)"/.exec(client)?.[1];
  const namespace = /"([A-Za-z0-9._-]+)\/" \+ endpoint/.exec(client)?.[1];

  await checkAsync("the browser half's own channel/namespace are what this host serves", async () => {
    assert.equal(channel, "/api", `browser half calls channel ${JSON.stringify(channel)}`);
    assert.equal(namespace, NAMESPACE, `browser half uses namespace ${JSON.stringify(namespace)}`);
    // DSH's rpc.call builds `{type, rpcId, method: <endpoint argument>, payload}`
    // and posts it to `${channel}/${endpoint}`; replay exactly that.
    const outcome = await call(main.fetchRoutes, "getStatus", {
      envelope: { type: "client-request", rpcId: "cross-1", method: `${namespace}/getStatus`, payload: { args: {} } },
    });
    const parsed = json(outcome);
    assert.equal(parsed.rpcId, "cross-1");
    assert.equal(parsed.result.ok, true, `browser-half-shaped request was rejected: ${outcome.text}`);
  });
}

// ── gateway error taxonomy ────────────────────────────────────────────────
await checkAsync("method/endpoint mismatch → gateway/bad-request (rpcId echoed)", async () => {
  const parsed = json(await call(main.fetchRoutes, "getStatus", { envelope: envelope("checkNow") }));
  assert.equal(parsed.rpcId, "t-1");
  assert.equal(parsed.result.ok, false);
  assert.equal(parsed.result.error.code, "gateway/bad-request");
  assert.equal(typeof parsed.result.error.details, "object");
});

await checkAsync("the wire method must be the /api-relative path, not the bare endpoint name", async () => {
  // Regression guard for the 0.5.0 activation bug: the host compared
  // `envelope.method` against the short dispatch key ("getStatus") while the
  // client correctly sent "dsh-update-rpc/getStatus", so every real request was
  // rejected with "does not match endpoint". A bare name must NOT be accepted.
  const bare = { type: "client-request", rpcId: "t-1", method: "getStatus", payload: { args: {} } };
  const parsed = json(await call(main.fetchRoutes, "getStatus", { envelope: bare }));
  assert.equal(parsed.result.ok, false, "a bare endpoint name must not be accepted as the wire method");
  assert.equal(parsed.result.error.code, "gateway/bad-request");
  assert.match(parsed.result.error.message, /dsh-update-rpc\/getStatus/);
});

await checkAsync("malformed envelope → gateway/bad-request + invalid-request rpcId", async () => {
  const parsed = json(await call(main.fetchRoutes, "getStatus", { envelope: { type: "client-request", method: "getStatus" } }));
  assert.equal(parsed.rpcId, "invalid-request");
  assert.equal(parsed.result.ok, false);
  assert.equal(parsed.result.error.code, "gateway/bad-request");
});

await checkAsync("invalid args → gateway/arguments-invalid + details.reason=invalid-args", async () => {
  const parsed = json(await call(main.fetchRoutes, "compare", { envelope: envelope("compare", { args: {} }) }));
  assert.equal(parsed.result.ok, false);
  assert.equal(parsed.result.error.code, "gateway/arguments-invalid");
  assert.equal(parsed.result.error.details.reason, "invalid-args");
});

// ── transport framing this plugin still owns ──────────────────────────────
for (const [label, options, status] of [
  ["wrong content-type → 415", { envelope: envelope("getStatus"), headers: { "content-type": "text/plain" } }, 415],
  ["invalid JSON → 400", { raw: "{not json" }, 400],
  ["GET → 404", { method: "GET" }, 404],
]) {
  await checkAsync(label, async () => {
    const outcome = await call(main.fetchRoutes, "getStatus", options);
    assert.equal(outcome.status, status);
  });
}

// ── lifecycle ─────────────────────────────────────────────────────────────
await checkAsync("the routes effect disposes every route", async () => {
  const effect = main.effects.find((candidate) => candidate.label.includes("dsh-update-rpc routes"));
  assert.ok(effect, "no routes effect was registered");
  await effect.dispose();
  assert.equal(main.fetchRoutes.size, 0);
});

// ── missing seam: stay alive and inert ────────────────────────────────────
{
  const degraded = createCtx({ fetchSeam: false, webServer: false });
  let threw = null;
  try {
    activate(model, degraded);
  } catch (error) {
    threw = error;
  }
  check("a host without connection.fetch still activates (no throw)", () => assert.equal(threw, null));
  check("no routes are mounted without the seam", () => assert.equal(degraded.fetchRoutes.size, 0));
  check("the missing seam is warned about", () => {
    assert.ok(
      degraded.warnings.some((line) => line.includes("fetch.register is unavailable")),
      `warnings: ${JSON.stringify(degraded.warnings)}`
    );
  });
}

check("the startup/interval timers were cancelled (no background fetch fired)", () => {
  assert.equal(fetchCalls, 0);
});

console.log(failures === 0 ? "\nOK: /api/dsh-update-rpc contract holds\n" : `\n${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
