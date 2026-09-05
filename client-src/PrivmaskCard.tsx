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
const linkStyle: React.CSSProperties = { color: 'inherit' }
/** 插件适配的 dsh 宿主范围（与 README 一致；功能随宿主能力自动降级） */
export const DSH_SUPPORT = 'dsh 0.1.0-rc.6+（官方 npm）与 0.1.2 开发线'
/** 简版责任声明（完整版见 README「责任与边界」） */
export const DISCLAIMER = '脱敏为启发式本地处理，无法保证零漏检；重要数据请自行评估并保留原文。'
/** 插件版本（与 package.json 同步；accuracy 测试强制一致，避免发版漂移） */
export const PLUGIN_VERSION = '0.2.42'

export function PrivmaskCard(props: PrivmaskCardInjected) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [writable, setWritable] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedStatus, setCopiedStatus] = useState(false)
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
  const factsSomeOn = field('redactNames') || field('redactCompanies') || field('redactOrgs')
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

  /** 一次可添加多个词：以 ; ； , ， 、 换行 分隔，自动去重并忽略空项 */
  const TERM_SPLIT = /[;；,，、\n]+/
  const addTerm = () => {
    const raw = termInput.trim()
    if (!raw) return
    const next = [...terms]
    for (const part of raw.split(TERM_SPLIT)) {
      const t = part.trim()
      if (t && !next.includes(t)) next.push(t)
    }
    if (next.length === terms.length) { setTermInput(''); return }
    setTermInput('')
    void saveTerms(next)
  }

  const removeTerm = (t: string) => {
    void saveTerms(terms.filter((x) => x !== t))
  }

  /** 复制更新命令到剪贴板（clipboard API，带 textarea 兜底） */
  const copyUpdateCommand = () => {
    const cmd = 'dsh plugin --profile web update dsh-privmask'
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    }
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = cmd
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) done()
        else setError('复制失败，请手动输入：' + cmd)
      } catch {
        setError('无法复制，请手动输入：' + cmd)
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(done).catch(fallback)
    } else {
      fallback()
    }
  }

  /** 复制当前生效配置摘要（供审计/截图留档） */
  const copyStatusCommand = () => {
    const text = statusText()
    const done = () => {
      setCopiedStatus(true)
      setTimeout(() => setCopiedStatus(false), 3000)
    }
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) done()
        else setError('复制失败，请重试')
      } catch {
        setError('复制失败，请重试')
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback)
    } else fallback()
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

  // 顶部展示的是“插件装载状态”，与下方配置项“总开关（已开启/已关闭）”语义不同，
  // 用“已启用/未启用”措辞区分，避免关闭总开关后顶部仍显示“已开启”的困惑。
  const label = enabled === true ? '插件已启用' : enabled === false ? '插件未启用' : '插件状态未知'
  const active = [
    field('redactNames') ? '姓名' : '',
    field('redactCompanies') ? '公司' : '',
    field('redactOrgs') ? '机关' : '',
    field('redactAddress') ? '地址' : '',
    field('redactCredentials') ? '密钥凭据' : '',
  ].filter(Boolean)
  const kept = [
    !field('redactCaseNumbers') ? '案号' : '',
    !field('redactDob') ? '出生日期' : '',
    !field('redactPaths') ? '文件路径' : '',
  ].filter(Boolean)
  const statusText = () =>
    'dsh-privmask v' + PLUGIN_VERSION + ' · 生效脱敏：' + (active.join('、') || '无') + '；保留：' + (kept.join('、') || '无')
  return (
    <div style={row}>
      <div style={title}>隐私保护：{label}</div>
      <div style={{ fontSize: 12, color: 'var(--dsh-text-2, #888)' }}>插件版本：v{PLUGIN_VERSION}</div>
      {writable && cfg !== null ? (
        <>
          {switchRow('enabled', '总开关')}
          <div style={line}>
            <span>全面脱敏（姓名/公司/机关）：{factsOn ? '已开启' : factsSomeOn ? '部分开启' : '已关闭'}</span>
            <button
              type="button"
              disabled={!writable || saving !== null}
              style={{ ...btnBase, opacity: writable ? 1 : 0.5 }}
              onClick={toggleFacts}
            >
              {factsOn ? '关闭' : '全部开启'}
            </button>
          </div>
          {switchRow('redactNames', '姓名')}
          {switchRow('redactCompanies', '公司')}
          {switchRow('redactOrgs', '机关')}
          {switchRow('redactCaseNumbers', '案号')}
          {switchRow('redactDob', '出生日期')}
          {switchRow('redactAddress', '地址')}
          {switchRow('redactCredentials', '密钥凭据')}
          <div style={body}>当前生效：{active.join('、') || '无'}；保留：{kept.join('、') || '无'}。</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>自定义敏感词（当事人姓名/别名/机构简称）：</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={inputBase}
                value={termInput}
                placeholder="输入敏感词（可用 ; ； , ， 、 分隔一次添加多个），回车或点添加"
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
        发往云端前，姓名、身份证、电话、邮箱、地址、公司/单位名称与密钥凭据会被替换为占位符；涉案金额、日期、案号保留（便于金额核算与时效判断）。本地会话日志中的用户输入与工具结果同样遮罩。
      </div>
      <div style={line}>
        <span>状态：</span>
        <button type="button" style={btnBase} onClick={copyStatusCommand}>
          {copiedStatus ? '已复制 ✓' : '复制状态'}
        </button>
      </div>
      <div style={line}>
        <span>更新：</span>
        <button
          type="button"
          disabled={saving !== null}
          style={btnBase}
          onClick={copyUpdateCommand}
        >
          {copied ? '已复制 ✓' : '复制更新命令'}
        </button>
      </div>
      <div style={body}>复制后在终端运行该命令，并重启 dsh web 生效。</div>
      <div style={body}>此处为常用开关；案号/出生日期/严格模式等其余选项请在配置文件中调整（$DSH_HOME/profiles/web/cordis.patch.yml）。</div>
      <div style={body}>{DSH_SUPPORT}；功能随宿主能力自动降级。</div>
      <div style={body}>{DISCLAIMER}</div>
      <div style={body}>
        作者：JunyuZhan · 项目：
        <a style={linkStyle} href="https://github.com/JunyuZhan/dsh-privmask" target="_blank" rel="noreferrer">GitHub</a>
        {' '}· 问题反馈：
        <a style={linkStyle} href="https://github.com/JunyuZhan/dsh-privmask/issues" target="_blank" rel="noreferrer">Issues</a>
      </div>
    </div>
  )
}
