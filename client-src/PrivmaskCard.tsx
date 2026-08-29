/** 隐私保护状态卡片：展示 dsh-privmask 启停状态与脱敏范围说明。 */

import { useEffect, useState } from 'react'

export interface PrivmaskCardInjected {
  list: () => Promise<{
    entries: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }>
  }>
}

const row: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const body: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-text-2, #888)' }

export function PrivmaskCard(props: PrivmaskCardInjected) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    props.list()
      .then((snap) => {
        if (!alive) return
        const entry = snap.entries.find((e) => e.moduleName === 'dsh-privmask')
        setEnabled(entry ? entry.enabled : null)
      })
      .catch(() => { if (alive) setEnabled(null) })
    return () => { alive = false }
  }, [props])

  const label = enabled === true ? '已开启' : enabled === false ? '已关闭' : '状态未知'
  return (
    <div style={row}>
      <div style={title}>隐私保护：{label}</div>
      <div style={body}>
        发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；
        案号、出生日期、涉案金额保留。本地会话日志中的用户输入与工具结果同样遮罩。
      </div>
      <div style={body}>更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。</div>
    </div>
  )
}
