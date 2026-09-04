/** 隐私保护卡片：状态 + 常用脱敏类别开关（dsh-settings 命名空间 live 生效）。 */

import { useEffect, useState } from 'react'

export interface PrivmaskCardInjected {
  list: () => Promise<{
    entries: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }>
  }>
  describe: () => Promise<{
    writable: boolean
    namespaces: Array<{ ns: string; value: Record<string, unknown>; revision?: number }>
  }>
  /** 按字段写回（内部转成官方 mutate 操作），返回写入后的解析值 */
  update: (ns: string, patch: Record<string, unknown>, rev?: number) => Promise<{
    value?: { value: Record<string, unknown>; revision?: number }
  }>
}

const row: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const body: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-text-2, #888)' }
const line: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
const btnBase: React.CSSProperties = {
  border: '1px solid var(--dsh-border, #555)',
  borderRadius: 6,
  padding: '4px 14px',
  fontSize: 13,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
  minWidth: 64,
}
const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--dsh-border, #555)',
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 12,
}
const inputBase: React.CSSProperties = {
  flex: 1,
  border: '1px solid var(--dsh-border, #555)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 13,
  background: 'transparent',
  color: 'inherit',
}
const errorStyle: React.CSSProperties = { fontSize: 12, color: '#e5484d' }

export function PrivmaskCard(props: PrivmaskCardInjected) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [writable, setWritable] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [termInput, setTermInput] = useState('')
  const [terms, setTerms] = useState<string[]>([])

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
          setTerms(Array.isArray(ns.value.customTerms) ? ns.value.customTerms.map(String) : [])
          setError(null)
        }
      })
      .catch((e) => { if (alive) { setWritable(false); setCfg(null); setError(String(e && e.message ? e.message : e)) } })
    return () => { alive = false }
  }, [props])

  /** 点击动作：把字段翻转为相反值；成功后用服务端返回的解析值刷新显示 */
  const toggle = async (field: string) => {
    if (cfg === null || saving !== null) return
    setSaving(field)
    setError(null)
    try {
      const next = !Boolean(cfg[field])
      const result = await props.update('privmask', { [field]: next }, revision)
      if (result.value) {
        setCfg(result.value.value)
        setRevision(result.value.revision)
      } else {
        setError('设置已保存但返回异常，请刷新后重试')
      }
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    } finally {
      setSaving(null)
    }
  }

  const field = (key: string): boolean => Boolean(cfg?.[key])
  const factsOn = field('redactNames') && field('redactCompanies') && field('redactOrgs')
  const toggleFacts = async () => {
    if (cfg === null || saving !== null) return
    setSaving('facts')
    setError(null)
    try {
      const next = !factsOn
      const result = await props.update('privmask', { redactNames: next, redactCompanies: next, redactOrgs: next }, revision)
      if (result.value) {
        setCfg(result.value.value)
        setRevision(result.value.revision)
      } else {
        setError('设置已保存但返回异常，请刷新后重试')
      }
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    } finally {
      setSaving(null)
    }
  }

  /** 增删自定义敏感词（写入 settings，live 生效） */
  const saveTerms = async (next: string[]) => {
    if (cfg === null || saving !== null) return
    setSaving('terms')
    setError(null)
    try {
      const result = await props.update('privmask', { customTerms: next }, revision)
      if (result.value) {
        setCfg(result.value.value)
        setRevision(result.value.revision)
        setTerms(Array.isArray(result.value.value.customTerms) ? result.value.value.customTerms.map(String) : [])
      } else {
        setError('设置已保存但返回异常，请刷新后重试')
      }
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    } finally {
      setSaving(null)
    }
  }

  const addTerm = () => {
    const t = termInput.trim()
    if (!t) return
    if (terms.includes(t)) { setTermInput(''); return }
    setTermInput('')
    void saveTerms([...terms, t])
  }

  const removeTerm = (t: string) => {
    void saveTerms(terms.filter((x) => x !== t))
  }

  /** 一行开关：状态文本（已开启/已关闭）+ 动作按钮（关闭/开启） */
  const switchRow = (key: string, label: string) => {
    const on = field(key)
    return (
      <div style={line} key={key}>
        <span>{label}：{on ? '已开启' : '已关闭'}</span>
        <button
          type="button"
          disabled={!writable || saving !== null}
          style={{ ...btnBase, opacity: writable ? 1 : 0.5 }}
          onClick={() => toggle(key)}
        >
          {on ? '关闭' : '开启'}
        </button>
      </div>
    )
  }

  const label = enabled === true ? '已开启' : enabled === false ? '已关闭' : '状态未知'
  return (
    <div style={row}>
      <div style={title}>隐私保护：{label}</div>
      {writable && cfg !== null ? (
        <>
          {switchRow('enabled', '总开关')}
          <div style={line}>
            <span>全面脱敏（姓名/公司/机关）：{factsOn ? '已开启' : '已关闭'}</span>
            <button
              type="button"
              disabled={!writable || saving !== null}
              style={{ ...btnBase, opacity: writable ? 1 : 0.5 }}
              onClick={toggleFacts}
            >
              {factsOn ? '关闭' : '开启'}
            </button>
          </div>
          {switchRow('redactAddress', '地址')}
          {switchRow('redactCredentials', '密钥凭据')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>自定义敏感词（当事人姓名/别名/机构简称）：</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={inputBase}
                value={termInput}
                placeholder="输入敏感词，回车或点添加"
                onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTerm() }}
              />
              <button type="button" disabled={!writable || saving !== null} style={btnBase} onClick={addTerm}>添加</button>
            </div>
            {terms.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {terms.map((t) => (
                  <span style={chipBase} key={t}>
                    {t}
                    <button
                      type="button"
                      disabled={!writable || saving !== null}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 12 }}
                      onClick={() => removeTerm(t)}
                      aria-label={'删除 ' + t}
                    >×</button>
                  </span>
                ))}
              </div>
            ) : (
              <div style={body}>暂无自定义词。添加后该词在任何位置出现都会被脱敏（含于长词也会命中）。</div>
            )}
          </div>
          {error !== null ? <div style={errorStyle}>写入失败：{error}</div> : null}
        </>
      ) : (
        <div style={body}>运行时开关不可用（settings 未挂载时保持配置文件模式）。{error ? ' ' + error : ''}</div>
      )}
      <div style={body}>
        发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；
        涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。
      </div>
      <div style={body}>更新：dsh plugin --profile web update dsh-privmask，然后重启 dsh web。</div>
    </div>
  )
}
