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
 */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'settingsScope']

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

  const remote = (ctx as unknown as {
    remote: {
      pluginInventory: {
        list(): Promise<{ ok: boolean; value: unknown; error?: { message: string } }>
      }
    }
  }).remote

  /** settingsScope 命名空间作用域：官方 0.1.0-rc.6+ 与 0.1.2 开发线通用。 */
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
  const scope = (ctx as unknown as { settingsScope: { bind(spec: { namespace: string }): PrivmaskScope } })
    .settingsScope.bind({ namespace: 'privmask' })

  /** 等 scope 首次就绪；4 秒超时降级为“配置文件模式”可见错误。 */
  const waitReady = async (): Promise<PrivmaskScopeSnapshot> => {
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
    const result = await remote.pluginInventory.list()
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
    const before = scope.getSnapshot()
    for (const [key, value] of Object.entries(patch)) {
      await scope.set(key, value)
    }
    const after = scope.getSnapshot()
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
