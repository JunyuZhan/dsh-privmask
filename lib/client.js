window.__ModuleLoader__.load({
	id: "dsh-privmask",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/client/PrivmaskCard.js
		/** 隐私保护卡片：状态 + 常用脱敏类别开关（dsh-settings 命名空间 live 生效）。 */
		const row = {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: 16
		};
		const title = {
			fontSize: 15,
			fontWeight: 600
		};
		const body = {
			fontSize: 13,
			color: "var(--dsh-text-2, #888)"
		};
		const line = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		const btnBase = {
			border: "1px solid var(--dsh-border, #555)",
			borderRadius: 6,
			padding: "4px 14px",
			fontSize: 13,
			cursor: "pointer",
			background: "transparent",
			color: "inherit",
			minWidth: 64
		};
		const errorStyle = {
			fontSize: 12,
			color: "#e5484d"
		};
		function PrivmaskCard(props) {
			const [enabled, setEnabled] = (0, react.useState)(null);
			const [cfg, setCfg] = (0, react.useState)(null);
			const [revision, setRevision] = (0, react.useState)(void 0);
			const [writable, setWritable] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
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
			/** 点击动作：把字段翻转为相反值；成功后用服务端返回的解析值刷新显示 */
			const toggle = async (field) => {
				if (cfg === null || saving !== null) return;
				setSaving(field);
				setError(null);
				try {
					const next = !Boolean(cfg[field]);
					const result = await props.update("privmask", { [field]: next }, revision);
					if (result.value) {
						setCfg(result.value.value);
						setRevision(result.value.revision);
					} else setError("设置已保存但返回异常，请刷新后重试");
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				} finally {
					setSaving(null);
				}
			};
			const field = (key) => Boolean(cfg?.[key]);
			const factsOn = field("redactNames") && field("redactCompanies") && field("redactOrgs");
			const toggleFacts = async () => {
				if (cfg === null || saving !== null) return;
				setSaving("facts");
				setError(null);
				try {
					const next = !factsOn;
					const result = await props.update("privmask", {
						redactNames: next,
						redactCompanies: next,
						redactOrgs: next
					}, revision);
					if (result.value) {
						setCfg(result.value.value);
						setRevision(result.value.revision);
					} else setError("设置已保存但返回异常，请刷新后重试");
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				} finally {
					setSaving(null);
				}
			};
			/** 一行开关：状态文本（已开启/已关闭）+ 动作按钮（关闭/开启） */
			const switchRow = (key, label) => {
				const on = field(key);
				return (0, react_jsx_runtime.jsxs)("div", {
					style: line,
					children: [(0, react_jsx_runtime.jsxs)("span", { children: [
						label,
						"：",
						on ? "已开启" : "已关闭"
					] }), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: !writable || saving !== null,
						style: {
							...btnBase,
							opacity: writable ? 1 : .5
						},
						onClick: () => toggle(key),
						children: on ? "关闭" : "开启"
					})]
				}, key);
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				style: row,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: title,
						children: ["隐私保护：", enabled === true ? "已开启" : enabled === false ? "已关闭" : "状态未知"]
					}),
					writable && cfg !== null ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						switchRow("enabled", "总开关"),
						(0, react_jsx_runtime.jsxs)("div", {
							style: line,
							children: [(0, react_jsx_runtime.jsxs)("span", { children: ["全面脱敏（姓名/公司/机关）：", factsOn ? "已开启" : "已关闭"] }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !writable || saving !== null,
								style: {
									...btnBase,
									opacity: writable ? 1 : .5
								},
								onClick: toggleFacts,
								children: factsOn ? "关闭" : "开启"
							})]
						}),
						switchRow("redactAddress", "地址"),
						switchRow("redactCredentials", "密钥凭据"),
						error !== null ? (0, react_jsx_runtime.jsxs)("div", {
							style: errorStyle,
							children: ["写入失败：", error]
						}) : null
					] }) : (0, react_jsx_runtime.jsxs)("div", {
						style: body,
						children: ["运行时开关不可用（settings 未挂载时保持配置文件模式）。", error ? " " + error : ""]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: "发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符； 涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。"
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: "更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。"
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		/** dsh-privmask 浏览器 half：在 设置→插件 里注册「隐私保护」卡片（状态 + 运行时开关）。 */
		const NS = "settings.privmask";
		const zh = {
			tab: "隐私保护",
			on: "已开启",
			off: "已关闭",
			unknown: "状态未知",
			desc: "发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；案号、出生日期、涉案金额保留。",
			update: "更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。"
		};
		const en = {
			tab: "Privacy",
			on: "On",
			off: "Off",
			unknown: "Unknown",
			desc: "Before sending to the cloud, names, IDs, phones, emails, addresses, companies and credentials are replaced with placeholders; case numbers, birth dates and amounts are kept.",
			update: "Update: dsh plugin --profile web update dsh-privmask, then restart dsh web."
		};
		/** 客户端服务依赖（remote.settings 提供命名空间读写）。 */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginInventory",
			"remote.settings"
		];
		/** 注册隐私保护卡片到 设置→插件 页签。 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "privmask-ui: dictionaries");
			const t = (key) => {
				try {
					return ctx.locale.bind(NS)(key);
				} catch {
					return zh[key] ?? key;
				}
			};
			const remote = ctx.remote;
			const list = async () => {
				const result = await remote.pluginInventory.list();
				if (!result.ok) throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? "unknown")}`);
				return result.value;
			};
			const describe = async () => {
				const result = await remote.settings.describe();
				if (!result.ok) throw new Error(`settings.describe failed: ${String(result.error?.message ?? "unknown")}`);
				return result.value;
			};
			const update = async (ns, patch, rev) => {
				const ops = Object.entries(patch).map(([path, value]) => ({
					op: "set",
					path: [path],
					value
				}));
				const result = await remote.settings.mutate(ns, ops, rev);
				if (!result.ok) throw new Error(`settings.update failed: ${String(result.error?.message ?? "unknown")}`);
				return result.value;
			};
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "privmask",
				order: 20,
				label: () => t("tab"),
				locale: NS,
				inject: () => ({
					list,
					describe,
					update
				})
			}, PrivmaskCard));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map