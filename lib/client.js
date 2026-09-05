window.__ModuleLoader__.load({
	id: "dsh-privmask",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		/** 插件版本（与 package.json 同步，由测试强制一致，避免发版漂移） */
		const PLUGIN_VERSION = "0.2.38";
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
		const chipBase = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			border: "1px solid var(--dsh-border, #555)",
			borderRadius: 999,
			padding: "2px 10px",
			fontSize: 12
		};
		const inputBase = {
			flex: 1,
			border: "1px solid var(--dsh-border, #555)",
			borderRadius: 6,
			padding: "4px 8px",
			fontSize: 13,
			background: "transparent",
			color: "inherit"
		};
		const errorStyle = {
			fontSize: 12,
			color: "#e5484d"
		};
		const linkStyle = {
			color: "inherit"
		};
		/** 插件适配的 dsh 宿主范围（与 README 一致；功能随宿主能力自动降级） */
		const DSH_SUPPORT = "dsh 0.1.0-rc.6+（官方 npm）与 0.1.2 开发线";
		/** 简版责任声明（完整版见 README「责任与边界」） */
		const DISCLAIMER = "脱敏为启发式本地处理，无法保证零漏检；重要数据请自行评估并保留原文。";
		function PrivmaskCard(props) {
			const [enabled, setEnabled] = (0, react.useState)(null);
			const [cfg, setCfg] = (0, react.useState)(null);
			const [revision, setRevision] = (0, react.useState)(void 0);
			const [writable, setWritable] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const [termInput, setTermInput] = (0, react.useState)("");
			const [terms, setTerms] = (0, react.useState)([]);
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
			const factsSomeOn = field("redactNames") || field("redactCompanies") || field("redactOrgs");
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
			/** 增删自定义敏感词（写入 settings，live 生效） */
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
					} else setError("设置已保存但返回异常，请刷新后重试");
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				} finally {
					setSaving(null);
				}
			};
			/** 一次可添加多个词：以 ; ； , ， 、 换行 分隔，自动去重并忽略空项 */
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
				saveTerms(next);
			};
			const removeTerm = (t) => {
				saveTerms(terms.filter((x) => x !== t));
			};
			/** 复制更新命令到剪贴板（clipboard API，带 textarea 兜底） */
			const copyUpdateCommand = () => {
				const cmd = "dsh plugin --profile web update dsh-privmask";
				const done = () => {
					setCopied(true);
					setTimeout(() => setCopied(false), 3000);
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
				} else fallback();
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
			// 顶部展示的是“插件装载状态”，与下方配置项“总开关（已开启/已关闭）”语义不同，
			// 用“已启用/未启用”措辞区分，避免关闭总开关后顶部仍显示“已开启”的困惑。
			return (0, react_jsx_runtime.jsxs)("div", {
				style: row,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: title,
						children: ["隐私保护：", enabled === true ? "插件已启用" : enabled === false ? "插件未启用" : "插件状态未知"]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 12,
							color: "var(--dsh-text-2, #888)"
						},
						children: "插件版本：v" + PLUGIN_VERSION
					}),
					writable && cfg !== null ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						switchRow("enabled", "总开关"),
						(0, react_jsx_runtime.jsxs)("div", {
							style: line,
							children: [(0, react_jsx_runtime.jsxs)("span", { children: ["全面脱敏（姓名/公司/机关）：", factsOn ? "已开启" : factsSomeOn ? "部分开启" : "已关闭"] }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !writable || saving !== null,
								style: {
									...btnBase,
									opacity: writable ? 1 : .5
								},
								onClick: toggleFacts,
								children: factsOn ? "关闭" : "全部开启"
							})]
						}),
						switchRow("redactAddress", "地址"),
						switchRow("redactCredentials", "密钥凭据"),
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									style: { fontSize: 13 },
									children: "自定义敏感词（当事人姓名/别名/机构简称）："
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8,
										alignItems: "center"
									},
									children: [(0, react_jsx_runtime.jsx)("input", {
										style: inputBase,
										value: termInput,
										placeholder: "输入敏感词（可用 ; ； , ， 、 分隔一次添加多个），回车或点添加",
										onChange: (e) => setTermInput(e.target.value),
										onKeyDown: (e) => {
											if (e.key === "Enter") addTerm();
										}
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: !writable || saving !== null,
										style: btnBase,
										onClick: addTerm,
										children: "添加"
									})]
								}),
								terms.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										flexWrap: "wrap",
										gap: 6
									},
									children: terms.map((t) => (0, react_jsx_runtime.jsxs)("span", {
										style: chipBase,
										children: [t, (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											disabled: !writable || saving !== null,
											style: {
												border: "none",
												background: "none",
												cursor: "pointer",
												color: "inherit",
												padding: 0,
												fontSize: 12
											},
											onClick: () => removeTerm(t),
											"aria-label": "删除 " + t,
											children: "×"
										})]
									}, t))
								}) : (0, react_jsx_runtime.jsx)("div", {
									style: body,
									children: "暂无自定义词。添加后该词在任何位置出现都会被脱敏（含于长词也会命中）。"
								})
							]
						}),
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
						children: "发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。"
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: line,
						children: [(0, react_jsx_runtime.jsx)("span", {
							children: "更新："
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: saving !== null,
							style: btnBase,
							onClick: copyUpdateCommand,
							children: copied ? "已复制 ✓" : "复制更新命令"
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: "复制后在终端运行该命令，并重启 dsh web 生效。"
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: "此处为常用开关；案号/出生日期/严格模式等其余选项请在配置文件中调整（$DSH_HOME/profiles/web/cordis.patch.yml）。"
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: DSH_SUPPORT + "；功能随宿主能力自动降级。"
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: DISCLAIMER
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: body,
						children: ["作者：JunyuZhan · 项目：", (0, react_jsx_runtime.jsx)("a", {
							style: linkStyle,
							href: "https://github.com/JunyuZhan/dsh-privmask",
							target: "_blank",
							rel: "noreferrer",
							children: "GitHub"
						}), " · 问题反馈：", (0, react_jsx_runtime.jsx)("a", {
							style: linkStyle,
							href: "https://github.com/JunyuZhan/dsh-privmask/issues",
							target: "_blank",
							rel: "noreferrer",
							children: "Issues"
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		/** dsh-privmask 浏览器 half：在 设置→插件 里注册「隐私保护」卡片（状态 + 运行时开关）。 */
		const NS = "settings.privmask";
		const zh = {
			tab: "隐私保护"
		};
		const en = {
			tab: "Privacy"
		};
		/**
		 * 客户端服务依赖。
		 * 只声明官方 dsh（0.1.0-rc.6 / 0.1.1-rc.2）与 0.1.2-alpha.1 开发线都提供的服务：
		 * settingsScope 是两线共有的命名空间作用域服务（由 dsh-client-ui-settings 提供），
		 * 取代 0.1.2 才引入的 remote.settings，保证旧官方包不因缺失服务停在 PENDING。
		 */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginInventory",
			"settingsScope"
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
			/** settingsScope 命名空间作用域：官方 0.1.0-rc.6+ 与 0.1.2 开发线通用。 */
			const scope = ctx.settingsScope.bind({
				namespace: "privmask"
			});
			/** 等 scope 首次就绪；4 秒超时降级为“配置文件模式”可见错误。 */
			const waitReady = async () => {
				const current = scope.getSnapshot();
				if (current.status === "ready" || current.status === "unavailable") return current;
				return new Promise((resolve, reject) => {
					let settled = false;
					let off = () => {};
					let timer = null;
					const finish = (ok, value) => {
						if (settled) return;
						settled = true;
						if (timer !== null) clearTimeout(timer);
						off();
						if (ok) resolve(value);
						else reject(value);
					};
					timer = setTimeout(() => finish(false, new Error("settings 读取超时（settings 未挂载时保持配置文件模式）")), 4000);
					off = scope.subscribe(() => {
						const snap = scope.getSnapshot();
						if (snap.status === "ready" || snap.status === "unavailable") finish(true, snap);
					});
				});
			};
			const list = async () => {
				const result = await remote.pluginInventory.list();
				if (!result.ok) throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? "unknown")}`);
				return result.value;
			};
			const describe = async () => {
				const snap = await waitReady();
				if (snap.status !== "ready" || snap.value === undefined) {
					throw new Error("privmask 命名空间不可用（settings 未挂载时保持配置文件模式）");
				}
				return {
					writable: snap.writable,
					namespaces: [{
						ns: "privmask",
						value: snap.value,
						revision: snap.revision
					}]
				};
			};
			const update = async (ns, patch, rev) => {
				if (ns !== "privmask") throw new Error(`settings.update failed: unknown namespace ${ns}`);
				void rev;
				const before = scope.getSnapshot();
				for (const [key, value] of Object.entries(patch)) {
					await scope.set(key, value);
				}
				const after = scope.getSnapshot();
				if (after.revision === before.revision) {
					throw new Error("settings.update failed: 写入未生效（版本冲突或权限不足）");
				}
				return {
					value: {
						value: after.value,
						revision: after.revision
					}
				};
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
