window.__ModuleLoader__.load({
	id: "dsh-privmask",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// client-src/index.ts
		var index_exports = {};
		__export(index_exports, {
		  NS: () => NS,
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);

		// client-src/PrivmaskCard.tsx
		var import_react = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		var row = { display: "flex", flexDirection: "column", gap: 12, padding: 16 };
		var title = { fontSize: 15, fontWeight: 600 };
		var body = { fontSize: 13, color: "var(--dsh-text-2, #888)" };
		var line = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
		var btnBase = {
		  border: "1px solid var(--dsh-border, #555)",
		  borderRadius: 6,
		  padding: "4px 14px",
		  fontSize: 13,
		  cursor: "pointer",
		  background: "transparent",
		  color: "inherit",
		  minWidth: 64
		};
		var chipBase = {
		  display: "inline-flex",
		  alignItems: "center",
		  gap: 6,
		  border: "1px solid var(--dsh-border, #555)",
		  borderRadius: 999,
		  padding: "2px 10px",
		  fontSize: 12
		};
		var inputBase = {
		  flex: 1,
		  border: "1px solid var(--dsh-border, #555)",
		  borderRadius: 6,
		  padding: "4px 8px",
		  fontSize: 13,
		  background: "transparent",
		  color: "inherit"
		};
		var errorStyle = { fontSize: 12, color: "#e5484d" };
		var linkStyle = { color: "inherit" };
		var section = {
		  display: "flex",
		  flexDirection: "column",
		  gap: 10,
		  borderTop: "1px solid var(--dsh-border, rgba(128,128,128,.22))",
		  paddingTop: 12
		};
		var sectionLabel = { fontSize: 12, fontWeight: 600, color: "var(--dsh-text-2, #888)" };
		var sectionSub = { fontSize: 12, fontWeight: 600, color: "var(--dsh-text-3, #aaa)" };
		var actionsRow = { display: "flex", gap: 8, justifyContent: "flex-end" };
		var disclaimerBox = {
		  fontSize: 12,
		  color: "var(--dsh-text-2, #888)",
		  border: "1px solid rgba(229, 72, 77, .35)",
		  borderRadius: 6,
		  padding: "8px 10px",
		  background: "rgba(229, 72, 77, .06)"
		};
		var DSH_SUPPORT = "dsh 0.1.0-rc.6+（0.1.1-rc.2 / 0.1.5-rc.2 / 0.1.6-alpha.2 / 0.1.7-rc.2 / 0.2.1-rc.5 / 0.2.2-alpha.2 已核对）";
		var DISCLAIMER = "脱敏为启发式本地处理，无法保证零漏检；重要数据请自行评估并保留原文。";
		var PLUGIN_VERSION = "0.2.50";
		function PrivmaskCard(props) {
		  const [enabled, setEnabled] = (0, import_react.useState)(null);
		  const [cfg, setCfg] = (0, import_react.useState)(null);
		  const [revision, setRevision] = (0, import_react.useState)(void 0);
		  const [writable, setWritable] = (0, import_react.useState)(false);
		  const [saving, setSaving] = (0, import_react.useState)(null);
		  const [error, setError] = (0, import_react.useState)(null);
		  const [copied, setCopied] = (0, import_react.useState)(false);
		  const [copiedStatus, setCopiedStatus] = (0, import_react.useState)(false);
		  const [termInput, setTermInput] = (0, import_react.useState)("");
		  const [terms, setTerms] = (0, import_react.useState)([]);
		  (0, import_react.useEffect)(() => {
		    let alive = true;
		    props.list().then((snap) => {
		      if (!alive) return;
		      const entry = snap.entries.find((e) => e.moduleName === "dsh-privmask");
		      setEnabled(entry ? entry.enabled : null);
		    }).catch(() => {
		      if (alive) setEnabled(null);
		    });
		    props.describe().then((d) => {
		      if (!alive) return;
		      setWritable(d.writable);
		      const ns = d.namespaces.find((n) => n.ns === "privmask");
		      if (ns) {
		        setCfg(ns.value);
		        setRevision(ns.revision);
		        setTerms(Array.isArray(ns.value.customTerms) ? ns.value.customTerms.map(String) : []);
		        setError(null);
		      }
		    }).catch((e) => {
		      if (alive) {
		        setWritable(false);
		        setCfg(null);
		        setError(String(e && e.message ? e.message : e));
		      }
		    });
		    return () => {
		      alive = false;
		    };
		  }, [props]);
		  const toggle = async (field2) => {
		    if (cfg === null || saving !== null) return;
		    setSaving(field2);
		    setError(null);
		    try {
		      const next = !Boolean(cfg[field2]);
		      const result = await props.update("privmask", { [field2]: next }, revision);
		      if (result.value) {
		        setCfg(result.value.value);
		        setRevision(result.value.revision);
		      } else {
		        setError("设置已保存但返回异常，请刷新后重试");
		      }
		    } catch (e) {
		      setError(String(e && e.message ? e.message : e));
		    } finally {
		      setSaving(null);
		    }
		  };
		  const field = (key) => Boolean(cfg?.[key]);
		  const factsOn = field("redactNames") && field("redactCompanies") && field("redactOrgs");
		  const factsSomeOn = field("redactNames") || field("redactCompanies") || field("redactOrgs");
		  const toggleFacts = async () => {
		    if (cfg === null || saving !== null) return;
		    setSaving("facts");
		    setError(null);
		    try {
		      const next = !factsOn;
		      const result = await props.update("privmask", { redactNames: next, redactCompanies: next, redactOrgs: next }, revision);
		      if (result.value) {
		        setCfg(result.value.value);
		        setRevision(result.value.revision);
		      } else {
		        setError("设置已保存但返回异常，请刷新后重试");
		      }
		    } catch (e) {
		      setError(String(e && e.message ? e.message : e));
		    } finally {
		      setSaving(null);
		    }
		  };
		  const saveTerms = async (next) => {
		    if (cfg === null || saving !== null) return;
		    setSaving("terms");
		    setError(null);
		    try {
		      const result = await props.update("privmask", { customTerms: next }, revision);
		      if (result.value) {
		        setCfg(result.value.value);
		        setRevision(result.value.revision);
		        setTerms(Array.isArray(result.value.value.customTerms) ? result.value.value.customTerms.map(String) : []);
		      } else {
		        setError("设置已保存但返回异常，请刷新后重试");
		      }
		    } catch (e) {
		      setError(String(e && e.message ? e.message : e));
		    } finally {
		      setSaving(null);
		    }
		  };
		  const TERM_SPLIT = /[;；,，、\n]+/;
		  const addTerm = () => {
		    const raw = termInput.trim();
		    if (!raw) return;
		    const next = [...terms];
		    for (const part of raw.split(TERM_SPLIT)) {
		      const t = part.trim();
		      if (t && !next.includes(t)) next.push(t);
		    }
		    if (next.length === terms.length) {
		      setTermInput("");
		      return;
		    }
		    setTermInput("");
		    void saveTerms(next);
		  };
		  const removeTerm = (t) => {
		    void saveTerms(terms.filter((x) => x !== t));
		  };
		  const copyUpdateCommand = () => {
		    const cmd = "dsh plugin --profile <profile> update dsh-privmask";
		    const done = () => {
		      setCopied(true);
		      setTimeout(() => setCopied(false), 3e3);
		    };
		    const fallback = () => {
		      try {
		        const ta = document.createElement("textarea");
		        ta.value = cmd;
		        document.body.appendChild(ta);
		        ta.select();
		        const ok = document.execCommand("copy");
		        document.body.removeChild(ta);
		        if (ok) done();
		        else setError("复制失败，请手动输入：" + cmd);
		      } catch {
		        setError("无法复制，请手动输入：" + cmd);
		      }
		    };
		    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
		      navigator.clipboard.writeText(cmd).then(done).catch(fallback);
		    } else {
		      fallback();
		    }
		  };
		  const copyStatusCommand = () => {
		    const text = statusText();
		    const done = () => {
		      setCopiedStatus(true);
		      setTimeout(() => setCopiedStatus(false), 3e3);
		    };
		    const fallback = () => {
		      try {
		        const ta = document.createElement("textarea");
		        ta.value = text;
		        document.body.appendChild(ta);
		        ta.select();
		        const ok = document.execCommand("copy");
		        document.body.removeChild(ta);
		        if (ok) done();
		        else setError("复制失败，请重试");
		      } catch {
		        setError("复制失败，请重试");
		      }
		    };
		    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
		      navigator.clipboard.writeText(text).then(done).catch(fallback);
		    } else fallback();
		  };
		  const switchRow = (key, label2) => {
		    const on = field(key);
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: line, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
		        label2,
		        "：",
		        on ? "已开启" : "已关闭"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        "button",
		        {
		          type: "button",
		          disabled: !writable || saving !== null,
		          style: { ...btnBase, opacity: writable ? 1 : 0.5 },
		          onClick: () => toggle(key),
		          children: on ? "关闭" : "开启"
		        }
		      )
		    ] }, key);
		  };
		  const label = enabled === true ? "插件已启用" : enabled === false ? "插件未启用" : "插件状态未知";
		  const active = [
		    field("redactNames") ? "姓名" : "",
		    field("redactCompanies") ? "公司" : "",
		    field("redactOrgs") ? "机关" : "",
		    field("redactAddress") ? "地址" : "",
		    field("redactCredentials") ? "密钥凭据" : ""
		  ].filter(Boolean);
		  const kept = [
		    !field("redactCaseNumbers") ? "案号" : "",
		    !field("redactDob") ? "出生日期" : "",
		    !field("redactPaths") ? "文件路径" : ""
		  ].filter(Boolean);
		  const statusText = () => "dsh-privmask v" + PLUGIN_VERSION + " · 生效脱敏：" + (active.join("、") || "无") + "；保留：" + (kept.join("、") || "无");
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: title, children: [
		      "隐私保护：",
		      label
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, color: "var(--dsh-text-2, #888)" }, children: [
		      "插件版本：v",
		      PLUGIN_VERSION
		    ] }),
		    writable && cfg !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: section, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionLabel, children: "开关" }),
		        switchRow("enabled", "总开关"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: line, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
		            "全面脱敏（姓名/公司/机关）：",
		            factsOn ? "已开启" : factsSomeOn ? "部分开启" : "已关闭"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "button",
		            {
		              type: "button",
		              disabled: !writable || saving !== null,
		              style: { ...btnBase, opacity: writable ? 1 : 0.5 },
		              onClick: toggleFacts,
		              children: factsOn ? "关闭" : "全部开启"
		            }
		          )
		        ] }),
		        switchRow("redactNames", "姓名"),
		        switchRow("redactCompanies", "公司"),
		        switchRow("redactOrgs", "机关（法院除外）"),
		        switchRow("redactAddress", "地址"),
		        switchRow("redactCredentials", "密钥凭据"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionSub, children: "默认保留项（开启后改为脱敏）" }),
		        switchRow("redactCaseNumbers", "案号"),
		        switchRow("redactDob", "出生日期"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: body, children: [
		          "当前生效：",
		          active.join("、") || "无",
		          "；保留：",
		          kept.join("、") || "无",
		          "。"
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: section, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionLabel, children: "自定义敏感词（当事人姓名/别名/机构简称）" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              style: inputBase,
		              value: termInput,
		              placeholder: "输入敏感词（可用 ; ； , ， 、 分隔一次添加多个），回车或点添加",
		              onChange: (e) => setTermInput(e.target.value),
		              onKeyDown: (e) => {
		                if (e.key === "Enter") addTerm();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !writable || saving !== null, style: btnBase, onClick: addTerm, children: "添加" })
		        ] }),
		        terms.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: terms.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: chipBase, children: [
		          t,
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "button",
		            {
		              type: "button",
		              disabled: !writable || saving !== null,
		              style: { border: "none", background: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 12 },
		              onClick: () => removeTerm(t),
		              "aria-label": "删除 " + t,
		              children: "×"
		            }
		          )
		        ] }, t)) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: body, children: "暂无自定义词。添加后该词在任何位置出现都会被脱敏（含于长词也会命中）。" })
		      ] }),
		      error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: errorStyle, children: [
		        "写入失败：",
		        error
		      ] }) : null
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: body, children: [
		      "运行时开关不可用（settings 未挂载时保持配置文件模式）。",
		      error ? " " + error : ""
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: section, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionLabel, children: "使用说明" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: body, children: "发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: actionsRow, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: btnBase, onClick: copyStatusCommand, children: copiedStatus ? "已复制 ✓" : "复制状态" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          "button",
		          {
		            type: "button",
		            disabled: saving !== null,
		            style: btnBase,
		            onClick: copyUpdateCommand,
		            children: copied ? "已复制 ✓" : "复制更新命令"
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: body, children: "更新命令复制后在终端运行，并重启 DSH 生效；桌面版也可在「插件」页直接更新（见 docs/install.md）。" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: body, children: "此处为常用开关；案号/出生日期/严格模式等其余选项请在配置文件中调整（$DSH_HOME/profiles/<profile>/cordis.patch.yml）。" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: section, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionLabel, children: "关于" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: body, children: [
		        "适配宿主：",
		        DSH_SUPPORT,
		        "；功能随宿主能力自动降级。"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: disclaimerBox, children: [
		        "免责声明：",
		        DISCLAIMER
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: body, children: [
		        "作者：JunyuZhan · 项目：",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { style: linkStyle, href: "https://github.com/JunyuZhan/dsh-privmask", target: "_blank", rel: "noreferrer", children: "GitHub" }),
		        " ",
		        "· 问题反馈：",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { style: linkStyle, href: "https://github.com/JunyuZhan/dsh-privmask/issues", target: "_blank", rel: "noreferrer", children: "Issues" })
		      ] })
		    ] })
		  ] });
		}

		// client-src/index.ts
		var NS = "settings.privmask";
		var zh = {
		  tab: "隐私保护"
		};
		var en = {
		  tab: "Privacy"
		};
		var inject = ["slots", "locale"];
		function apply(ctx) {
		  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "privmask-ui: dictionaries");
		  const t = (key) => {
		    try {
		      return ctx.locale.bind(NS)(key);
		    } catch {
		      return zh[key] ?? key;
		    }
		  };
		  let inventory;
		  const inventoryReady = new Promise((resolve) => {
		    const timer = setTimeout(resolve, 2e3);
		    try {
		      ctx.inject(["remote", "remote.pluginInventory"], (sctx) => {
		        try {
		          const s = sctx;
		          if (typeof s.remote?.pluginInventory?.list === "function") inventory = s.remote.pluginInventory;
		        } catch {
		        }
		        clearTimeout(timer);
		        resolve();
		      });
		    } catch {
		      clearTimeout(timer);
		      resolve();
		    }
		  });
		  const ENTRY = "privmask";
		  function scopeFromSettingsScope(svc) {
		    return svc.bind({ namespace: ENTRY });
		  }
		  function scopeFromRemoteSettings(remote) {
		    const listeners = /* @__PURE__ */ new Set();
		    let snap = { status: "loading", writable: false };
		    const refresh = async () => {
		      const res = await remote.settings.describe();
		      const list2 = res && res.ok === true ? res.value?.namespaces ?? [] : [];
		      const ns = list2.find((n) => n.ns === ENTRY) ?? list2.find((n) => typeof n.ns === "string" && n.ns.endsWith("/" + ENTRY));
		      snap = ns === void 0 ? { status: "unavailable", writable: false } : { status: "ready", value: ns.value, revision: ns.revision, writable: res?.value?.writable === true };
		      for (const l of listeners) l();
		    };
		    void refresh().catch(() => {
		      snap = { status: "unavailable", writable: false };
		      for (const l of listeners) l();
		    });
		    return {
		      getSnapshot: () => snap,
		      subscribe: (l) => {
		        listeners.add(l);
		        return () => {
		          listeners.delete(l);
		        };
		      },
		      set: async (field, value) => {
		        const res = await remote.settings.update(ENTRY, { [field]: value }, snap.revision);
		        if (!res || res.ok !== true) {
		          throw new Error("settings.update failed: " + String(res?.error?.message ?? "unknown"));
		        }
		        await refresh();
		      }
		    };
		  }
		  let scope;
		  const scopeReady = new Promise((resolve) => {
		    const timer = setTimeout(resolve, 2e3);
		    let pending = 2;
		    const done = () => {
		      if (--pending === 0) {
		        clearTimeout(timer);
		        resolve();
		      }
		    };
		    const probe = (deps, pick) => {
		      try {
		        ctx.inject(deps, (sctx) => {
		          try {
		            const candidate = pick(sctx);
		            if (candidate !== void 0 && scope === void 0) scope = candidate;
		          } catch {
		          }
		          done();
		        });
		      } catch {
		        done();
		      }
		    };
		    probe(["settingsScope"], (sctx) => {
		      const svc = sctx.settingsScope;
		      return svc === void 0 ? void 0 : scopeFromSettingsScope(svc);
		    });
		    probe(["remote", "remote.settings"], (sctx) => {
		      const remote = sctx.remote;
		      return remote?.settings === void 0 ? void 0 : scopeFromRemoteSettings(remote);
		    });
		  });
		  const requireScope = async () => {
		    await scopeReady;
		    if (scope === void 0) {
		      throw new Error("宿主未提供设置 API（既无 settingsScope 也无 remote.settings）：请改用配置文件模式（$DSH_HOME/profiles/<profile>/cordis.patch.yml）");
		    }
		    return scope;
		  };
		  const waitReady = async () => {
		    const scope2 = await requireScope();
		    const current = scope2.getSnapshot();
		    if (current.status === "ready" || current.status === "unavailable") return current;
		    return new Promise((resolve, reject) => {
		      let settled = false;
		      let off = () => {
		      };
		      let timer = null;
		      const finish = (ok, value) => {
		        if (settled) return;
		        settled = true;
		        if (timer !== null) clearTimeout(timer);
		        off();
		        if (ok) resolve(value);
		        else reject(value);
		      };
		      timer = setTimeout(
		        () => finish(false, new Error("settings 读取超时（settings 未挂载时保持配置文件模式）")),
		        4e3
		      );
		      off = scope2.subscribe(() => {
		        const snap = scope2.getSnapshot();
		        if (snap.status === "ready" || snap.status === "unavailable") finish(true, snap);
		      });
		    });
		  };
		  const list = async () => {
		    await inventoryReady;
		    if (inventory === void 0) {
		      const snap = await waitReady().catch(() => null);
		      const enabled = snap === null || snap.status === "loading" ? null : snap.status === "ready";
		      return {
		        entries: [{
		          entryId: "privmask",
		          moduleName: "dsh-privmask",
		          enabled,
		          fiberPhase: enabled === null ? "unknown" : enabled ? "active" : "inactive"
		        }]
		      };
		    }
		    const result = await inventory.list();
		    if (!result.ok) {
		      throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? "unknown")}`);
		    }
		    return result.value;
		  };
		  const describe = async () => {
		    const snap = await waitReady();
		    if (snap.status !== "ready" || snap.value === void 0) {
		      throw new Error("privmask 命名空间不可用（settings 未挂载时保持配置文件模式）");
		    }
		    return {
		      writable: snap.writable,
		      namespaces: [{ ns: "privmask", value: snap.value, revision: snap.revision }]
		    };
		  };
		  const update = async (ns, patch, rev) => {
		    if (ns !== "privmask") {
		      throw new Error(`settings.update failed: unknown namespace ${ns}`);
		    }
		    void rev;
		    const s = await requireScope();
		    const before = s.getSnapshot();
		    for (const [key, value] of Object.entries(patch)) {
		      await s.set(key, value);
		    }
		    const after = s.getSnapshot();
		    if (after.revision === before.revision) {
		      throw new Error("settings.update failed: 写入未生效（版本冲突或权限不足）");
		    }
		    return { value: { value: after.value, revision: after.revision } };
		  };
		  ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
		    name: "settings.plugins.tab",
		    id: "privmask",
		    order: 20,
		    label: () => t("tab"),
		    locale: NS,
		    inject: () => ({ list, describe, update })
		  }, PrivmaskCard));
		}
		return module.exports;
	}
});
