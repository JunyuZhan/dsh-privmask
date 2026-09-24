/** dsh-privmask 浏览器 half：在 设置→插件 里注册「隐私保护」卡片（状态 + 运行时开关）。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { PrivmaskCard, type PrivmaskCardInjected } from './PrivmaskCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.privmask': Record<string, string>
  }
}

export const NS = 'settings.privmask'

const zh: Record<string, string> = {
  tab: '隐私保护',
}

const en: Record<string, string> = {
  tab: 'Privacy',
}

/**
 * 客户端服务依赖。
 * 只声明官方 dsh（0.1.0-rc.6 / 0.1.1-rc.2）与 0.1.2-alpha.1 开发线都提供的服务：
 * `settingsScope` 是两线共有的命名空间作用域服务（由 dsh-client-ui-settings 提供），
 * 取代 0.1.2 才引入的 `remote.settings`，保证旧官方包不因缺失服务停在 PENDING。
 * `remote.pluginInventory` **不能**写进这份清单：DSH Desktop（desktop profile）的客户端运行时
 * 没有该服务，硬声明会让整个模块停在 PENDING、卡片永不注册（issue #2）。它是可选依赖，
 * 改为下面按能力软注入，拿不到时卡片降级为「插件状态未知」。
 * `settingsScope` 同理不能硬声明：0.1.7 起上游把客户端设置 API 换成了 `remote.settings`，
 * 它现在也走软注入（见 resolveScope），两代 API 任一可用即可，都没有时卡片仍注册、只提示用配置文件模式。
 */
export const inject = ['slots', 'locale']

/** 注册隐私保护卡片到 设置→插件 页签。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'privmask-ui: dictionaries')

  const t = (key: string): string => {
    try {
      return ctx.locale.bind(NS)(key)
    } catch {
      return zh[key] ?? key
    }
  }

  /**
   * 插件清单（可选依赖，软注入）：只有宿主提供 `remote.pluginInventory` 时才取用。
   * web profile 下用它显示「插件已启用/未启用」；desktop 等无该服务的宿主保持 undefined，
   * `list()` 抛错后卡片显示「插件状态未知」，其余开关走 settingsScope 不受影响。
   */
  type PluginInventory = {
    list(): Promise<{ ok: boolean; value: unknown; error?: { message: string } }>
  }
  let inventory: PluginInventory | undefined
  // cordis 的软注入回调是异步落地的，而卡片挂载时就会读 list()；
  // 不等它落地就会误报「插件状态未知」（0.2.43 真机实测）。
  const inventoryReady = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000)
    try {
      // 注意：必须把 `remote` 与 `remote.pluginInventory` 一起软注入——cordis 只允许访问
      // 已注入的服务属性，只声明后者时 `sctx.remote` 仍会被拦下（真机实测）。
      ctx.inject(['remote', 'remote.pluginInventory'], (sctx) => {
        try {
          const s = sctx as unknown as { remote?: { pluginInventory?: PluginInventory } }
          if (typeof s.remote?.pluginInventory?.list === 'function') inventory = s.remote.pluginInventory
        } catch { /* 该宿主未暴露 remote 命名空间 */ }
        clearTimeout(timer)
        resolve()
      })
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })

  /** 卡片读写设置用的最小作用域接口：两代宿主 API 都适配成它。 */
  interface PrivmaskScopeSnapshot {
    status: 'loading' | 'ready' | 'unavailable'
    value?: Record<string, unknown>
    revision?: number
    writable: boolean
  }
  interface PrivmaskScope {
    getSnapshot(): PrivmaskScopeSnapshot
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
  }
  const ENTRY = 'privmask'

  /** 旧形态（0.1.2–0.1.5）：settingsScope.bind({namespace}) */
  function scopeFromSettingsScope(svc: { bind(spec: { namespace: string }): PrivmaskScope }): PrivmaskScope {
    return svc.bind({ namespace: ENTRY })
  }

  /** 新形态（0.1.7+）：remote.settings.describe()/update(ns, patch, revision)，适配成同一接口 */
  function scopeFromRemoteSettings(remote: {
    settings: {
      describe(): Promise<{ ok: boolean; value?: { writable?: boolean; namespaces?: Array<{ ns: string; value: unknown; revision: number }> }; error?: { message?: string } }>
      update(ns: string, patch: Record<string, unknown>, revision?: number): Promise<{ ok: boolean; value?: { revision?: number }; error?: { message?: string } }>
    }
  }): PrivmaskScope {
    const listeners = new Set<() => void>()
    let snap: PrivmaskScopeSnapshot = { status: 'loading', writable: false }
    const refresh = async (): Promise<void> => {
      const res = await remote.settings.describe()
      const ns = res && res.ok === true
        ? (res.value?.namespaces ?? []).find((n) => n.ns === ENTRY)
        : undefined
      snap = ns === undefined
        ? { status: 'unavailable', writable: false }
        : { status: 'ready', value: ns.value as Record<string, unknown>, revision: ns.revision, writable: res?.value?.writable === true }
      for (const l of listeners) l()
    }
    void refresh().catch(() => {
      snap = { status: 'unavailable', writable: false }
      for (const l of listeners) l()
    })
    return {
      getSnapshot: () => snap,
      subscribe: (l) => {
        listeners.add(l)
        return () => { listeners.delete(l) }
      },
      set: async (field, value) => {
        const res = await remote.settings.update(ENTRY, { [field]: value }, snap.revision)
        if (!res || res.ok !== true) {
          throw new Error('settings.update failed: ' + String(res?.error?.message ?? 'unknown'))
        }
        await refresh()
      },
    }
  }

  /** 按宿主能力选一套设置 API；两代都没有时保持 undefined，卡片仍注册但开关会给出明确错误。 */
  let scope: PrivmaskScope | undefined
  const scopeReady = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000)
    let pending = 2
    const done = () => { if (--pending === 0) { clearTimeout(timer); resolve() } }
    const probe = (deps: string[], pick: (sctx: unknown) => PrivmaskScope | undefined) => {
      try {
        ctx.inject(deps, (sctx) => {
          try {
            const candidate = pick(sctx)
            if (candidate !== undefined && scope === undefined) scope = candidate
          } catch { /* 该宿主未暴露对应命名空间 */ }
          done()
        })
      } catch { done() }
    }
    probe(['settingsScope'], (sctx) => {
      const svc = (sctx as { settingsScope?: { bind(spec: { namespace: string }): PrivmaskScope } }).settingsScope
      return svc === undefined ? undefined : scopeFromSettingsScope(svc)
    })
    probe(['remote', 'remote.settings'], (sctx) => {
      const remote = (sctx as { remote?: { settings?: unknown } }).remote
      return remote?.settings === undefined ? undefined : scopeFromRemoteSettings(remote as Parameters<typeof scopeFromRemoteSettings>[0])
    })
  })
  const requireScope = async (): Promise<PrivmaskScope> => {
    await scopeReady
    if (scope === undefined) {
      throw new Error('宿主未提供设置 API（既无 settingsScope 也无 remote.settings）：请改用配置文件模式（$DSH_HOME/profiles/<profile>/cordis.patch.yml）')
    }
    return scope
  }

  /** 等 scope 首次就绪；4 秒超时降级为“配置文件模式”可见错误。 */
  const waitReady = async (): Promise<PrivmaskScopeSnapshot> => {
    const scope = await requireScope()
    const current = scope.getSnapshot()
    if (current.status === 'ready' || current.status === 'unavailable') return current
    return new Promise((resolve, reject) => {
      let settled = false
      let off = () => {}
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (ok: boolean, value: PrivmaskScopeSnapshot | Error) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        off()
        if (ok) resolve(value as PrivmaskScopeSnapshot)
        else reject(value)
      }
      timer = setTimeout(
        () => finish(false, new Error('settings 读取超时（settings 未挂载时保持配置文件模式）')),
        4000,
      )
      off = scope.subscribe(() => {
        const snap = scope.getSnapshot()
        if (snap.status === 'ready' || snap.status === 'unavailable') finish(true, snap)
      })
    })
  }

  const list: PrivmaskCardInjected['list'] = async () => {
    await inventoryReady
    if (inventory === undefined) {
      // 宿主没有 remote.pluginInventory（如 DSH Desktop）：唯一可用的信号是 settings 命名空间——
      // 它由本插件的 host 半边注册，命名空间就绪即说明插件在跑。据此给出状态而不是一律「未知」。
      const snap = await waitReady().catch(() => null)
      const enabled = snap === null || snap.status === 'loading' ? null : snap.status === 'ready'
      return {
        entries: [{
          entryId: 'privmask',
          moduleName: 'dsh-privmask',
          enabled,
          fiberPhase: enabled === null ? 'unknown' : enabled ? 'active' : 'inactive',
        }],
      } as PrivmaskCardInjected['list'] extends () => Promise<infer T> ? T : never
    }
    const result = await inventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? 'unknown')}`)
    }
    return result.value as PrivmaskCardInjected['list'] extends () => Promise<infer T> ? T : never
  }

  const describe: PrivmaskCardInjected['describe'] = async () => {
    const snap = await waitReady()
    if (snap.status !== 'ready' || snap.value === undefined) {
      throw new Error('privmask 命名空间不可用（settings 未挂载时保持配置文件模式）')
    }
    return {
      writable: snap.writable,
      namespaces: [{ ns: 'privmask', value: snap.value, revision: snap.revision }],
    }
  }

  const update: PrivmaskCardInjected['update'] = async (ns, patch, rev) => {
    if (ns !== 'privmask') {
      throw new Error(`settings.update failed: unknown namespace ${ns}`)
    }
    void rev // scope.set 内部以最新已知 revision 作为 expectedRevision，比卡片持有的更可靠
    const s = await requireScope()
    const before = s.getSnapshot()
    for (const [key, value] of Object.entries(patch)) {
      await s.set(key, value)
    }
    const after = s.getSnapshot()
    if (after.revision === before.revision) {
      throw new Error('settings.update failed: 写入未生效（版本冲突或权限不足）')
    }
    return { value: { value: after.value, revision: after.revision } }
  }

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'privmask',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: (): PrivmaskCardInjected => ({ list, describe, update }),
  }, PrivmaskCard))
}
