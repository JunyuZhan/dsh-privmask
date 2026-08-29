/** 隐私保护卡片：启停状态 + 常用脱敏类别开关（dsh-settings 命名空间 live 生效）。 */

import { useEffect, useState } from 'react'

export interface PrivmaskCardInjected {
  list: () => Promise<{
    entries: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }>
  }>
  describe: () => Promise<{
    writable: boolean
    namespaces: Array<{ ns: string; value: Record<string, unknown>; revision: number }>
  }>
  update: (ns: string, patch: Record<string, unknown>, rev?: number) => Promise<{
    value?: { value: Record<string, unknown>; revision: number }
  }>
}

const row: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const body: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-text-2, #888)' }
const line: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
const toggleBase: React.CSSProperties = {
  border: '1px solid var(--dsh-border, #555)',
  borderRadius: 999,
  padding: '3px 12px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
}

export function PrivmaskCard(props: PrivmaskCardInjected) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [writable, setWritable] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    props.list()
      .then((snap) => {
        if (!alive) return
        const entry = snap.entries.find((e) => e.moduleName === 'dsh-privmask')
        setEnabled(entry ? entry.enabled : null)
      })
      .catch(() => { if (alive) setEnabled(null) })
    props.describe()
      .then((d) => {
        if (!alive) return
        setWritable(d.writable)
        const ns = d.namespaces.find((n) => n.ns === 'privmask')
        if (ns) {
          setCfg(ns.value)
          setRevision(ns.revision)
        }
      })
      .catch(() => { if (alive) { setWritable(false); setCfg(null) } })
    return () => { alive = false }
  }, [props])

  const toggle = async (field: string) => {
    if (cfg === null || saving !== null) return
    setSaving(field)
    try {
      const next = !Boolean(cfg[field])
      const result = await props.update('privmask', { [field]: next }, revision)
      if (result.value) {
        setCfg(result.value.value)
        setRevision(result.value.revision)
      } else {
        setCfg({ ...cfg, [field]: next })
      }
    } catch {
      /* 写失败保持原值 */
    } finally {
      setSaving(null)
    }
  }

  const field = (key: string): boolean => Boolean(cfg?.[key])
  const factsOn = field('redactNames') && field('redactCompanies') && field('redactOrgs')
  const toggleFacts = async () => {
    if (cfg === null || saving !== null) return
    const next = !factsOn
    setSaving('facts')
    try {
      const result = await props.update('privmask', { redactNames: next, redactCompanies: next, redactOrgs: next }, revision)
      if (result.value) {
        setCfg(result.value.value)
        setRevision(result.value.revision)
      } else {
        setCfg({ ...cfg, redactNames: next, redactCompanies: next, redactOrgs: next })
      }
    } catch {
      /* 写失败保持原值 */
    } finally {
      setSaving(null)
    }
  }
  const switchRow = (key: string, label: string) => (
    <div style={line} key={key}>
      <span>{label}</span>
      <button
        type="button"
        disabled={!writable || saving !== null}
        style={{ ...toggleBase, opacity: writable ? 1 : 0.5 }}
        onClick={() => toggle(key)}
      >
        {field(key) ? '开' : '关'}
      </button>
    </div>
  )

  const label = enabled === true ? '已开启' : enabled === false ? '已关闭' : '状态未知'
  return (
    <div style={row}>
      <div style={title}>隐私保护：{label}</div>
      {writable && cfg !== null ? (
        <>
          {switchRow('enabled', '总开关')}
          <div style={line}>
            <span>全面脱敏（姓名/公司/机关）</span>
            <button
              type="button"
              disabled={!writable || saving !== null}
              style={{ ...toggleBase, opacity: writable ? 1 : 0.5 }}
              onClick={toggleFacts}
            >
              {factsOn ? '开' : '关'}
            </button>
          </div>
          {switchRow('redactAddress', '地址')}
          {switchRow('redactCredentials', '密钥凭据')}
        </>
      ) : (
        <div style={body}>运行时开关不可用（settings 未挂载时保持配置文件模式）。</div>
      )}
      <div style={body}>
        发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；
        涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。
      </div>
      <div style={body}>更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。</div>
    </div>
  )
}
