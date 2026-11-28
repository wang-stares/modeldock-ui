import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Loader2, Search, Trash2, Upload, X } from 'lucide-react'
import { api } from '../api'
import type { AppSettings, FontLibraryItem, FontLibraryState } from '../types'
import { formatBytes } from './UpdatePanel'

type FontTab = 'all' | 'installed' | 'custom'

const EMPTY_SAMPLE = '这是一段自定义字体预览：山河远阔，人间烟火。Aa 0123'

function isRtl(item: FontLibraryItem) {
  return item.languages.some(language => language.includes('阿拉伯'))
}

function customFamily(id: string) {
  return `TianshuCustomPreview_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

/** 用户上传字体不能像目录字体那样带静态预览子集，取回 Blob 后临时注册 FontFace。 */
function CustomFontPreview({ item }: { item: FontLibraryItem }) {
  const [family, setFamily] = useState('')
  useEffect(() => {
    let cancelled = false
    let face: FontFace | null = null
    let objectUrl: string | null = null
    const loadedFamily = customFamily(item.id)
    void (async () => {
      try {
        const blob = await api.fontBlob(item.id)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        face = new FontFace(loadedFamily, `url("${objectUrl}")`)
        await face.load()
        if (cancelled) return
        document.fonts.add(face)
        setFamily(loadedFamily)
      } catch {
        if (!cancelled) setFamily('')
      }
    })()
    return () => {
      cancelled = true
      if (face) document.fonts.delete(face)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.id])

  return (
    <div className="font-preview-sample" dir={isRtl(item) ? 'rtl' : 'ltr'} style={{ fontFamily: family ? `"${family}", sans-serif` : undefined }}>
      {item.sample || EMPTY_SAMPLE}
    </div>
  )
}

function FontCard({ item, selected, busy, onUse, onDelete }: {
  item: FontLibraryItem
  selected: boolean
  busy: string
  onUse: (item: FontLibraryItem) => void
  onDelete: (item: FontLibraryItem) => void
}) {
  const working = busy.endsWith(`:${item.id}`)
  const installed = item.installed
  return (
    <article className={`font-card ${selected ? 'selected' : ''}`}>
      <div className="font-card-head">
        <div>
          <div className="font-card-name">{item.name}{selected && <span className="font-current">当前</span>}</div>
          {item.englishName && <div className="font-card-en">{item.englishName}</div>}
        </div>
        {installed && <Check size={15} className="font-installed-mark" aria-label="已安装" />}
      </div>
      {item.source === 'catalog'
        ? <div className="font-preview-sample" dir={isRtl(item) ? 'rtl' : 'ltr'} style={{ fontFamily: `"TianshuPreview_${item.id}", sans-serif` }}>{item.sample}</div>
        : <CustomFontPreview item={item} />}
      <div className="font-card-badges">
        {item.languages.map(language => <span key={language}>{language}</span>)}
        {item.styles.map(style => <span key={style}>{style}</span>)}
      </div>
      <div className="font-card-meta">
        <span>{formatBytes(item.sizeBytes)}</span>
        <span>{item.license}</span>
        {item.source === 'custom' && <span>用户上传</span>}
      </div>
      <div className="font-card-actions">
        {selected ? (
          <button type="button" className="btn soft sm" disabled>已在使用</button>
        ) : (
          <button type="button" className="btn primary sm" disabled={Boolean(busy)} onClick={() => onUse(item)}>
            {working ? <Loader2 className="spin" size={13} /> : installed ? null : <Download size={13} />}
            {working ? '处理中…' : installed ? '使用' : '下载并使用'}
          </button>
        )}
        {installed && (
          <button type="button" className="btn ghost sm font-delete" disabled={Boolean(busy)} onClick={() => onDelete(item)} aria-label={`删除 ${item.name}`}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </article>
  )
}

export function FontLibrary({ value, onChange }: {
  value: string
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const [state, setState] = useState<FontLibraryState | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<FontTab>('all')
  const [language, setLanguage] = useState('')
  const [style, setStyle] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = () => {
    setError('')
    void api.fonts().then(setState).catch(err => setError(err instanceof Error ? err.message : '字体库读取失败'))
  }

  useEffect(() => {
    let alive = true
    void api.fonts().then(next => { if (alive) setState(next) })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : '字体库读取失败') })
    return () => { alive = false }
  }, [])

  const allItems = useMemo(() => state ? [...state.catalog, ...state.custom] : [], [state])
  const languages = useMemo(() => Array.from(new Set(allItems.flatMap(item => item.languages))).sort(), [allItems])
  const styles = useMemo(() => Array.from(new Set(allItems.flatMap(item => item.styles))).sort(), [allItems])

  const previewCss = useMemo(() => (state?.catalog ?? [])
    .map(item => `@font-face{font-family:"TianshuPreview_${item.id}";src:url("${item.previewUrl}") format("truetype");font-display:swap;}`)
    .join('\n'), [state])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allItems.filter(item => {
      if (tab === 'installed' && !item.installed) return false
      if (tab === 'custom' && item.source !== 'custom') return false
      if (language && !item.languages.includes(language)) return false
      if (style && !item.styles.includes(style)) return false
      if (!q) return true
      return `${item.name} ${item.englishName} ${item.languages.join(' ')} ${item.styles.join(' ')} ${item.license}`.toLowerCase().includes(q)
    })
  }, [allItems, language, query, style, tab])

  async function useFont(item: FontLibraryItem) {
    setError('')
    setMessage('')
    const key = item.source === 'catalog' ? `catalog:${item.id}` : `custom:${item.id}`
    if (!item.installed) {
      setBusy(`download:${item.id}`)
      try {
        const next = await api.downloadFont(item.id)
        setState(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : '字体下载失败')
        setBusy('')
        return
      }
    }
    onChange({ chatFont: key })
    setBusy('')
    setMessage(`已使用「${item.name}」，只作用于对话阅读区。`)
  }

  async function removeFont(item: FontLibraryItem) {
    if (!window.confirm(`删除「${item.name}」的本地字体文件？删除后如果正在使用，会回到系统字体。`)) return
    setBusy(`delete:${item.id}`)
    setError('')
    setMessage('')
    if (value === (item.source === 'catalog' ? `catalog:${item.id}` : `custom:${item.id}`)) {
      onChange({ chatFont: 'system' })
    }
    try {
      setState(await api.deleteFont(item.id))
      setMessage(`已删除「${item.name}」。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '字体删除失败')
    } finally {
      setBusy('')
    }
  }

  async function upload(file: File) {
    if (file.size > 32 * 1024 * 1024) {
      setError('字体文件不能超过 32 MB。')
      return
    }
    setBusy('upload')
    setError('')
    setMessage('')
    const previousCustomIds = new Set((state?.custom ?? []).map(item => item.id))
    try {
      const next = await api.uploadFont(file)
      setState(next)
      const added = next.custom.find(item => !previousCustomIds.has(item.id)) ?? next.custom.find(item => item.name === file.name.replace(/^.*\./, ''))
      if (added) {
        onChange({ chatFont: `custom:${added.id}` })
        setMessage(`已上传「${added.name}」并用于对话阅读区。`)
      } else {
        setMessage('字体已存在，未重复占用空间。')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '字体上传失败')
    } finally {
      setBusy('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="font-library">
      <style>{previewCss}</style>
      <section className="settings-card settings-detail-card font-library-card">
        <div className="settings-detail-lead">
          <div>
            <div className="settings-detail-eyebrow">Font library</div>
            <h2>字体库</h2>
            <p>界面继续使用 Windows 系统字体；这里选的字体只作用于对话正文与输入框。目录字体按需下载，完整文件落在本机，预览只是很小的子集。</p>
          </div>
        </div>

        <div className="font-builtins">
          <span className="font-builtin-label">阅读区默认</span>
          <button type="button" className={value === 'system' ? 'active' : ''} onClick={() => onChange({ chatFont: 'system' })}>
            系统字体{value === 'system' && <Check size={12} />}
          </button>
          <button type="button" className={value === 'misans' ? 'active' : ''} onClick={() => onChange({ chatFont: 'misans' })}>
            MiSans（随包）{value === 'misans' && <Check size={12} />}
          </button>
          <span className="font-builtin-note">导航、设置页和按钮不跟随这里变化。</span>
        </div>

        <div className="font-toolbar">
          <div className="font-search">
            <Search size={15} aria-hidden />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索字体名、语言或风格" aria-label="搜索字体" />
            {query && <button type="button" className="font-search-clear" onClick={() => setQuery('')} aria-label="清空字体搜索"><X size={13} /></button>}
          </div>
          <div className="font-tabs">
            {([['all', '全部'], ['installed', '已安装'], ['custom', '我的上传']] as const).map(([key, label]) => (
              <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          <button type="button" className="btn primary sm font-upload" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            {busy === 'upload' ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
            上传字体
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            hidden
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
            }}
          />
        </div>

        <div className="font-filters">
          <select value={language} onChange={event => setLanguage(event.target.value)} aria-label="按语言筛选">
            <option value="">全部语言</option>
            {languages.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={style} onChange={event => setStyle(event.target.value)} aria-label="按风格筛选">
            <option value="">全部风格</option>
            {styles.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <span className="font-count">{filtered.length} 款 · {state ? formatBytes(state.totalBytes) : '读取中'}</span>
        </div>

        {error && <div className="font-error">{error}</div>}
        {message && <div className="font-message"><Check size={14} />{message}</div>}

        {!state && !error && <div className="font-loading"><Loader2 className="spin" size={16} />正在读取字体库…</div>}
        {state && filtered.length === 0 && <div className="font-empty">没有匹配的字体。换个关键词，或清空语言 / 风格筛选。</div>}
        {state && filtered.length > 0 && (
          <div className="font-grid">
            {filtered.map(item => (
              <FontCard key={item.id} item={item} selected={value === (item.source === 'catalog' ? `catalog:${item.id}` : `custom:${item.id}`)} busy={busy} onUse={useFont} onDelete={removeFont} />
            ))}
          </div>
        )}

        <div className="font-library-foot">
          <span>目录字体来自 Google Fonts 固定提交，完整字体下载后校验 SHA256；预览为按字符裁剪的小子集。<a href="/font-licenses/NOTICES.txt" target="_blank" rel="noreferrer">字体许可</a></span>
          <button type="button" className="btn ghost sm" onClick={load}>刷新状态</button>
        </div>
      </section>
    </div>
  )
}
