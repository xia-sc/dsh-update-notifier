/**
 * dsh-update-notifier — host half.
 *
 * npm 为准：只有 npm 的 latest/next 有比 current 新的版本才算 hasUpdate（正式更新）。
 *   - npm: registry.npmmirror.com primary → registry.npmjs.org fallback（全量 dist-tags，
 *     latest/next 为主通道，alpha/beta 等测试版只做提醒）
 *   - github: https://api.github.com/repos/deepseek-ai/deepseek-harness/tags（fallback scrape /tags page）
 *     GitHub 比 npm 新只做提醒（githubAhead + previews），不作为正式更新目标。
 * Exposes /dsh-update-rpc for the browser half:
 *   - getStatus → current/latest/next/npmTags/github/githubAhead/previews + hasUpdate/target/channel/source
 *   - checkNow  → force re-fetch
 *
 * Failures are logged and surfaced as `error` in RPC so client can show "check failed".
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const name = "dsh-update-notifier";
const inject = ["connection"];

// ── semver compare (supports x.y.z, x.y.z-rc.n, x.y.z-next.n) ──
function parseSemver(v) {
  const raw = String(v).trim();
  // split core and prerelease: 0.1.0-rc.8 -> ["0.1.0","rc.8"]
  const dash = raw.indexOf("-");
  let core = raw;
  let pre = null;
  if (dash !== -1) {
    core = raw.slice(0, dash);
    pre = raw.slice(dash + 1);
  }
  const nums = core.split(".").map((n) => {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  });
  while (nums.length < 3) nums.push(0);
  let preParts = null;
  if (pre !== null) {
    // rc.8 => ["rc",8], rc8 => ["rc",8], next => ["next",0]
    const m = pre.match(/^([a-zA-Z]+)[.-]?(\d+)?$/);
    if (m) {
      preParts = { tag: m[1].toLowerCase(), num: m[2] != null ? Number(m[2]) : 0 };
    } else {
      preParts = { tag: pre.toLowerCase(), num: 0 };
    }
  }
  return { nums, pre: preParts, raw };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  // core equal -> release > prerelease
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  // both prerelease: rc < next < ??? use tag lexical, but give rc < next ordering explicitly
  const tagOrder = { rc: 1, next: 2, beta: 1, alpha: 0 };
  const oa = tagOrder[pa.pre.tag] ?? 10;
  const ob = tagOrder[pb.pre.tag] ?? 10;
  if (oa !== ob) return oa > ob ? 1 : -1;
  if (pa.pre.tag !== pb.pre.tag) return pa.pre.tag > pb.pre.tag ? 1 : -1;
  if (pa.pre.num !== pb.pre.num) return pa.pre.num > pb.pre.num ? 1 : -1;
  return 0;
}

function getCurrentVersion() {
  // 1) resolve via require
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@deepseek-ai/dsh/package.json");
    if (pkg && typeof pkg.version === "string" && pkg.version.trim() !== "") return pkg.version.trim();
  } catch {}
  // 2) try reading relative to this package (should resolve via node_modules upward)
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("@deepseek-ai/dsh/package.json");
    const text = readFileSync(resolved, "utf8");
    const j = JSON.parse(text);
    if (j && typeof j.version === "string") return j.version.trim();
  } catch {}
  // 3) fallback: profile install via homedir / DSH_HOME
  try {
    const home = process.env.DSH_HOME || join(homedir(), ".dsh");
    const p = join(home, "profiles", "node_modules", "@deepseek-ai", "dsh", "package.json");
    const text = readFileSync(p, "utf8");
    const j = JSON.parse(text);
    if (j && typeof j.version === "string") return j.version.trim();
  } catch {}
  // 4) fallback: DSH global install (node prefix)
  try {
    const p = join(process.execPath, "..", "..", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json");
    const text = readFileSync(p, "utf8");
    const j = JSON.parse(text);
    if (j && typeof j.version === "string") return j.version.trim();
  } catch {}
  return "0.0.0";
}

async function fetchJson(url, timeoutMs, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: headers || { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: headers || { accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function pickTarget(latest, next, current) {
  // Prefer the highest version among latest/next that is > current.
  // If both > current, pick the higher one.
  let candidate = null;
  let channel = null;
  if (latest && compareSemver(latest, current) > 0) {
    candidate = latest;
    channel = "latest";
  }
  if (next && compareSemver(next, current) > 0) {
    if (candidate === null || compareSemver(next, candidate) > 0) {
      candidate = next;
      channel = "next";
    }
  }
  return { candidate, channel };
}

function normalizeTag(v) {
  let s = String(v).trim();
  // strip common prefixes: "dsh-v", "dsh-" then "v"
  if (s.toLowerCase().startsWith("dsh-")) s = s.slice(4);
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  return s;
}

async function fetchGithubLatest(timeoutMs) {
  // Try twice: first normal, then with insecure TLS for hijacked networks
  for (let attempt = 0; attempt < 2; attempt++) {
    const insecure = attempt === 1;
    if (insecure) {
      // This env is read by Node's fetch/undici; setting it at runtime
      // makes the retry succeed on networks with UNABLE_TO_VERIFY_LEAF_SIGNATURE
      // (observed on this dev machine for api.github.com). Only set if cert failed.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    // 1) GitHub API: /tags?per_page=100  (requires User-Agent)
    try {
      const data = await fetchJson(
        "https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=100",
        timeoutMs,
        {
          accept: "application/vnd.github+json",
          "user-agent": "dsh-update-notifier",
          "X-GitHub-Api-Version": "2022-11-28",
        }
      );
      if (Array.isArray(data)) {
        let best = null;
        for (const item of data) {
          if (!item || typeof item.name !== "string") continue;
          const v = normalizeTag(item.name);
          if (!/^\d+\.\d+\.\d+/.test(v)) continue;
          try {
            parseSemver(v);
          } catch {
            continue;
          }
          if (best === null || compareSemver(v, best) > 0) best = v;
        }
        if (best !== null) return best;
      }
    } catch (e) {
      const msg = [e?.message, e?.cause?.message, e?.cause?.cause?.message, e?.cause?.code].filter(Boolean).join(" ");
      const isCert = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|self signed/i.test(msg);
      if (isCert && !insecure) continue; // retry with insecure
      // otherwise fall through to HTML fallback within same attempt
    }
    // 2) Fallback: scrape https://github.com/deepseek-ai/deepseek-harness/tags
    try {
      const html = await fetchText(
        "https://github.com/deepseek-ai/deepseek-harness/tags",
        timeoutMs,
        {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "dsh-update-notifier",
        }
      );
      const re = /\/deepseek-ai\/deepseek-harness\/releases\/tag\/(?:dsh-)?v?([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)/gi;
      let best = null;
      let m;
      while ((m = re.exec(html)) !== null) {
        const v = m[1].trim();
        if (!/^\d+\.\d+\.\d+/.test(v)) continue;
        if (best === null || compareSemver(v, best) > 0) best = v;
      }
      if (best !== null) return best;
    } catch (e) {
      const msg = [e?.message, e?.cause?.message, e?.cause?.cause?.message, e?.cause?.code].filter(Boolean).join(" ");
      const isCert = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|self signed/i.test(msg);
      if (isCert && !insecure) continue;
    }
    if (insecure) break;
  }
  return null;
}

// 主通道：只有 latest/next 算正式更新；alpha/beta 等测试版只做提醒。
const MAIN_NPM_TAGS = ["latest", "next"];

function sanitizeVersion(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d+\.\d+\.\d+/.test(s)) return null;
  try {
    parseSemver(s);
  } catch {
    return null;
  }
  return s;
}

function collectNpmTags(distTags) {
  const tags = {};
  if (distTags && typeof distTags === "object") {
    for (const [tag, v] of Object.entries(distTags)) {
      const s = sanitizeVersion(v);
      if (s !== null) tags[String(tag)] = s;
    }
  }
  return tags;
}

// 正式更新目标：只看 latest/next 里比 current 新的最大者。
function pickNpmTarget(npmTags, current) {
  let candidate = null;
  let channel = null;
  for (const tag of MAIN_NPM_TAGS) {
    const v = npmTags[tag];
    if (!v) continue;
    let cmp = 0;
    try {
      cmp = compareSemver(v, current);
    } catch {
      continue;
    }
    if (cmp > 0 && (candidate === null || compareSemver(v, candidate) > 0)) {
      candidate = v;
      channel = tag;
    }
  }
  if (candidate !== null) return { candidate, channel, source: "npm" };
  return { candidate: null, channel: null, source: null };
}

// 提醒项：非主通道的 npm tag（alpha/beta/…）比 current 新，或 GitHub 有 npm 里没有的新版本。
function buildPreviews(npmTags, github, current, mainTarget) {
  const previews = [];
  for (const [tag, version] of Object.entries(npmTags)) {
    if (MAIN_NPM_TAGS.includes(tag)) continue;
    let cmp = 0;
    try {
      cmp = compareSemver(version, current);
    } catch {
      continue;
    }
    if (cmp <= 0) continue;
    if (mainTarget) {
      try {
        if (compareSemver(version, mainTarget) === 0) continue;
      } catch {}
    }
    previews.push({ kind: "npm", tag, version, cmd: `npm i -g @deepseek-ai/dsh@${tag}` });
  }
  previews.sort((a, b) => {
    try {
      return compareSemver(b.version, a.version);
    } catch {
      return 0;
    }
  });
  let githubAhead = false;
  if (github) {
    try {
      if (compareSemver(github, current) > 0) {
        const inNpm = Object.values(npmTags).some((v) => {
          try {
            return compareSemver(v, github) === 0;
          } catch {
            return false;
          }
        });
        if (!inNpm) {
          let aheadOfAll = true;
          for (const v of Object.values(npmTags)) {
            try {
              if (compareSemver(github, v) <= 0) {
                aheadOfAll = false;
                break;
              }
            } catch {}
          }
          githubAhead = aheadOfAll;
          previews.push({ kind: "github", tag: "github", version: github, ahead: aheadOfAll, cmd: null });
        }
      }
    } catch {}
  }
  return { previews, githubAhead };
}

function apply(ctx) {
  const current = getCurrentVersion();

  let state = {
    current,
    latest: null,
    next: null,
    npmTags: {},
    github: null,
    githubAhead: false,
    previews: [],
    hasUpdate: false,
    target: null,
    channel: null,
    source: null,
    checkedAt: null,
    error: null,
    checking: false,
  };

  let inflight = null;

  async function doCheck() {
    if (inflight) return inflight;
    state.checking = true;
    inflight = (async () => {
      const registries = [
        "https://registry.npmmirror.com/@deepseek-ai/dsh",
        "https://registry.npmjs.org/@deepseek-ai/dsh",
      ];
      let npmTags = {};
      let github = null;
      let lastError = null;

      // fetch npm (npmmirror primary → npmjs fallback) and github in parallel
      const npmPromise = (async () => {
        for (const base of registries) {
          try {
            const data = await fetchJson(base, 8000);
            const tags = collectNpmTags(data["dist-tags"] || {});
            if (Object.keys(tags).length > 0) return { tags };
            lastError = new Error("empty dist-tags");
          } catch (e) {
            lastError = e;
            const wl = `[dsh-update-notifier] registry ${base} failed: ${e?.message || e}`;
            ctx.logger?.warn?.(wl);
            try { console.warn(wl); } catch {}
          }
        }
        return { tags: {} };
      })();

      const githubPromise = fetchGithubLatest(8000).catch((e) => {
        const wl = `[dsh-update-notifier] github tags failed: ${e?.message || e}`;
        ctx.logger?.warn?.(wl);
        try { console.warn(wl); } catch {}
        return null;
      });

      try {
        const [npmRes, githubRes] = await Promise.all([npmPromise, githubPromise]);
        npmTags = npmRes.tags || {};
        github = githubRes || null;
      } catch (e) {
        lastError = e;
      }

      // if both sources failed
      if (Object.keys(npmTags).length === 0 && github === null) {
        state.checkedAt = new Date().toISOString();
        state.error = lastError ? String(lastError.message || lastError) : "all sources failed";
        state.checking = false;
        inflight = null;
        const errLine = `[dsh-update-notifier] all sources failed: ${state.error}`;
        ctx.logger?.warn?.(errLine);
        try { console.warn(errLine); } catch {}
        return { ...state };
      }

      // npm 为准：正式更新只看 latest/next；alpha 等与 GitHub 超前只进 previews 做提醒
      const latest = npmTags.latest || null;
      const next = npmTags.next || null;
      const { candidate, channel, source } = pickNpmTarget(npmTags, state.current);
      const { previews, githubAhead } = buildPreviews(npmTags, github, state.current, candidate);
      state.latest = latest;
      state.next = next;
      state.npmTags = { ...npmTags };
      state.github = github;
      state.githubAhead = githubAhead;
      state.previews = previews;
      state.hasUpdate = candidate !== null;
      state.target = candidate;
      state.channel = channel;
      state.source = source;
      state.checkedAt = new Date().toISOString();
      state.error = null;
      state.checking = false;
      inflight = null;
      const line = `[dsh-update-notifier] check ok: current=${state.current} latest=${latest} next=${next} npmTags=${JSON.stringify(npmTags)} github=${github} hasUpdate=${state.hasUpdate} target=${candidate} channel=${channel} previews=${previews.length} githubAhead=${githubAhead} checkedAt=${state.checkedAt}`;
      ctx.logger?.info?.(line);
      try { console.log(line); } catch {}
      try { console.log("[dsh-update-notifier] full", JSON.stringify({ current: state.current, latest, next, npmTags, github, githubAhead, previews, hasUpdate: state.hasUpdate, target: candidate, channel, source, checkedAt: state.checkedAt })); } catch {}
      return { ...state };
    })();
    return inflight;
  }

  // schedule: 1s after startup + every 6h (1s to avoid backend-restart blank popup)
  let timerStartup = null;
  let timerInterval = null;

  ctx.effect(() => {
    timerStartup = setTimeout(() => {
      doCheck().catch(() => {});
    }, 1000);
    timerInterval = setInterval(() => {
      doCheck().catch(() => {});
    }, 6 * 60 * 60 * 1000);
    // also do one immediate attempt in case startup missed? keep lazy to avoid blocking boot
    return () => {
      if (timerStartup) clearTimeout(timerStartup);
      if (timerInterval) clearInterval(timerInterval);
      timerStartup = null;
      timerInterval = null;
    };
  }, "dsh-update-notifier: timers");

  function ok(value) {
    return { ok: true, value };
  }
  function fail(code, message, details = {}) {
    return { ok: false, error: { code: "internal", message, details: Object.assign({}, details, { code }) } };
  }

  ctx.connection.rpc.handle(
    "/dsh-update-rpc",
    async (endpoint, payload, signal) => {
      void signal;
      switch (endpoint) {
        case "getStatus":
          // if never checked, return cached state; client can call checkNow to force
          return ok({ ...state });
        case "checkNow": {
          const res = await doCheck();
          return ok({ ...res });
        }
        case "compare": {
          // debug helper: compare two versions
          const args = payload?.args || {};
          const a = String(args.a || "");
          const b = String(args.b || "");
          if (!a || !b) return fail("invalid-args", "a and b required");
          return ok({ result: compareSemver(a, b) });
        }
        default:
          return fail("unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
      }
    },
    { authority: "trusted-host" }
  );

  ctx.logger?.info?.(`[dsh-update-notifier] mounted, current=${current}`);
}

export { apply, inject, name };
