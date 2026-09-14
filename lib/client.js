/**
 * dsh-update-notifier — browser half.
 *
 * Checks host RPC for newer DSH and shows a dismissible card.
 * - shell.overlay → UpdateBanner (fixed top-center)
 * - conversation.input.dock → tiny pill when banner dismissed but update still available (quick reopen)
 *
 * Styling notes: every colour comes from a real `--dsw-alias-*` / `--dsw-*` theme
 * variable so the card follows light and dark themes. Component-local rules
 * (hover, focus, animation) live in one injected <style> owned by the plugin
 * fiber; the React tree only carries class names.
 */
window.__ModuleLoader__.load({
  id: "dsh-update-notifier",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var name = "dsh-update-notifier";
    var inject = ["slots", "connection", "locale"];

    var NS = "dshUpdate";

    var zh = {
      "banner.title": "发现 DSH 新版本",
      "banner.body": "当前 {current} → 最新 {target}（{channel} 通道）",
      "banner.latest": "最新版",
      "banner.next": "预发布",
      "banner.github": "GitHub 标签",
      "banner.dismiss": "关闭",
      "banner.recheck": "立即检查",
      "banner.checking": "检查中…",
      "banner.loadingTitle": "正在检查更新",
      "banner.checkingHint": "正在获取版本信息…",
      "banner.pin": "常驻",
      "banner.unpin": "取消常驻",
      "banner.pinTitle": "保持提示框常驻显示",
      "banner.copyCmd": "复制更新命令",
      "banner.copy": "复制",
      "banner.copied": "已复制",
      "banner.retry": "重试",
      "banner.viewRelease": "更新说明",
      "banner.viewTags": "GitHub Tags",
      "banner.viewNpm": "npm",
      "banner.checkedAt": "上次检查：{time}",
      "banner.upToDate": "已是最新版本",
      "banner.upToDateBody": "当前运行 {current}，npm 上没有更新的版本",
      "banner.errorTitle": "检查更新失败",
      "banner.error": "检查失败：{msg}",
      "banner.errorRetry": "重试",
      "banner.timeout": "检查更新超时（长时间未获取到版本信息）",
      "banner.cur": "当前",
      "banner.new": "最新",
      "banner.cross": "npm: {latest} / {next} · GitHub: {github}",
      "banner.sourceBoth": "GitHub 与 npm 一致",
      "banner.sourceGithub": "GitHub 已有新版本，npm 尚未发布，仅作提醒",
      "banner.sourceNpm": "npm 有新版本",
      "preview.title": "其他提醒",
      "preview.npm": "测试版提醒 {tag}：{version}",
      "preview.github": "GitHub 已有 {version}，npm 尚未发布",
      "preview.copy": "复制",
      "dock.update": "有更新 {target}",
      "dock.aria": "查看 DSH 更新",
      "cmd": "npm i -g @deepseek-ai/dsh@{tag}",
    };

    var en = {
      "banner.title": "DSH update available",
      "banner.body": "{current} → {target} ({channel})",
      "banner.latest": "latest",
      "banner.next": "next",
      "banner.github": "GitHub tag",
      "banner.dismiss": "Dismiss",
      "banner.recheck": "Check now",
      "banner.checking": "Checking…",
      "banner.loadingTitle": "Checking for updates",
      "banner.checkingHint": "Fetching version info…",
      "banner.pin": "Pin",
      "banner.unpin": "Unpin",
      "banner.pinTitle": "Keep the notice pinned",
      "banner.copyCmd": "Copy update command",
      "banner.copy": "Copy",
      "banner.copied": "Copied",
      "banner.retry": "Retry",
      "banner.viewRelease": "Release notes",
      "banner.viewTags": "GitHub tags",
      "banner.viewNpm": "npm",
      "banner.checkedAt": "Checked {time}",
      "banner.upToDate": "Up to date",
      "banner.upToDateBody": "Running {current}; no newer release on npm",
      "banner.errorTitle": "Update check failed",
      "banner.error": "Check failed: {msg}",
      "banner.errorRetry": "Retry",
      "banner.timeout": "Update check timed out (no version info received)",
      "banner.cur": "Current",
      "banner.new": "Latest",
      "banner.cross": "npm: {latest} / {next} · GitHub: {github}",
      "banner.sourceBoth": "GitHub and npm agree",
      "banner.sourceGithub": "GitHub is ahead of npm — notice only",
      "banner.sourceNpm": "npm has an update",
      "preview.title": "More notices",
      "preview.npm": "Prerelease {tag}: {version}",
      "preview.github": "GitHub has {version}, not yet on npm",
      "preview.copy": "Copy",
      "dock.update": "Update {target}",
      "dock.aria": "View DSH update",
      "cmd": "npm i -g @deepseek-ai/dsh@{tag}",
    };

    var NPM_URL = "https://www.npmjs.com/package/@deepseek-ai/dsh";
    var RELEASES_URL = "https://github.com/deepseek-ai/deepseek-harness/releases";
    var TAGS_URL = "https://github.com/deepseek-ai/deepseek-harness/tags";

    // ── element / icon helpers ────────────────────────────────────────────

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }

    /** Minimal stroke icon set; every glyph is path-only so no JSX is needed. */
    var ICONS = {
      check: ["M20 6 9 17l-5-5"],
      alert: ["M12 9v4", "M12 17h.01", "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"],
      arrowUp: ["M12 19V5", "m5 12 7-7 7 7"],
      arrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
      refresh: ["M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16", "M16 16h5v5"],
      pin: ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"],
      close: ["M18 6 6 18", "m6 6 12 12"],
      copy: ["M9 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z", "M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"],
      external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
      github: ["M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"],
    };

    function icon(glyph, size) {
      var paths = ICONS[glyph] || [];
      var side = size || 14;
      return React.createElement(
        "svg",
        {
          className: "dun-ico",
          width: side,
          height: side,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.9,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        paths.map(function (d, i) {
          return React.createElement("path", { key: i, d: d });
        })
      );
    }

    // ── component stylesheet (owned by the plugin fiber) ──────────────────

    var STYLE_ID = "dsh-update-notifier:styles";

    var CSS = [
      /* card --------------------------------------------------------------- */
      ".dun-card{--dun-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);" +
        "--dun-fill:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));" +
        "--dun-fill-strong:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));" +
        "--dun-fg:var(--dsw-alias-label-primary,#f9fafb);" +
        "--dun-fg-2:var(--dsw-alias-label-secondary,#cfd3d6);" +
        "--dun-fg-3:var(--dsw-alias-label-tertiary,#adb2b8);" +
        "--dun-fg-4:var(--dsw-alias-label-caption,#81858c);" +
        "--dun-line:var(--dsw-alias-border-l2,rgba(127,127,127,.24));" +
        "--dun-line-2:var(--dsw-alias-border-l3,rgba(127,127,127,.34));" +
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:40;" +
        "width:min(560px,calc(100vw - 24px));box-sizing:border-box;" +
        "display:flex;flex-direction:column;border-radius:14px;overflow:hidden;" +
        "background:var(--dsw-alias-bg-layer-1,#232324);border:1px solid var(--dun-line-2);" +
        "box-shadow:var(--dsw-elevation-prominent,0 3px 8px rgba(0,0,0,.06)),var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.16));" +
        "color:var(--dun-fg);font-family:var(--dsw-font-family,inherit);pointer-events:auto;" +
        "animation:dun-in .2s cubic-bezier(.22,.61,.36,1)}",
      ".dun-card,.dun-card *{box-sizing:border-box}",
      ".dun-card[data-state=up]{--dun-accent:var(--dsw-alias-state-success-primary,#22c55e)}",
      ".dun-card[data-state=new]{--dun-accent:var(--dsw-alias-state-business-primary,#679efe)}",
      ".dun-card[data-state=err]{--dun-accent:var(--dsw-alias-state-warn-primary,#f59e0b)}",
      ".dun-card[data-state=load]{--dun-accent:var(--dsw-alias-label-tertiary,#adb2b8)}",
      ".dun-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;" +
        "background:linear-gradient(90deg,transparent,var(--dun-accent),transparent);opacity:.85}",
      "@keyframes dun-in{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}",
      "@media (prefers-reduced-motion:reduce){.dun-card{animation:none}}",

      /* header -------------------------------------------------------------- */
      ".dun-hd{display:flex;align-items:center;gap:10px;padding:12px 10px 10px 12px;border-bottom:1px solid var(--dun-line)}",
      ".dun-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:9px;" +
        "color:var(--dun-accent);background:rgba(127,127,127,.14);" +
        "background:color-mix(in srgb,var(--dun-accent) 16%,transparent)}",
      ".dun-title{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;line-height:20px;color:var(--dun-fg)}",
      ".dun-titleText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dun-chip{flex:none;padding:2px 8px;border-radius:999px;font-family:var(--dun-mono);font-size:11px;line-height:16px;font-weight:600;" +
        "color:var(--dun-accent);background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--dun-accent) 14%,transparent);" +
        "border:1px solid rgba(127,127,127,.3);border-color:color-mix(in srgb,var(--dun-accent) 30%,transparent);white-space:nowrap}",
      ".dun-ico{display:block;flex:none}",
      ".dun-actions{display:flex;align-items:center;gap:2px;flex:none}",

      /* icon buttons -------------------------------------------------------- */
      ".dun-ibtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;" +
        "background:transparent;color:var(--dun-fg-3);cursor:pointer;transition:background .12s,color .12s}",
      ".dun-ibtn:hover{background:var(--dun-fill);color:var(--dun-fg)}",
      ".dun-ibtn:active{background:var(--dun-fill-strong)}",
      ".dun-ibtn[data-on='1']{color:var(--dun-accent);background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--dun-accent) 14%,transparent)}",
      ".dun-ibtn:disabled{opacity:.5;cursor:default}",
      ".dun-ibtn:disabled:hover{background:transparent;color:var(--dun-fg-3)}",
      ".dun-spin{animation:dun-spin .9s linear infinite}",
      "@keyframes dun-spin{to{transform:rotate(360deg)}}",

      /* body ---------------------------------------------------------------- */
      ".dun-body{display:flex;flex-direction:column;gap:10px;padding:12px}",
      ".dun-vers{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".dun-ver{display:inline-flex;align-items:baseline;gap:6px;min-width:0;padding:3px 9px;border-radius:9px;" +
        "background:var(--dun-fill);border:1px solid var(--dun-line)}",
      ".dun-verK{flex:none;font-size:11px;line-height:16px;color:var(--dun-fg-3)}",
      ".dun-verV{font-family:var(--dun-mono);font-size:12px;line-height:16px;color:var(--dun-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dun-ver[data-tone=new]{background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--dun-accent) 13%,transparent);" +
        "border-color:color-mix(in srgb,var(--dun-accent) 32%,transparent)}",
      ".dun-ver[data-tone=new] .dun-verV{color:var(--dun-accent);font-weight:600}",
      ".dun-arrow{display:inline-flex;flex:none;color:var(--dun-fg-4)}",
      ".dun-line{font-size:12px;line-height:18px;color:var(--dun-fg-2)}",
      ".dun-note{font-size:11px;line-height:16px;color:var(--dun-fg-3)}",
      ".dun-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
      ".dun-note[data-tone=err]{color:var(--dsw-alias-state-warn-primary,#f59e0b);font-size:12px;line-height:18px;word-break:break-word}",

      /* version source chips ------------------------------------------------ */
      ".dun-tags{display:flex;flex-wrap:wrap;gap:5px}",
      ".dun-tag{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;line-height:16px;" +
        "color:var(--dun-fg-2);background:var(--dun-fill);border:1px solid var(--dun-line)}",
      ".dun-tagK{color:var(--dun-fg-3)}",
      ".dun-tagV{font-family:var(--dun-mono);color:var(--dun-fg)}",
      ".dun-tag[data-cur='1']{background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--dun-accent) 12%,transparent);" +
        "border-color:color-mix(in srgb,var(--dun-accent) 38%,transparent)}",
      ".dun-tag[data-cur='1'] .dun-tagV{color:var(--dun-accent);font-weight:600}",
      ".dun-tagCur{font-size:10px;line-height:14px;color:var(--dun-accent);opacity:.85}",

      /* command row --------------------------------------------------------- */
      ".dun-cmd{display:flex;align-items:center;gap:8px;padding:4px 4px 4px 10px;border-radius:10px;" +
        "background:var(--dsw-alias-markdown-code-block,#1b1b1c);border:1px solid var(--dun-line)}",
      ".dun-cmdCode{flex:1;min-width:0;font-family:var(--dun-mono);font-size:12px;line-height:22px;color:var(--dun-fg);" +
        "white-space:pre;overflow-x:auto;user-select:all;scrollbar-width:none}",
      ".dun-cmdCode::-webkit-scrollbar{display:none}",

      /* buttons / links ----------------------------------------------------- */
      ".dun-btnPrimary{display:inline-flex;align-items:center;gap:5px;flex:none;height:26px;padding:0 10px;border:0;border-radius:8px;" +
        "background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);" +
        "font:inherit;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background .12s,opacity .12s}",
      ".dun-btnPrimary:hover{background:var(--dsw-alias-button-primary-hover,#ebeef2)}",
      ".dun-btnGhost{display:inline-flex;align-items:center;gap:5px;flex:none;height:26px;padding:0 9px;border-radius:8px;" +
        "background:transparent;border:1px solid var(--dun-line);color:var(--dun-fg-2);" +
        "font:inherit;font-size:11.5px;line-height:16px;white-space:nowrap;text-decoration:none;cursor:pointer;transition:background .12s,color .12s,border-color .12s}",
      ".dun-btnGhost:hover{background:var(--dun-fill);border-color:var(--dun-line-2);color:var(--dun-fg)}",
      ".dun-btnGhost:active{background:var(--dun-fill-strong)}",
      ".dun-btnGhost .dun-ico{opacity:.7}",
      ".dun-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".dun-footSpacer{flex:1;min-width:8px}",
      ".dun-caption{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#adb2b8);white-space:nowrap}",
      ".dun-card button:focus-visible,.dun-card a:focus-visible{outline:2px solid var(--dun-accent);outline-offset:2px}",

      /* secondary notices --------------------------------------------------- */
      ".dun-more{display:flex;flex-direction:column;gap:7px;padding:9px 10px;border-radius:10px;" +
        "background:var(--dun-fill);border:1px dashed var(--dun-line-2)}",
      ".dun-moreHd{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;font-weight:600;color:var(--dun-fg-3)}",
      ".dun-moreRow{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dun-fg-2)}",
      ".dun-moreTxt{flex:1;min-width:0;word-break:break-all}",
      ".dun-moreMeta{font-family:var(--dun-mono);color:var(--dun-fg-3)}",

      /* loading ------------------------------------------------------------- */
      ".dun-loading{display:flex;align-items:center;gap:10px;padding:13px 14px}",

      /* dock pill ----------------------------------------------------------- */
      ".dun-dockRow{box-sizing:border-box;display:flex;justify-content:flex-start;width:100%;margin:2px 0;" +
        "padding-left:calc((100% - var(--dsh-composer-card-max-width,778px)) / 2)}",
      ".dun-dock{display:inline-flex;align-items:center;gap:6px;max-width:280px;height:24px;padding:0 10px;border-radius:999px;" +
        "border:1px solid rgba(127,127,127,.3);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#679efe) 38%,transparent);" +
        "background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#679efe) 12%,transparent);" +
        "color:var(--dsw-alias-state-business-primary,#679efe);font:inherit;font-size:12px;line-height:22px;" +
        "cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none;transition:background .12s}",
      ".dun-dock:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#679efe) 20%,transparent)}",
      ".dun-dock:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#679efe);outline-offset:2px}",
    ].join("\n");

    /** Own one <style> tag for as long as the plugin fiber lives. */
    function ensureStyles(doc) {
      if (!doc || !doc.head) return function () {};
      var existing = doc.getElementById(STYLE_ID);
      if (existing) return function () {};
      var el = doc.createElement("style");
      el.id = STYLE_ID;
      el.setAttribute("data-dsh-plugin", "dsh-update-notifier");
      el.textContent = CSS;
      doc.head.appendChild(el);
      return function () {
        try {
          el.remove();
        } catch (e) {
          /* ignore */
        }
      };
    }

    function rpc(ctx, endpoint, args) {
      return ctx.connection.rpc.call("/dsh-update-rpc", endpoint, { args: args || {} });
    }

    function formatTime(iso) {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleString();
      } catch (e) {
        return String(iso);
      }
    }

    // localStorage dismissed helpers
    function dismissedKey(target) {
      return "dsh-update-notifier:dismissed:" + String(target || "");
    }
    function isDismissed(target) {
      if (!target) return false;
      try {
        return localStorage.getItem(dismissedKey(target)) === "1";
      } catch (e) {
        return false;
      }
    }
    function setDismissed(target) {
      try {
        localStorage.setItem(dismissedKey(target), "1");
      } catch (e) {}
    }
    function clearDismissed(target) {
      try {
        localStorage.removeItem(dismissedKey(target));
      } catch (e) {}
    }
    function pinnedKey() {
      return "dsh-update-notifier:pinned";
    }
    function isPinned() {
      try {
        return localStorage.getItem(pinnedKey()) === "1";
      } catch (e) {
        return false;
      }
    }
    function setPinned(v) {
      try {
        if (v) localStorage.setItem(pinnedKey(), "1");
        else localStorage.removeItem(pinnedKey());
      } catch (e) {}
    }

    function copyText(text, done) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(function () {
            done(true);
          })
          .catch(function () {
            try {
              window.prompt("Copy command:", text);
            } catch (e) {}
            done(false);
          });
      } else {
        try {
          window.prompt("Copy command:", text);
        } catch (e) {}
        done(false);
      }
    }

    function createStore(ctx) {
      var state = {
        phase: "idle", // idle | loading | ready | error
        current: null,
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
      var listeners = new Set();
      var seq = 0;

      function emit(next) {
        state = next;
        for (var fn of Array.from(listeners)) {
          try {
            fn();
          } catch (e) {
            console.error("[dsh-update-notifier] listener", e);
          }
        }
      }
      function getSnapshot() {
        return state;
      }
      function subscribe(fn) {
        listeners.add(fn);
        return function () {
          listeners.delete(fn);
        };
      }
      function touch() {
        emit(Object.assign({}, state));
      }
      function setDismissedStore(target) {
        setDismissed(target);
        touch();
      }
      function clearDismissedStore(target) {
        clearDismissed(target);
        touch();
      }
      function isDismissedStore(target) {
        return isDismissed(target);
      }

      // Escape hatch: a check that never answers must become a visible,
      // retryable error instead of an endless spinner.
      function markStalled(message) {
        if (state.checkedAt !== null || state.error) return;
        console.warn("[dsh-update-notifier] " + message);
        emit(Object.assign({}, state, { phase: "error", error: message, checking: false }));
      }

      function applyResult(res) {
        if (!res || res.ok !== true) {
          var msg = res && res.error && res.error.message ? String(res.error.message) : "rpc failed";
          try {
            console.warn("[dsh-update-notifier] rpc error", msg, res);
          } catch (e) {}
          emit(Object.assign({}, state, { phase: "error", error: msg, checking: false }));
          return;
        }
        var v = res.value || {};
        try {
          console.log(
            "[dsh-update-notifier] query result",
            JSON.stringify({
              current: v.current,
              latest: v.latest,
              next: v.next,
              npmTags: v.npmTags,
              github: v.github,
              githubAhead: v.githubAhead,
              previews: v.previews,
              hasUpdate: v.hasUpdate,
              target: v.target,
              channel: v.channel,
              source: v.source,
              checkedAt: v.checkedAt,
              error: v.error,
            })
          );
          if (v.hasUpdate) console.log("[dsh-update-notifier] update available (npm): " + v.current + " → " + v.target + " (" + v.channel + ")");
          else console.log("[dsh-update-notifier] npm up to date: " + v.current + " (npmTags:" + JSON.stringify(v.npmTags) + " github:" + v.github + " previews:" + (v.previews || []).length + ")");
        } catch (e) {}
        emit({
          phase: "ready",
          current: v.current || null,
          latest: v.latest || null,
          next: v.next || null,
          npmTags: v.npmTags && typeof v.npmTags === "object" ? v.npmTags : {},
          github: v.github || null,
          githubAhead: v.githubAhead === true,
          previews: Array.isArray(v.previews) ? v.previews : [],
          hasUpdate: v.hasUpdate === true,
          target: v.target || null,
          channel: v.channel || null,
          source: v.source || null,
          checkedAt: v.checkedAt || null,
          error: v.error || null,
          checking: v.checking === true,
        });
      }

      function refresh() {
        var mySeq = ++seq;
        try {
          console.log("[dsh-update-notifier] refresh getStatus...");
        } catch (e) {}
        emit(Object.assign({}, state, { phase: state.phase === "idle" ? "loading" : state.phase, checking: true, error: null }));
        return rpc(ctx, "getStatus", {})
          .then(function (res) {
            if (mySeq !== seq) return;
            applyResult(res);
          })
          .catch(function (e) {
            if (mySeq !== seq) return;
            try {
              console.warn("[dsh-update-notifier] refresh failed", e);
            } catch (e2) {}
            emit(Object.assign({}, state, { phase: "error", error: String((e && e.message) || e), checking: false }));
          });
      }

      function checkNow() {
        var mySeq = ++seq;
        try {
          console.log("[dsh-update-notifier] checkNow...");
        } catch (e) {}
        emit(Object.assign({}, state, { checking: true, error: null }));
        return rpc(ctx, "checkNow", {})
          .then(function (res) {
            if (mySeq !== seq) return;
            applyResult(res);
          })
          .catch(function (e) {
            if (mySeq !== seq) return;
            try {
              console.warn("[dsh-update-notifier] checkNow failed", e);
            } catch (e2) {}
            emit(Object.assign({}, state, { checking: false, error: String((e && e.message) || e), phase: "error" }));
          });
      }

      return {
        getSnapshot: getSnapshot,
        subscribe: subscribe,
        refresh: refresh,
        checkNow: checkNow,
        stalled: markStalled,
        touch: touch,
        setDismissed: setDismissedStore,
        clearDismissed: clearDismissedStore,
        isDismissed: isDismissedStore,
      };
    }

    // ── shared view helpers ───────────────────────────────────────────────

    function IconButton(opts) {
      return h(
        "button",
        {
          key: opts.key,
          type: "button",
          className: opts.className ? "dun-ibtn " + opts.className : "dun-ibtn",
          onClick: opts.onClick,
          disabled: opts.disabled === true,
          title: opts.title,
          "aria-label": opts.label,
          "data-on": opts.on ? "1" : undefined,
        },
        opts.spin ? h("span", { className: "dun-spin", style: { display: "inline-flex" } }, icon(opts.icon, opts.size || 15)) : icon(opts.icon, opts.size || 15)
      );
    }

    function LinkButton(href, label, glyph) {
      return h(
        "a",
        { className: "dun-btnGhost", href: href, target: "_blank", rel: "noreferrer" },
        label,
        glyph ? icon(glyph, 12) : null
      );
    }

    function Caption(text) {
      if (!text) return null;
      return h("span", { className: "dun-caption" }, text);
    }

    function UpdateBanner(props) {
      var store = props.store;
      var t = props.t || function (k) {
        return k;
      };

      var snapRef = React.useState(function () {
        return store.getSnapshot();
      });
      var snap = snapRef[0];
      var setSnap = snapRef[1];
      React.useEffect(
        function () {
          return store.subscribe(function () {
            setSnap(store.getSnapshot());
          });
        },
        [store]
      );

      React.useEffect(
        function () {
          store.refresh();
        },
        [store]
      );

      var copiedRef = React.useState(false);
      var copied = copiedRef[0];
      var setCopied = copiedRef[1];
      React.useEffect(
        function () {
          if (!copied) return;
          var id = setTimeout(function () {
            setCopied(false);
          }, 1800);
          return function () {
            clearTimeout(id);
          };
        },
        [copied]
      );

      var copiedPreviewRef = React.useState(null);
      var copiedPreview = copiedPreviewRef[0];
      var setCopiedPreview = copiedPreviewRef[1];

      var dismissedUpToDateRef = React.useState(false);
      var dismissedUpToDate = dismissedUpToDateRef[0];
      var setDismissedUpToDate = dismissedUpToDateRef[1];

      var pinnedRef = React.useState(function () {
        return isPinned();
      });
      var pinned = pinnedRef[0];
      var setPinnedState = pinnedRef[1];
      function togglePinned(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        var next = !pinned;
        setPinned(next);
        setPinnedState(next);
        store.touch();
      }

      // retry budget while no completed check has arrived yet
      var retriesRef = React.useState(0);
      var retries = retriesRef[0];
      var setRetries = retriesRef[1];

      // the loading card can be dismissed; an update found afterwards shines through
      var pendingHiddenRef = React.useState(false);
      var pendingHidden = pendingHiddenRef[0];
      var setPendingHidden = pendingHiddenRef[1];

      // reset up-to-date dismiss when version changes or hasUpdate flips
      React.useEffect(
        function () {
          if (!pinned) setDismissedUpToDate(false);
        },
        [snap.current, snap.target, snap.hasUpdate, pinned]
      );

      // auto-hide up-to-date banner after 8s (disabled when pinned)
      React.useEffect(
        function () {
          if (pinned) return;
          if (!snap.hasUpdate && snap.phase === "ready" && !snap.error && !dismissedUpToDate) {
            var id = setTimeout(function () {
              setDismissedUpToDate(true);
            }, 8000);
            return function () {
              clearTimeout(id);
            };
          }
        },
        [snap.hasUpdate, snap.phase, snap.error, dismissedUpToDate, pinned]
      );

      // Ask again until a *completed* check arrives ---------------------------
      //
      // The RPC channel is pull-only: the host never pushes a newer snapshot.
      // The host answers `getStatus` with `{checkedAt:null, checking:true}` while
      // its own startup check is still running — most page loads land in that
      // window — so the banner used to sit on "checking for updates" forever.
      // Re-ask (the host de-duplicates concurrent checks) until checkedAt lands.
      React.useEffect(
        function () {
          if (snap.phase !== "ready" && snap.phase !== "error") return;
          if (snap.checkedAt !== null || snap.error) {
            if (retries !== 0) setRetries(0);
            return;
          }
          if (retries >= 6) return;
          var id = setTimeout(function () {
            setRetries(retries + 1);
            store.checkNow();
          }, 300 + retries * 700);
          return function () {
            clearTimeout(id);
          };
        },
        [snap.phase, snap.checkedAt, snap.error, retries]
      );

      // Watchdog: never leave a spinner that cannot be retried ----------------
      React.useEffect(
        function () {
          if (snap.phase === "idle") return;
          if (snap.checkedAt !== null || snap.error) return;
          var id = setTimeout(function () {
            store.stalled(t("banner.timeout"));
          }, 30000);
          return function () {
            clearTimeout(id);
          };
        },
        [snap.phase, snap.checkedAt, snap.error]
      );

      // A restarted host starts with checkedAt === null; catch up when the tab
      // becomes visible again instead of trusting a stale snapshot.
      React.useEffect(
        function () {
          function onVisible() {
            if (document.visibilityState !== "visible") return;
            var at = store.getSnapshot().checkedAt;
            if (at === null) return;
            var age = Date.now() - new Date(at).getTime();
            if (!(age > 30 * 60 * 1000)) return;
            store.refresh();
          }
          document.addEventListener("visibilitychange", onVisible);
          return function () {
            document.removeEventListener("visibilitychange", onVisible);
          };
        },
        [store]
      );

      if (snap.phase === "idle") return null;

      // no completed check yet (first load or a host restart)
      var pending = snap.checkedAt === null && !snap.error;

      var checkedCaption = Caption(snap.checkedAt ? t("banner.checkedAt", { time: formatTime(snap.checkedAt) }) : "");

      function recheckButton() {
        return IconButton({
          key: "recheck",
          icon: "refresh",
          spin: snap.checking === true,
          disabled: snap.checking === true,
          title: t("banner.recheck"),
          label: t("banner.recheck"),
          onClick: function () {
            store.checkNow();
          },
        });
      }

      function pinButton() {
        return IconButton({
          key: "pin",
          icon: "pin",
          on: pinned,
          title: pinned ? t("banner.unpin") : t("banner.pinTitle"),
          label: pinned ? t("banner.unpin") : t("banner.pin"),
          onClick: togglePinned,
        });
      }

      function closeButton(onClick) {
        return IconButton({
          key: "close",
          icon: "close",
          title: t("banner.dismiss"),
          label: t("banner.dismiss"),
          onClick: onClick,
        });
      }

      // ── version source chips (npm dist-tags + GitHub tag) ───────────────
      // Only the first chip matching the running version is marked, so an
      // identical npm dist-tag and GitHub tag do not both claim "current".
      function tagNodes() {
        var current = snap.current;
        var tags = snap.npmTags || {};
        var keys = Object.keys(tags).sort();
        var marked = false;
        var nodes = keys.map(function (k) {
          var value = String(tags[k]);
          var isCurrent = !marked && current && value === String(current);
          if (isCurrent) marked = true;
          return h(
            "span",
            { key: "tag-" + k, className: "dun-tag", "data-cur": isCurrent ? "1" : undefined, title: "npm dist-tag " + k + " → " + value },
            h("span", { className: "dun-tagK" }, k),
            h("span", { className: "dun-tagV" }, value),
            isCurrent ? h("span", { className: "dun-tagCur" }, t("banner.cur")) : null
          );
        });
        if (snap.github) {
          var githubValue = String(snap.github);
          var githubIsCurrent = !marked && current && githubValue === String(current);
          if (githubIsCurrent) marked = true;
          nodes.push(
            h(
              "span",
              { key: "tag-github", className: "dun-tag", "data-cur": githubIsCurrent ? "1" : undefined, title: "GitHub tag " + githubValue },
              h("span", { className: "dun-tagK" }, "GitHub"),
              h("span", { className: "dun-tagV" }, githubValue),
              githubIsCurrent ? h("span", { className: "dun-tagCur" }, t("banner.cur")) : null
            )
          );
        }
        if (nodes.length === 0) {
          var fallback = t("banner.cross", { latest: snap.latest || "—", next: snap.next || "—", github: snap.github || "—" });
          return h("div", { className: "dun-note" }, fallback);
        }
        return h("div", { className: "dun-tags" }, nodes);
      }

      // ── previews (npm 测试版 / GitHub 超前只做提醒，附 npm 命令) ──────────
      function previewNodes() {
        var list = snap.previews || [];
        if (!list || list.length === 0) return null;
        var rows = list.map(function (p, idx) {
          var label = p.kind === "github" ? t("preview.github", { version: p.version }) : t("preview.npm", { tag: p.tag, version: p.version });
          var right = null;
          if (p.kind === "npm" && p.cmd) {
            var isCopied = copiedPreview === p.cmd;
            right = h(
              "button",
              {
                key: "cp",
                type: "button",
                className: "dun-btnGhost",
                onClick: function (e) {
                  if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  copyText(p.cmd, function (ok) {
                    setCopiedPreview(ok ? p.cmd : null);
                    if (ok)
                      setTimeout(function () {
                        setCopiedPreview(null);
                      }, 1500);
                  });
                },
              },
              isCopied ? icon("check", 12) : icon("copy", 12),
              isCopied ? t("banner.copied") : t("preview.copy")
            );
          } else if (p.kind === "github") {
            right = h(
              "a",
              { key: "lk", className: "dun-btnGhost", href: TAGS_URL, target: "_blank", rel: "noreferrer" },
              t("banner.viewTags"),
              icon("external", 12)
            );
          }
          return h(
            "div",
            { key: idx, className: "dun-moreRow" },
            h(
              "span",
              { className: "dun-moreTxt", title: label },
              label,
              p.kind === "npm" && p.cmd ? h("span", { className: "dun-moreMeta" }, "  " + p.cmd) : null
            ),
            right
          );
        });
        return h(
          "div",
          { className: "dun-more" },
          h("div", { className: "dun-moreHd" }, icon("alert", 12), t("preview.title"), " · " + list.length),
          rows
        );
      }

      function footerNodes(extra) {
        return h(
          "div",
          { className: "dun-foot" },
          extra || null,
          LinkButton(NPM_URL, t("banner.viewNpm"), null),
          LinkButton(RELEASES_URL, t("banner.viewRelease"), "external"),
          LinkButton(TAGS_URL, t("banner.viewTags"), "github"),
          h("span", { className: "dun-footSpacer" }),
          checkedCaption
        );
      }

      // ── loading (no completed check yet) ───────────────────────────────
      if (snap.phase === "loading" || pending) {
        if (pendingHidden) return null;
        return h(
          "div",
          { className: "dun-card", "data-state": "load", "data-dsh-update": "banner-loading", role: "status", "aria-live": "polite" },
          h(
            "div",
            { className: "dun-loading" },
            h("span", { className: "dun-badge" }, h("span", { className: "dun-spin", style: { display: "inline-flex" } }, icon("refresh", 15))),
            h("span", { className: "dun-title" }, h("span", { className: "dun-titleText" }, t("banner.loadingTitle"))),
            h("span", { className: "dun-caption" }, t("banner.checkingHint")),
            h(
              "span",
              { className: "dun-actions" },
              // stays enabled while a check is running: the host de-duplicates
              // concurrent checks, so a stuck-looking card is always retryable
              IconButton({
                key: "recheck",
                icon: "refresh",
                title: t("banner.recheck"),
                label: t("banner.recheck"),
                onClick: function () {
                  store.checkNow();
                },
              }),
              closeButton(function () {
                setPendingHidden(true);
              })
            )
          )
        );
      }

      // ── has update (npm 主通道): dismissible per target version ──────────
      if (snap.hasUpdate) {
        if (!pinned && snap.target && store.isDismissed(snap.target)) return null;

        var channelMap = { next: t("banner.next"), latest: t("banner.latest"), github: t("banner.github") };
        var channelLabel = channelMap[snap.channel] || snap.channel || t("banner.latest");
        // npm 为准：正式更新命令一律走 npm tag
        var cmd = "npm i -g @deepseek-ai/dsh@" + (snap.channel || "latest");

        function onDismiss(e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (snap.target) store.setDismissed(snap.target);
        }
        function onCopy() {
          copyText(cmd, function (ok) {
            if (ok) setCopied(true);
          });
        }

        return h(
          "div",
          { className: "dun-card", "data-state": "new", "data-dsh-update": "banner", role: "status", "aria-live": "polite" },
          h(
            "div",
            { className: "dun-hd" },
            h("span", { className: "dun-badge" }, icon("arrowUp", 16)),
            h(
              "span",
              { className: "dun-title" },
              h("span", { className: "dun-titleText" }, t("banner.title")),
              h("span", { className: "dun-chip" }, snap.target || "?")
            ),
            h("span", { className: "dun-actions" }, recheckButton(), pinButton(), closeButton(onDismiss))
          ),
          h(
            "div",
            { className: "dun-body" },
            h(
              "div",
              { className: "dun-vers" },
              h("span", { className: "dun-ver" }, h("span", { className: "dun-verK" }, t("banner.cur")), h("span", { className: "dun-verV" }, snap.current || "?")),
              h("span", { className: "dun-arrow" }, icon("arrowRight", 14)),
              h("span", { className: "dun-ver", "data-tone": "new" }, h("span", { className: "dun-verK" }, t("banner.new")), h("span", { className: "dun-verV" }, snap.target || snap.latest || "?")),
              h("span", { className: "dun-chip" }, channelLabel)
            ),
            h(
              "div",
              { className: "dun-cmd" },
              h("code", { className: "dun-cmdCode" }, cmd),
              h(
                "button",
                { type: "button", className: "dun-btnPrimary", onClick: onCopy, title: t("banner.copyCmd") },
                copied ? icon("check", 13) : icon("copy", 13),
                copied ? t("banner.copied") : t("banner.copy")
              )
            ),
            tagNodes(),
            snap.githubAhead ? h("div", { className: "dun-note", "data-tone": "warn" }, t("banner.sourceGithub")) : null,
            snap.error ? h("div", { className: "dun-note", "data-tone": "err" }, t("banner.error", { msg: String(snap.error).slice(0, 200) })) : null,
            previewNodes(),
            footerNodes(null)
          )
        );
      }

      // ── error without update ────────────────────────────────────────────
      if (snap.error) {
        return h(
          "div",
          { className: "dun-card", "data-state": "err", "data-dsh-update": "banner-error", role: "alert" },
          h(
            "div",
            { className: "dun-hd" },
            h("span", { className: "dun-badge" }, icon("alert", 16)),
            h("span", { className: "dun-title" }, h("span", { className: "dun-titleText" }, t("banner.errorTitle"))),
            h(
              "span",
              { className: "dun-actions" },
              recheckButton(),
              pinButton(),
              closeButton(function () {
                setSnap(Object.assign({}, store.getSnapshot(), { error: null }));
              })
            )
          ),
          h(
            "div",
            { className: "dun-body" },
            h("div", { className: "dun-note", "data-tone": "err" }, String(snap.error).slice(0, 300)),
            tagNodes(),
            previewNodes(),
            footerNodes(
              h(
                "button",
                {
                  type: "button",
                  className: "dun-btnGhost",
                  onClick: function () {
                    store.checkNow();
                  },
                },
                icon("refresh", 12),
                t("banner.errorRetry")
              )
            )
          )
        );
      }

      // ── up to date ──────────────────────────────────────────────────────
      // Nothing completed and no error: stay silent rather than guess.
      if (snap.checkedAt === null) return null;
      if (!pinned && dismissedUpToDate) return null;
      return h(
        "div",
        { className: "dun-card", "data-state": "up", "data-dsh-update": "banner-uptodate", role: "status", "aria-live": "polite" },
        h(
          "div",
          { className: "dun-hd" },
          h("span", { className: "dun-badge" }, icon("check", 16)),
          h(
            "span",
            { className: "dun-title" },
            h("span", { className: "dun-titleText" }, t("banner.upToDate")),
            h("span", { className: "dun-chip" }, snap.current || "?")
          ),
          h(
            "span",
            { className: "dun-actions" },
            recheckButton(),
            pinButton(),
            closeButton(function () {
              setDismissedUpToDate(true);
            })
          )
        ),
        h(
          "div",
          { className: "dun-body" },
          h("div", { className: "dun-line" }, t("banner.upToDateBody", { current: snap.current || "?" })),
          tagNodes(),
          snap.githubAhead ? h("div", { className: "dun-note", "data-tone": "warn" }, t("banner.sourceGithub")) : null,
          previewNodes(),
          footerNodes(null)
        )
      );
    }

    function UpdateDock(props) {
      var store = props.store;
      var t = props.t || function (k) {
        return k;
      };
      var snapRef = React.useState(function () {
        return store.getSnapshot();
      });
      var snap = snapRef[0];
      var setSnap = snapRef[1];
      React.useEffect(
        function () {
          return store.subscribe(function () {
            setSnap(store.getSnapshot());
          });
        },
        [store]
      );
      React.useEffect(
        function () {
          store.refresh();
        },
        [store]
      );

      if (snap.phase === "idle" || snap.phase === "loading") return null;
      if (!snap.hasUpdate) return null;
      if (!snap.target) return null;
      // a pinned banner never hides, so the dock must not duplicate it
      if (isPinned()) return null;
      // if banner is visible, dock hides (avoid duplicate)
      if (!store.isDismissed(snap.target)) return null;

      return h(
        "div",
        { className: "dun-dockRow", "data-dsh-update": "dock-row" },
        h(
          "button",
          {
            type: "button",
            className: "dun-dock",
            "aria-label": t("dock.aria"),
            title: (snap.current || "") + " → " + snap.target,
            onClick: function (e) {
              if (e) {
                e.preventDefault();
                e.stopPropagation();
              }
              store.clearDismissed(snap.target);
            },
          },
          icon("arrowUp", 13),
          t("dock.update", { target: snap.target })
        )
      );
    }

    function apply(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        },
        "dsh-update-notifier: locale"
      );

      ctx.effect(function () {
        var doc = typeof document === "undefined" ? null : document;
        return ensureStyles(doc);
      }, "dsh-update-notifier: styles");

      var store = createStore(ctx);

      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-update-banner",
            order: 5,
            locale: NS,
            inject: function () {
              return { store: store };
            },
          },
          UpdateBanner
        );
      });

      ctx.slots.inject("conversation.input.dock", function () {
        return ctx.slots.register(
          {
            name: "conversation.input.dock",
            id: "dsh-update-dock",
            order: 22,
            locale: NS,
            inject: function () {
              return { store: store };
            },
          },
          UpdateDock
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
