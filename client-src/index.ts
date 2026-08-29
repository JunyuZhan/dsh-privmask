/** dsh-privmask 浏览器 half：在 设置→插件 里注册「隐私保护」卡片。 */

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
  on: '已开启',
  off: '已关闭',
  unknown: '状态未知',
  desc: '发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；案号、出生日期、涉案金额保留。',
  update: '更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。',
}

const en: Record<string, string> = {
  tab: 'Privacy',
  on: 'On',
  off: 'Off',
  unknown: 'Unknown',
  desc: 'Before sending to the cloud, names, IDs, phones, emails, addresses, companies and credentials are replaced with placeholders; case numbers, birth dates and amounts are kept.',
  update: 'Update: dsh plugin --profile web update dsh-privmask, then restart dsh web.',
}

/** 客户端服务依赖。 */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

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

  const list: PrivmaskCardInjected['list'] = async () => {
    const result = await (ctx as unknown as { remote: { pluginInventory: { list(): Promise<{ ok: boolean; value: unknown; error?: { message: string } }> } } }).remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${String(result.error?.message ?? 'unknown')}`)
    }
    return result.value as PrivmaskCardInjected['list'] extends () => Promise<infer T> ? T : never
  }

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'privmask',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: (): PrivmaskCardInjected => ({ list }),
  }, PrivmaskCard))
}
