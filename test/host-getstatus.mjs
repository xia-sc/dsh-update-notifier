/**
 * Regression harness for the host half of the "stuck on 正在检查更新" bug.
 *
 * Boots the REAL `lib/index.js` with a fake Cordis context and a stubbed
 * `fetch` whose registry answers are slow (1.5s), then asks `getStatus` while
 * the startup check is still in flight. Pre-fix, the host answered the
 * half-checked state immediately; the fix waits (bounded) for the running check
 * so the client always gets a completed snapshot.
 *
 * Usage:
 *   node test/host-getstatus.mjs [path/to/index.js] [--expect-halved]
 */
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const expectHalved = args.includes("--expect-halved");
const target = resolve(args.find((a) => !a.startsWith("--")) || join(here, "..", "lib", "index.js"));

const FETCH_DELAY = 1500; // registry latency, so the check spans several seconds
const ASK_AT = 1200; // client asks 200ms after the startup check began

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

// ── fake Cordis context ───────────────────────────────────────────────────
function createCtx() {
  const prefixRoutes = [];
  const fetchRoutes = new Map();
  const disposers = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    // The real `connection` service carries both the trust/browser-auth fence and
    // the exact-Fetch-route seam the current host half mounts into.
    // `requestRejection` + `webServer` stay so the `--expect-halved` escape hatch
    // can still boot a pre-migration bundle, which registered a prefix route.
    connection: {
      requestRejection: () => undefined,
      fetch: {
        register(route) {
          fetchRoutes.set(route.path, route);
          return async () => fetchRoutes.delete(route.path);
        },
      },
    },
    effect(fn) {
      const dispose = fn();
      disposers.push(typeof dispose === "function" ? dispose : () => {});
    },
    webServer: {
      register(definition) {
        prefixRoutes.push(definition);
        return () => {};
      },
    },
  };
  return { ctx, fetchRoutes, prefixRoutes, disposeAll: () => disposers.forEach((d) => d()) };
}

// ── buffered node req/res doubles for the prefix route ────────────────────
function makeReq(pathname, body) {
  return {
    url: pathname,
    method: "POST",
    headers: { host: "127.0.0.1:3080", "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body, "utf8");
    },
  };
}

function makeRes() {
  const chunks = [];
  const events = new EventEmitter();
  let status = 0;
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    settled: false,
    writeHead(code) {
      status = code;
      res.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true; // never ask the caller to wait for "drain"
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      res.writableEnded = true;
      res.settled = true;
      events.emit("close");
    },
    on(...a) {
      events.on(...a);
      return res;
    },
    once(...a) {
      events.once(...a);
      return res;
    },
    off(...a) {
      events.off(...a);
      return res;
    },
    get response() {
      return { status, body: Buffer.concat(chunks).toString("utf8") };
    },
  };
  return res;
}

/**
 * Ask `getStatus` through whichever RPC surface the bundle under test mounted:
 * the current exact Fetch route on `/api`, or (pre-migration bundles only) the
 * legacy `/dsh-update-rpc` prefix route driven with node req/res doubles.
 */
async function callRpc(harness, endpoint, method) {
  // The wire `method` is the path below /api for the current bundle (the
  // carrier's own endpointFromPath rule); pre-migration bundles used the bare
  // endpoint name on their own channel.
  const wireMethod = harness.fetchRoutes.has(`/api/dsh-update-rpc/${endpoint}`) ? `dsh-update-rpc/${endpoint}` : method;
  const envelope = { type: "client-request", rpcId: "test-1", method: wireMethod, payload: { args: {} } };
  const started = Date.now();
  let status;
  let body;

  const exact = harness.fetchRoutes.get(`/api/dsh-update-rpc/${endpoint}`);
  if (exact) {
    const response = await exact.fetch(
      new Request(`http://127.0.0.1:3080/api/dsh-update-rpc/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      })
    );
    status = response.status;
    body = await response.text();
  } else {
    const legacy = harness.prefixRoutes.find((r) => r.path === "/dsh-update-rpc");
    assert.ok(legacy, "the plugin mounted neither an exact /api route nor the legacy prefix route");
    const res = makeRes();
    await legacy.handler(makeReq(`/dsh-update-rpc/${endpoint}`, JSON.stringify(envelope)), res);
    status = res.response.status;
    body = res.response.body;
  }

  const elapsed = Date.now() - started;
  assert.equal(status, 200, `unexpected HTTP ${status}`);
  const parsed = JSON.parse(body);
  assert.equal(parsed.type, "server-response");
  assert.equal(parsed.result.ok, true, JSON.stringify(parsed.result));
  return { value: parsed.result.value, elapsed };
}

// ── run ───────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async (url, init) => {
  fetchCalls += 1;
  await new Promise((res, rej) => {
    const timer = setTimeout(res, FETCH_DELAY);
    const signal = init && init.signal;
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        rej(new Error("aborted"));
      });
    }
  });
  const target = String(url);
  if (target.includes("registry.")) {
    return jsonResponse({
      "dist-tags": { latest: "0.1.5-rc.1", next: "0.1.5-rc.2", alpha: "0.1.5-alpha.2" },
    });
  }
  if (target.includes("api.github.com")) return jsonResponse([{ name: "v0.1.5-rc.2" }]);
  return new Response("not found", { status: 404 });
};

let model;
try {
  model = await import(pathToFileURL(target).href);
} finally {
  // keep the stub installed until the scenario finishes
}

const harness = createCtx();
model.apply(harness.ctx);
try {
  // wait until the plugin's startup timer has fired and its check is running
  await sleep(ASK_AT);
  const { value, elapsed } = await callRpc(harness, "getStatus", "getStatus");
  console.log(`bundle: ${target}`);
  console.log(`  fetches=${fetchCalls} getStatus answered in ${elapsed}ms`);
  console.log(
    `  value: checkedAt=${value.checkedAt} checking=${value.checking} current=${value.current} latest=${value.latest}`
  );

  const halved = value.checkedAt === null && value.checking === true;
  if (expectHalved) {
    assert.ok(halved, "expected the OLD host to answer with the half-checked state");
    console.log("OK (expected pre-fix behaviour): answered with the half-checked state\n");
  } else {
    assert.equal(halved, false, "getStatus still answers with a half-checked snapshot while a check is running");
    assert.ok(value.checkedAt, "expected a completed snapshot (checkedAt set)");
    assert.equal(value.checking, false);
    console.log("OK: getStatus waited for the in-flight check and returned a completed snapshot\n");
  }
} finally {
  harness.disposeAll();
  globalThis.fetch = realFetch;
}
process.exit(0);
