/**
 * dsh-update-notifier — browser half.
 *
 * Checks host RPC for newer DSH and shows a dismissible banner.
 * - shell.overlay → UpdateBanner (fixed top-center)
 * - conversation.input.dock → tiny pill when banner dismissed but update still available (quick reopen)
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
      "banner.pin": "常驻",
      "banner.unpin": "取消常驻",
      "banner.pinTitle": "保持提示框常驻显示",
      "banner.copyCmd": "复制更新命令",
      "banner.copied": "已复制",
      "banner.viewRelease": "查看更新说明",
      "banner.viewTags": "查看 GitHub Tags",
      "banner.viewNpm": "查看 npm",
      "banner.checkedAt": "上次检查：{time}",
      "banner.upToDate": "已是最新版本",
      "banner.error": "检查失败：{msg}",
      "banner.errorRetry": "重试",
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
      "banner.pin": "Pin",
      "banner.unpin": "Unpin",
      "banner.pinTitle": "Keep banner pinned",
      "banner.copyCmd": "Copy update command",
      "banner.copied": "Copied",
      "banner.viewRelease": "Release notes",
      "banner.viewTags": "View GitHub Tags",
      "banner.viewNpm": "View npm",
      "banner.checkedAt": "Checked: {time}",
      "banner.upToDate": "Up to date",
      "banner.error": "Check failed: {msg}",
      "banner.errorRetry": "Retry",
      "banner.cross": "npm: {latest} / {next} · GitHub: {github}",
      "banner.sourceBoth": "GitHub and npm agree",
      "banner.sourceGithub": "GitHub is ahead of npm — notice only",
      "banner.sourceNpm": "npm has update",
      "preview.title": "More notices",
      "preview.npm": "Prerelease {tag}: {version}",
      "preview.github": "GitHub has {version}, not yet on npm",
      "preview.copy": "Copy",
      "dock.update": "Update {target}",
      "dock.aria": "View DSH update",
      "cmd": "npm i -g @deepseek-ai/dsh@{tag}",
    };

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }

    function rpc(ctx, endpoint, args) {
      return ctx.connection.rpc.call("/dsh-update-rpc", endpoint, { args: args || {} });
    }

    function formatTime(iso, t) {
      if (!iso) return "";
      try {
        var d = new Date(iso);
        return d.toLocaleString();
      } catch {
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
      } catch {
        return false;
      }
    }
    function setDismissed(target) {
      try {
        localStorage.setItem(dismissedKey(target), "1");
      } catch {}
    }
    function clearDismissed(target) {
      try {
        localStorage.removeItem(dismissedKey(target));
      } catch {}
    }
    function pinnedKey() { return "dsh-update-notifier:pinned"; }
    function isPinned() {
      try { return localStorage.getItem(pinnedKey()) === "1"; } catch { return false; }
    }
    function setPinned(v) {
      try {
        if (v) localStorage.setItem(pinnedKey(), "1");
        else localStorage.removeItem(pinnedKey());
      } catch {}
    }

    var S = {
      bannerWrap: {
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        width: 520,
        maxWidth: "calc(100vw - 24px)",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.25))",
        background: "var(--dsw-alias-bg-base, #1e1e1e)",
        boxShadow: "var(--dsw-shadow-lv2, 0 8px 32px rgba(0,0,0,0.45))",
        overflow: "hidden",
        pointerEvents: "auto",
      },
      header: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px 8px",
        borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.18))",
      },
      title: {
        flex: "1",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--dsw-alias-label-primary, #e5e7eb)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      },
      badge: {
        fontSize: 11,
        lineHeight: "16px",
        padding: "1px 7px",
        borderRadius: 999,
        background: "var(--dsw-alias-state-business-primary, #4f8cff)",
        color: "#fff",
        fontWeight: 600,
        flex: "none",
      },
      body: {
        padding: "10px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      },
      line: {
        fontSize: 12,
        lineHeight: "18px",
        color: "var(--dsw-alias-label-secondary, #c8ccd2)",
        wordBreak: "break-word",
      },
      meta: {
        fontSize: 11,
        lineHeight: "16px",
        color: "var(--dsw-alias-label-quaternary, #8a8f98)",
      },
      row: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      },
      btnPrimary: {
        background: "var(--dsw-alias-state-business-primary, #4f8cff)",
        border: "1px solid transparent",
        borderRadius: 8,
        color: "#fff",
        font: "inherit",
        fontSize: 12,
        lineHeight: "22px",
        padding: "0 10px",
        cursor: "pointer",
      },
      btnGhost: {
        background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.12))",
        border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.25))",
        borderRadius: 8,
        color: "var(--dsw-alias-label-secondary, #c8ccd2)",
        font: "inherit",
        fontSize: 12,
        lineHeight: "22px",
        padding: "0 10px",
        cursor: "pointer",
      },
      btnDisabled: { opacity: 0.5, cursor: "default" },
      code: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: "18px",
        padding: "6px 8px",
        borderRadius: 8,
        background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.10))",
        border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.18))",
        color: "var(--dsw-alias-label-primary, #e5e7eb)",
        wordBreak: "break-all",
        userSelect: "all",
      },
    };

    function tagsLine(snap) {
      var tags = snap.npmTags || {};
      var keys = Object.keys(tags);
      if (keys.length > 0) {
        var parts = keys.sort().map(function (k) { return k + ": " + tags[k]; });
        return "npm {" + parts.join(", ") + "} · GitHub: " + (snap.github || "—");
      }
      return null;
    }

    function copyText(text, done) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function(){ done(true); }).catch(function(){
          try { window.prompt("Copy command:", text); } catch {}
          done(false);
        });
      } else {
        try { window.prompt("Copy command:", text); } catch {}
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
          try { fn(); } catch (e) { console.error("[dsh-update-notifier] listener", e); }
        }
      }
      function getSnapshot() { return state; }
      function subscribe(fn) { listeners.add(fn); return function(){ listeners.delete(fn); }; }
      function touch() { emit(Object.assign({}, state)); }
      function setDismissedStore(target) { setDismissed(target); touch(); }
      function clearDismissedStore(target) { clearDismissed(target); touch(); }
      function isDismissedStore(target) { return isDismissed(target); }

      function applyResult(res) {
        if (!res || res.ok !== true) {
          var msg = res && res.error && res.error.message ? String(res.error.message) : "rpc failed";
          try { console.warn("[dsh-update-notifier] rpc error", msg, res); } catch {}
          emit(Object.assign({}, state, { phase: "error", error: msg, checking: false }));
          return;
        }
        var v = res.value || {};
        try {
          console.log("[dsh-update-notifier] query result", JSON.stringify({ current: v.current, latest: v.latest, next: v.next, npmTags: v.npmTags, github: v.github, githubAhead: v.githubAhead, previews: v.previews, hasUpdate: v.hasUpdate, target: v.target, channel: v.channel, source: v.source, checkedAt: v.checkedAt, error: v.error }));
          if (v.hasUpdate) console.log("[dsh-update-notifier] update available (npm): " + v.current + " → " + v.target + " (" + v.channel + ")");
          else console.log("[dsh-update-notifier] npm up to date: " + v.current + " (npmTags:" + JSON.stringify(v.npmTags) + " github:" + v.github + " previews:" + ((v.previews || []).length) + ")");
        } catch {}
        emit({
          phase: "ready",
          current: v.current || null,
          latest: v.latest || null,
          next: v.next || null,
          npmTags: (v.npmTags && typeof v.npmTags === "object") ? v.npmTags : {},
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
        try { console.log("[dsh-update-notifier] refresh getStatus..."); } catch {}
        emit(Object.assign({}, state, { phase: state.phase === "idle" ? "loading" : state.phase, checking: true, error: null }));
        return rpc(ctx, "getStatus", {}).then(function(res){
          if (mySeq !== seq) return;
          applyResult(res);
        }).catch(function(e){
          if (mySeq !== seq) return;
          try { console.warn("[dsh-update-notifier] refresh failed", e); } catch {}
          emit(Object.assign({}, state, { phase: "error", error: String(e && e.message || e), checking: false }));
        });
      }

      function checkNow() {
        var mySeq = ++seq;
        try { console.log("[dsh-update-notifier] checkNow..."); } catch {}
        emit(Object.assign({}, state, { checking: true, error: null }));
        return rpc(ctx, "checkNow", {}).then(function(res){
          if (mySeq !== seq) return;
          applyResult(res);
        }).catch(function(e){
          if (mySeq !== seq) return;
          try { console.warn("[dsh-update-notifier] checkNow failed", e); } catch {}
          emit(Object.assign({}, state, { checking: false, error: String(e && e.message || e), phase: "error" }));
        });
      }

      return { getSnapshot: getSnapshot, subscribe: subscribe, refresh: refresh, checkNow: checkNow, touch: touch, setDismissed: setDismissedStore, clearDismissed: clearDismissedStore, isDismissed: isDismissedStore };
    }

    function UpdateBanner(props) {
      var store = props.store;
      var t = props.t || function(k){ return k; };

      var snapRef = React.useState(function(){ return store.getSnapshot(); });
      var snap = snapRef[0];
      var setSnap = snapRef[1];
      React.useEffect(function(){
        var unsub = store.subscribe(function(){ setSnap(store.getSnapshot()); });
        return unsub;
      }, [store]);

      React.useEffect(function(){ store.refresh(); }, [store]);

      var copiedRef = React.useState(false);
      var copied = copiedRef[0];
      var setCopied = copiedRef[1];
      React.useEffect(function(){
        if (!copied) return;
        var id = setTimeout(function(){ setCopied(false); }, 1800);
        return function(){ clearTimeout(id); };
      }, [copied]);

      var copiedPreviewRef = React.useState(null);
      var copiedPreview = copiedPreviewRef[0];
      var setCopiedPreview = copiedPreviewRef[1];

      var dismissedUpToDateRef = React.useState(false);
      var dismissedUpToDate = dismissedUpToDateRef[0];
      var setDismissedUpToDate = dismissedUpToDateRef[1];

      var pinnedRef = React.useState(function(){ return isPinned(); });
      var pinned = pinnedRef[0];
      var setPinnedState = pinnedRef[1];
      function togglePinned(e){
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var next = !pinned;
        setPinned(next);
        setPinnedState(next);
        store.touch();
      }

      // reset up-to-date dismiss when version changes or hasUpdate flips
      React.useEffect(function(){
        if (!pinned) setDismissedUpToDate(false);
      }, [snap.current, snap.target, snap.hasUpdate, pinned]);

      // auto-hide up-to-date banner after 8s (disabled when pinned)
      React.useEffect(function(){
        if (pinned) return;
        if (!snap.hasUpdate && snap.phase === "ready" && !snap.error && !dismissedUpToDate) {
          var id = setTimeout(function(){ setDismissedUpToDate(true); }, 8000);
          return function(){ clearTimeout(id); };
        }
      }, [snap.hasUpdate, snap.phase, snap.error, dismissedUpToDate, pinned]);

      // if backend restarted and no check yet, trigger one
      React.useEffect(function(){
        if (snap.phase === "ready" && snap.checkedAt === null && !snap.checking) {
          store.checkNow();
        }
      }, [snap.phase, snap.checkedAt, snap.checking]);

      if (snap.phase === "idle" || snap.phase === "loading") return null;
      // while initial check hasn't completed, avoid blank "npm: —" popup
      if (snap.checkedAt === null) {
        if (snap.checking) {
          return h("div", { style: S.bannerWrap, "data-dsh-update": "banner-loading" },
            h("div", { style: S.header },
              h("span", { style: S.title }, h("span", { style: { fontSize: 16 } }, "…"), "DSH 检查"),
              h("span", { style: S.meta }, t("banner.checking"))
            ),
            h("div", { style: S.body }, h("div", { style: S.meta }, "正在获取版本信息…"))
          );
        }
        return null;
      }

      // ── previews builder (npm 测试版 / GitHub 超前只做提醒，附 npm 命令) ──
      function buildPreviewNodes() {
        var list = snap.previews || [];
        if (!list || list.length === 0) return null;
        var rows = list.map(function (p, idx) {
          var label = p.kind === "github"
            ? t("preview.github", { version: p.version })
            : t("preview.npm", { tag: p.tag, version: p.version });
          var right = null;
          if (p.kind === "npm" && p.cmd) {
            var isCopied = copiedPreview === p.cmd;
            right = h("button", {
              key: "cp",
              type: "button",
              style: S.btnGhost,
              onClick: function (e) {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                copyText(p.cmd, function (ok) {
                  setCopiedPreview(ok ? p.cmd : null);
                  if (ok) setTimeout(function () { setCopiedPreview(null); }, 1500);
                });
              }
            }, isCopied ? t("banner.copied") : t("preview.copy"));
          } else if (p.kind === "github") {
            right = h("a", { key: "lk", href: "https://github.com/deepseek-ai/deepseek-harness/tags", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewTags"));
          }
          return h("div", { key: idx, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #9aa0a6)" } },
            h("span", { style: { flex: "1", minWidth: 0, wordBreak: "break-all" } }, (p.kind === "github" ? "◌ " : "🧪 ") + label + (p.kind === "npm" && p.cmd ? " · " + p.cmd : "")),
            right
          );
        });
        return h("div", { style: { display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", borderRadius: 8, background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.08))", border: "1px dashed var(--dsw-alias-separator-primary, rgba(127,127,127,0.2))" } },
          h("div", { style: { fontSize: 11, fontWeight: 600, color: "var(--dsw-alias-label-tertiary, #9aa0a6)" } }, t("preview.title") + " (" + list.length + ")"),
          rows
        );
      }

      // ── has update (npm 主通道): dismissible per target version (pinned keeps banner) ──
      if (snap.hasUpdate) {
        if (!pinned && snap.target && store.isDismissed(snap.target)) return null;

        var channelMap = { next: t("banner.next"), latest: t("banner.latest"), github: t("banner.github") };
        var channelLabel = channelMap[snap.channel] || snap.channel || t("banner.latest");
        var bodyText = t("banner.body", { current: snap.current || "?", target: snap.target || snap.latest || "?", channel: channelLabel });
        // npm 为准：正式更新命令一律走 npm tag
        var cmd = "npm i -g @deepseek-ai/dsh@" + (snap.channel || "latest");

        function onDismiss(e) {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          if (snap.target) store.setDismissed(snap.target);
        }
        function onCopy() {
          copyText(cmd, function (ok) { if (ok) setCopied(true); });
        }

        var errorNode = null;
        if (snap.error) {
          errorNode = h("div", { style: { fontSize: 11, color: "var(--dsw-alias-state-warning-primary, #f59e0b)", lineHeight: "16px" } }, t("banner.error", { msg: String(snap.error).slice(0,200) }));
        }

        var crossText = tagsLine(snap) || t("banner.cross", { latest: snap.latest || "—", next: snap.next || "—", github: snap.github || "—" });
        var sourceNote = null;
        if (snap.source === "npm") sourceNote = t("banner.sourceNpm");

        return h("div", { style: S.bannerWrap, "data-dsh-update": "banner" },
          h("div", { style: S.header },
            h("span", { style: S.title },
              h("span", { style: { fontSize: 16 } }, "⬆"),
              t("banner.title"),
              h("span", { style: S.badge }, snap.target || "?")
            ),
            h("button", { type: "button", style: Object.assign({}, S.btnGhost, snap.checking ? S.btnDisabled : null), disabled: snap.checking === true, onClick: function(){ store.checkNow(); } }, snap.checking ? t("banner.checking") : t("banner.recheck")),
            h("button", { type: "button", style: Object.assign({}, S.btnGhost, pinned ? { borderColor: "var(--dsw-alias-state-business-primary, #4f8cff)", color: "var(--dsw-alias-state-business-primary, #4f8cff)" } : null), onClick: togglePinned, title: t("banner.pinTitle") }, pinned ? t("banner.unpin") : "📌 " + t("banner.pin")),
            h("button", { type: "button", style: S.btnGhost, onClick: onDismiss, "aria-label": t("banner.dismiss") }, "×")
          ),
          h("div", { style: S.body },
            h("div", { style: S.line }, bodyText),
            h("div", { style: S.meta }, crossText),
            sourceNote ? h("div", { style: S.meta }, sourceNote) : null,
            h("div", { style: S.code }, cmd),
            buildPreviewNodes(),
            errorNode,
            h("div", { style: S.row },
              h("button", { type: "button", style: S.btnPrimary, onClick: onCopy }, copied ? t("banner.copied") : t("banner.copyCmd")),
              h("a", { href: "https://www.npmjs.com/package/@deepseek-ai/dsh", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewNpm")),
              h("a", { href: "https://github.com/deepseek-ai/deepseek-harness/releases", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewRelease")),
              h("a", { href: "https://github.com/deepseek-ai/deepseek-harness/tags", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewTags")),
              h("span", { style: S.meta }, snap.checkedAt ? t("banner.checkedAt", { time: formatTime(snap.checkedAt) }) : "")
            )
          )
        );
      }

      // ── error without update ──
      if (snap.error) {
        return h("div", { style: Object.assign({}, S.bannerWrap, { borderColor: "var(--dsw-alias-state-warning-secondary, rgba(245,158,11,0.4))" }), "data-dsh-update": "banner-error" },
          h("div", { style: S.header },
            h("span", { style: S.title },
              h("span", { style: { fontSize: 16 } }, "⚠"),
              "DSH 检查"
            ),
            h("button", { type: "button", style: Object.assign({}, S.btnGhost, snap.checking ? S.btnDisabled : null), disabled: snap.checking === true, onClick: function(){ store.checkNow(); } }, snap.checking ? t("banner.checking") : t("banner.recheck")),
            h("button", { type: "button", style: Object.assign({}, S.btnGhost, pinned ? { borderColor: "var(--dsw-alias-state-business-primary, #4f8cff)", color: "var(--dsw-alias-state-business-primary, #4f8cff)" } : null), onClick: togglePinned, title: t("banner.pinTitle") }, pinned ? t("banner.unpin") : "📌 " + t("banner.pin")),
            h("button", { type: "button", style: S.btnGhost, onClick: function(){ setSnap(Object.assign({}, store.getSnapshot(), { error: null })); }, "aria-label": t("banner.dismiss") }, "×")
          ),
          h("div", { style: S.body },
            h("div", { style: { fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-state-warning-primary, #f59e0b)" } }, t("banner.error", { msg: String(snap.error).slice(0,300) })),
            h("div", { style: S.meta }, tagsLine(snap) || t("banner.cross", { latest: snap.latest || "—", next: snap.next || "—", github: snap.github || "—" })),
            buildPreviewNodes(),
            h("div", { style: S.meta }, snap.checkedAt ? t("banner.checkedAt", { time: formatTime(snap.checkedAt) }) : "")
          )
        );
      }

      // ── up to date (npm 为准；alpha/GitHub 只在 previews 里提醒) ──
      if (!pinned && dismissedUpToDate) return null;
      var crossText2 = tagsLine(snap) || t("banner.cross", { latest: snap.latest || "—", next: snap.next || "—", github: snap.github || "—" });
      var sourceNote2 = null;
      if (snap.githubAhead) sourceNote2 = t("banner.sourceGithub");

      return h("div", { style: Object.assign({}, S.bannerWrap, { borderColor: "var(--dsw-alias-state-success-secondary, rgba(52,199,89,0.35))" }), "data-dsh-update": "banner-uptodate" },
        h("div", { style: S.header },
          h("span", { style: S.title },
            h("span", { style: { fontSize: 16, color: "var(--dsw-alias-state-success-primary, #34c759)" } }, "✓"),
            t("banner.upToDate"),
            h("span", { style: Object.assign({}, S.badge, { background: "var(--dsw-alias-state-success-primary, #34c759)" }) }, snap.current || "?")
          ),
          h("button", { type: "button", style: Object.assign({}, S.btnGhost, snap.checking ? S.btnDisabled : null), disabled: snap.checking === true, onClick: function(){ store.checkNow(); } }, snap.checking ? t("banner.checking") : t("banner.recheck")),
          h("button", { type: "button", style: Object.assign({}, S.btnGhost, pinned ? { borderColor: "var(--dsw-alias-state-success-primary, #34c759)", color: "var(--dsw-alias-state-success-primary, #34c759)" } : null), onClick: togglePinned, title: t("banner.pinTitle") }, pinned ? t("banner.unpin") : "📌 " + t("banner.pin")),
          h("button", { type: "button", style: S.btnGhost, onClick: function(){ setDismissedUpToDate(true); }, "aria-label": t("banner.dismiss") }, "×")
        ),
        h("div", { style: S.body },
          h("div", { style: S.line }, "当前 " + (snap.current || "?") + " 已是最新" + (snap.latest ? "（npm: " + snap.latest + "）" : "")),
          h("div", { style: S.meta }, crossText2),
          sourceNote2 ? h("div", { style: { fontSize: 11, lineHeight: "16px", color: "var(--dsw-alias-state-warning-primary, #f59e0b)" } }, sourceNote2) : null,
          buildPreviewNodes(),
          h("div", { style: S.row },
            h("a", { href: "https://www.npmjs.com/package/@deepseek-ai/dsh", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewNpm")),
            h("a", { href: "https://github.com/deepseek-ai/deepseek-harness/releases", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewRelease")),
            h("a", { href: "https://github.com/deepseek-ai/deepseek-harness/tags", target: "_blank", rel: "noreferrer", style: Object.assign({}, S.btnGhost, { textDecoration: "none", display: "inline-flex", alignItems: "center" }) }, t("banner.viewTags")),
            h("span", { style: S.meta }, snap.checkedAt ? t("banner.checkedAt", { time: formatTime(snap.checkedAt) }) : "")
          )
        )
      );
    }

    function UpdateDock(props) {
      var store = props.store;
      var t = props.t || function(k){ return k; };
      var snapRef = React.useState(function(){ return store.getSnapshot(); });
      var snap = snapRef[0];
      var setSnap = snapRef[1];
      React.useEffect(function(){
        var unsub = store.subscribe(function(){ setSnap(store.getSnapshot()); });
        return unsub;
      }, [store]);
      React.useEffect(function(){ store.refresh(); }, [store]);

      if (snap.phase === "idle" || snap.phase === "loading") return null;
      if (!snap.hasUpdate) return null;
      if (!snap.target) return null;
      // if banner is visible, dock hides (avoid duplicate)
      if (!store.isDismissed(snap.target)) return null;

      return h("div", {
        style: {
          boxSizing: "border-box",
          display: "flex",
          justifyContent: "flex-start",
          width: "100%",
          paddingLeft: "calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)",
          margin: "2px 0",
        },
        "data-dsh-update": "dock-row"
      }, h("button", {
        type: "button",
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 260,
          padding: "1px 10px",
          borderRadius: 999,
          border: "1px solid var(--dsw-alias-state-business-primary, #4f8cff)",
          background: "var(--dsw-alias-state-business-tertiary, rgba(79,140,255,0.14))",
          color: "var(--dsw-alias-state-business-primary, #4f8cff)",
          font: "inherit",
          fontSize: 12,
          lineHeight: "20px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          userSelect: "none",
        },
        "aria-label": t("dock.aria"),
        title: (snap.current || "") + " → " + snap.target,
        onClick: function(e){
          if (e) { e.preventDefault(); e.stopPropagation(); }
          store.clearDismissed(snap.target);
        }
      }, "⬆ " + t("dock.update", { target: snap.target })));
    }

    function apply(ctx) {
      ctx.effect(function(){
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-update-notifier: locale");

      var store = createStore(ctx);

      ctx.slots.inject("shell.overlay", function(){
        return ctx.slots.register({
          name: "shell.overlay",
          id: "dsh-update-banner",
          order: 5,
          locale: NS,
          inject: function(){ return { store: store }; }
        }, UpdateBanner);
      });

      ctx.slots.inject("conversation.input.dock", function(){
        return ctx.slots.register({
          name: "conversation.input.dock",
          id: "dsh-update-dock",
          order: 22,
          locale: NS,
          inject: function(){ return { store: store }; }
        }, UpdateDock);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  }
});
