/**
 * Regression harness for the "stuck on 正在检查更新" bug.
 *
 * Loads the REAL `lib/client.js` bundle into a vm sandbox with a minimal React
 * hook runtime + fake clock, mounts the banner and dock exactly like the GUI
 * does, and drives a host whose startup check is still running when the page
 * asks for its first snapshot (the state that used to strand the spinner).
 *
 * Usage:
 *   node test/loading-recovery.mjs [path/to/client.js] [--expect-stuck]
 *
 * `--expect-stuck` asserts the pre-fix behaviour (no recovery) and is used to
 * prove the harness actually reproduces the bug against the old bundle.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const expectStuck = args.includes("--expect-stuck");
const target = resolve(args.find((a) => !a.startsWith("--")) || join(here, "..", "lib", "client.js"));

const HOST_CHECK_DONE_AT = 6000; // host's startup fetch finishes 6s after page load

// ── fake clock ────────────────────────────────────────────────────────────
function createClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + (Number(ms) || 0), fn, every: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = ++seq;
      const every = Math.max(1, Number(ms) || 1);
      timers.set(id, { at: now + every, fn, every });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 1000; guard++) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (due.length === 0) break;
        const [id, t] = due[0];
        now = Math.max(now, t.at);
        if (t.every === null) timers.delete(id);
        else t.at = now + t.every;
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

async function flush(rounds = 25) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ── minimal React (hooks + createElement) ─────────────────────────────────
function createReact() {
  const stores = new WeakMap();
  let current = { hooks: [], cursor: 0 };
  let dirty = false;

  function slot(init) {
    const i = current.cursor++;
    if (!(i in current.hooks)) current.hooks[i] = typeof init === "function" ? init() : init;
    return i;
  }

  return {
    begin(component) {
      let store = stores.get(component);
      if (!store) {
        store = { hooks: [], cursor: 0 };
        stores.set(component, store);
      }
      current = store;
      current.cursor = 0;
    },
    reset() {
      dirty = false;
    },
    isDirty: () => dirty,
    createElement(type, props, ...children) {
      const next = Object.assign({}, props || {});
      next.children = children.length <= 1 ? children[0] : children;
      return { type, props: next };
    },
    useState(init) {
      // capture the owning component: the setter may fire long after another
      // component began rendering
      const owner = current;
      const i = slot(init);
      return [
        owner.hooks[i],
        (v) => {
          const value = typeof v === "function" ? v(owner.hooks[i]) : v;
          if (!Object.is(value, owner.hooks[i])) {
            owner.hooks[i] = value;
            dirty = true;
          }
        },
      ];
    },
    useEffect(fn, deps) {
      const i = current.cursor++;
      const prev = current.hooks[i];
      const changed =
        !prev ||
        !deps ||
        prev.deps.length !== deps.length ||
        deps.some((d, k) => !Object.is(d, prev.deps[k]));
      if (!changed) return;
      if (process.env.DUN_DEBUG) {
        console.log(`  [debug-hook] effect#${i} run deps=${JSON.stringify(deps)}`);
      }
      if (prev && prev.cleanup) {
        try {
          prev.cleanup();
        } catch {}
      }
      const cleanup = fn();
      current.hooks[i] = { deps: deps ? deps.slice() : null, cleanup: typeof cleanup === "function" ? cleanup : null };
    },
    useRef(init) {
      const i = slot(() => ({ current: typeof init === "function" ? init() : init }));
      return current.hooks[i];
    },
    useMemo(fn) {
      return current.hooks[slot(fn)];
    },
  };
}

// ── DOM / storage stubs ───────────────────────────────────────────────────
function createDocument() {
  const listeners = new Map();
  return {
    visibilityState: "visible",
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ id: "", textContent: "", setAttribute() {}, remove() {} }),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
}

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const ZH = {
  "banner.loadingTitle": "正在检查更新",
  "banner.checkingHint": "正在获取版本信息…",
  "banner.upToDate": "已是最新版本",
  "banner.upToDateBody": "当前运行 {current}",
  "banner.errorTitle": "检查更新失败",
  "banner.errorRetry": "重试",
  "banner.timeout": "检查更新超时（长时间未获取到版本信息）",
  "banner.recheck": "立即检查",
  "banner.dismiss": "关闭",
};
const t = (key, params) =>
  String(ZH[key] || key).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));

// ── load the real client bundle ───────────────────────────────────────────
function loadClient(file, { react, clock, doc, storage, connection }) {
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => (definition = def) }, prompt() {} },
    document: doc,
    localStorage: storage,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    URLSearchParams,
    Date,
    Promise,
    JSON,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, "utf8"), sandbox, { filename: file });
  assert.ok(definition, "client bundle did not call window.__ModuleLoader__.load");

  const require = (id) => {
    if (id === "react") return react;
    throw new Error(`unexpected require(${id})`);
  };
  const mod = definition.factory(require);
  const captured = {};
  const ctx = {
    effect(fn) {
      return fn();
    },
    locale: { register: () => ({}) },
    slots: {
      inject(_name, body) {
        body();
      },
      register(def, component) {
        captured[def.id] = { def, component, props: def.inject() };
        return { dispose() {} };
      },
    },
    connection,
    logger: { info() {}, warn() {} },
  };
  mod.apply(ctx);
  return captured;
}

// ── host simulation ───────────────────────────────────────────────────────
const COMPLETED = {
  current: "0.1.5-rc.2",
  latest: "0.1.5-rc.1",
  next: "0.1.5-rc.2",
  npmTags: { alpha: "0.1.5-alpha.2", latest: "0.1.5-rc.1", next: "0.1.5-rc.2" },
  github: "0.1.5-rc.2",
  githubAhead: false,
  previews: [],
  hasUpdate: false,
  target: null,
  channel: null,
  source: null,
  checkedAt: "2026-09-14T01:55:47.678Z",
  error: null,
  checking: false,
};
// what the host returns while its own startup check is still in flight
const MID_CHECK = Object.assign({}, COMPLETED, { checkedAt: null, checking: true });

function createHost({ clock, doneAt = HOST_CHECK_DONE_AT, never = false, log }) {
  let completed = false;
  if (!never) {
    clock.setTimeout(() => {
      completed = true;
    }, doneAt);
  }
  return {
    rpc: {
      call(channel, endpoint) {
        // Record both; the protocol pin for the CURRENT bundle lives after the
        // scenarios so `--expect-*` can still drive pre-migration bundles, which
        // addressed a different channel.
        const name = String(endpoint).split("/").pop();
        log.push({ channel, endpoint, name, at: clock.now() });
        if (name === "getStatus") return Promise.resolve({ ok: true, value: completed ? COMPLETED : MID_CHECK });
        if (name === "checkNow") {
          if (completed) return Promise.resolve({ ok: true, value: COMPLETED });
          if (never) return new Promise(() => {});
          return new Promise((res) => {
            clock.setTimeout(() => res({ ok: true, value: COMPLETED }), Math.max(0, doneAt - clock.now()));
          });
        }
        return Promise.resolve({ ok: false, error: { code: "gateway/bad-request", message: "unknown", details: {} } });
      },
    },
  };
}

// ── drive one scenario ────────────────────────────────────────────────────
async function scenario({ never, doneAt = HOST_CHECK_DONE_AT }) {
  const clock = createClock();
  const react = createReact();
  const doc = createDocument();
  const calls = [];
  const host = createHost({ clock, never, doneAt, log: calls });
  const captured = loadClient(target, { react, clock, doc, storage: createStorage(), connection: host });

  const banner = captured["dsh-update-banner"];
  const dock = captured["dsh-update-dock"];
  assert.ok(banner && dock, "banner/dock slots were not registered");

  const tree = { current: null, dock: null };
  function renderOnce() {
    react.reset();
    react.begin(banner.component);
    tree.current = banner.component(Object.assign({ t }, banner.props));
    react.begin(dock.component);
    tree.dock = dock.component(Object.assign({ t }, dock.props));
  }
  async function settle() {
    renderOnce();
    for (let i = 0; i < 50; i++) {
      await flush();
      if (!react.isDirty()) break;
      renderOnce();
    }
    return tree.current;
  }

  const label = (node) => (node && node.props ? node.props["data-dsh-update"] || null : null);
  const timeline = [];
  const mark = async (at, note) => {
    await clock.advance(at - clock.now());
    const node = await settle();
    if (process.env.DUN_DEBUG) {
      const s = banner.props.store.getSnapshot();
      console.log(
        `  [debug] t=${clock.now()} phase=${s.phase} checkedAt=${s.checkedAt} checking=${s.checking} err=${s.error} timers=${clock.pending()}`
      );
    }
    timeline.push({ at, state: label(node), note });
    return node;
  };

  await mark(0, "mount");
  await mark(50, "first getStatus answered: host still checking (checkedAt=null)");
  await mark(2000, "2s after load");
  await mark(HOST_CHECK_DONE_AT + 500, "host check finished ~6s; nothing polls the host again");
  let timeoutState = null;
  if (never) {
    timeoutState = await mark(31000, "31s: check never answered");
    await clock.advance(60000);
  }

  return { timeline, calls, timeoutState: label(timeoutState), doc };
}

// ── assertions ────────────────────────────────────────────────────────────
const stuckRun = await scenario({ never: false });
console.log(`bundle: ${target}`);
for (const row of stuckRun.timeline) {
  console.log(`  t=${String(row.at).padStart(6)}ms  ${String(row.state).padEnd(18)} ${row.note}`);
}
console.log(`  rpc calls: ${stuckRun.calls.map((c) => `${c.endpoint}@${c.at}`).join(", ")}`);

const last = stuckRun.timeline[stuckRun.timeline.length - 1].state;
if (expectStuck) {
  assert.equal(last, "banner-loading", "expected the OLD bundle to stay stuck on the loading card");
  console.log("OK (expected pre-fix behaviour): still stuck on banner-loading\n");
} else {
  assert.notEqual(last, "banner-loading", "banner never recovered from the loading card");
  assert.equal(last, "banner-uptodate", "expected the recovered banner to show the up-to-date card");
  assert.ok(
    stuckRun.calls.some((c) => c.name === "checkNow"),
    "expected a checkNow retry to be issued"
  );
  console.log("OK: recovered from loading → banner-uptodate\n");
}

if (!expectStuck) {
  const deadRun = await scenario({ never: true });
  for (const row of deadRun.timeline) {
    console.log(`  [never-answers] t=${String(row.at).padStart(6)}ms  ${String(row.state).padEnd(18)} ${row.note}`);
  }
  assert.equal(deadRun.timeoutState, "banner-error", "a check that never answers must surface a retryable error");
  console.log("OK: unanswered check turns into a retryable banner-error");

  // fast path: host finished its check before the page asked → no retry, no spinner
  const fastRun = await scenario({ never: false, doneAt: 0 });
  for (const row of fastRun.timeline) {
    console.log(`  [host-already-done] t=${String(row.at).padStart(6)}ms  ${String(row.state).padEnd(18)} ${row.note}`);
  }
  assert.equal(fastRun.timeline[1].state, "banner-uptodate", "a completed host snapshot must render immediately");
  assert.equal(
    fastRun.calls.filter((c) => c.name === "checkNow").length,
    0,
    "a completed snapshot must not trigger retries"
  );
  console.log("OK: completed snapshot renders immediately, no extra checkNow");

  // Protocol pin for the CURRENT bundle only: the client half must address the
  // shared /api channel with its own endpoint namespace. (`--expect-stuck` runs
  // pre-migration bundles that used a different channel, so it is exempt.)
  const allCalls = [...stuckRun.calls, ...deadRun.calls, ...fastRun.calls];
  assert.ok(allCalls.length > 0, "expected the client half to issue at least one rpc call");
  for (const call of allCalls) {
    assert.equal(call.channel, "/api", `client half called channel ${JSON.stringify(call.channel)}`);
    assert.equal(call.endpoint, `dsh-update-rpc/${call.name}`, `client half called endpoint ${JSON.stringify(call.endpoint)}`);
  }
  console.log("OK: client half addresses /api with the dsh-update-rpc namespace");
}
