window.__ModuleLoader__.load({
	id: "dsh-privmask",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/client/PrivmaskCard.js
		/** 隐私保护状态卡片：展示 dsh-privmask 启停状态与脱敏范围说明。 */
		const row = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
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
		function PrivmaskCard(props) {
			const [enabled, setEnabled] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				props.list().then((snap) => {
					if (!alive) return;
					const entry = snap.entries.find((e) => e.moduleName === "dsh-privmask");
					setEnabled(entry ? entry.enabled : null);
				}).catch(() => {
					if (alive) setEnabled(null);
				});
				return () => {
					alive = false;
				};
			}, [props]);
			return (0, react_jsx_runtime.jsxs)("div", {
				style: row,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: title,
						children: ["隐私保护：", enabled === true ? "已开启" : enabled === false ? "已关闭" : "状态未知"]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: body,
						children: "发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符； 案号、出生日期、涉案金额保留。本地会话日志中的用户输入与工具结果同样遮罩。"
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
		/** dsh-privmask 浏览器 half：在 设置→插件 里注册「隐私保护」卡片。 */
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
		/** 客户端服务依赖。 */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginInventory"
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
			const list = async () => {
				const result = await ctx.remote.pluginInventory.list();
				if (!result.ok) throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? "unknown")}`);
				return result.value;
			};
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "privmask",
				order: 20,
				label: () => t("tab"),
				locale: NS,
				inject: () => ({ list })
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