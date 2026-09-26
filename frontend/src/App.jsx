import { useEffect, useState } from 'react'

export default function App() {
  const [username, setUsername] = useState('printer')
  const [password, setPassword] = useState('print123456')
  const [token, setToken] = useState(localStorage.getItem('print_token') || '')
  const [role, setRole] = useState(localStorage.getItem('print_role') || '')
  const [me, setMe] = useState(localStorage.getItem('print_user') || '')
  const [view, setView] = useState('jobs')
  const [rows, setRows] = useState([])
  const [sheet, setSheet] = useState('插页-02')
  const [cyan, setCyan] = useState('0.08')
  const [magenta, setMagenta] = useState('0.02')
  const [error, setError] = useState('')

  // 印张过滤页状态
  const [filterRows, setFilterRows] = useState([])
  const [schemes, setSchemes] = useState([])
  const [history, setHistory] = useState([])
  const [prefixInput, setPrefixInput] = useState('')
  const [applied, setApplied] = useState({ kind: 'all', prefix: '', name: '', schemeId: 0 })
  const [schemeName, setSchemeName] = useState('')
  const [filterError, setFilterError] = useState('')

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || '请求失败')
    return data
  }

  async function load() {
    setRows(await api('/api/jobs'))
  }

  // 过滤页每次查询都带上当前前缀，由服务端过滤，不在浏览器藏行
  async function loadFilter() {
    const [jobRows, schemeList, historyList] = await Promise.all([
      api('/api/jobs?prefix=' + encodeURIComponent(applied.prefix)),
      api('/api/filter/schemes'),
      api('/api/filter/history'),
    ])
    setFilterRows(jobRows)
    setSchemes(schemeList)
    setHistory(historyList)
  }

  useEffect(() => {
    if (!token || view !== 'jobs') return
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [token, view])

  useEffect(() => {
    if (!token || view !== 'filter') return
    loadFilter()
    const timer = setInterval(loadFilter, 1000)
    return () => clearInterval(timer)
  }, [token, view, applied])

  async function enter() {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    localStorage.setItem('print_token', data.access_token)
    localStorage.setItem('print_role', data.role)
    localStorage.setItem('print_user', data.username)
    setToken(data.access_token)
    setRole(data.role)
    setMe(data.username)
  }

  async function send() {
    setError('')
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          sheet,
          cyan_mm: Number(cyan),
          magenta_mm: Number(magenta),
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }

  function leave() {
    localStorage.clear()
    setToken('')
    setRole('')
    setMe('')
  }

  // 切换方案：立即以该方案前缀重查（applied 变化触发上面的 effect）
  function pickScheme(scheme) {
    setPrefixInput(scheme.prefix)
    setApplied({ kind: 'scheme', prefix: scheme.prefix, name: scheme.name, schemeId: scheme.id })
  }

  function pickAll() {
    setPrefixInput('')
    setApplied({ kind: 'all', prefix: '', name: '', schemeId: 0 })
  }

  function applyPrefix() {
    const prefix = prefixInput.trim()
    setApplied(prefix ? { kind: 'manual', prefix, name: '', schemeId: 0 } : { kind: 'all', prefix: '', name: '', schemeId: 0 })
  }

  async function saveScheme() {
    setFilterError('')
    try {
      await api('/api/filter/schemes', {
        method: 'POST',
        body: JSON.stringify({ name: schemeName, prefix: prefixInput.trim() }),
      })
      setSchemeName('')
      await loadFilter()
    } catch (err) {
      setFilterError(err.message)
    }
  }

  async function dropScheme(scheme) {
    setFilterError('')
    try {
      await api(`/api/filter/schemes/${scheme.id}`, { method: 'DELETE' })
      if (applied.kind === 'scheme' && applied.schemeId === scheme.id) {
        setApplied(applied.prefix ? { kind: 'manual', prefix: applied.prefix, name: '', schemeId: 0 } : { kind: 'all', prefix: '', name: '', schemeId: 0 })
      } else {
        await loadFilter()
      }
    } catch (err) {
      setFilterError(err.message)
    }
  }

  function canDrop(scheme) {
    return role === 'writer' || scheme.created_by === me
  }

  function describeFilter() {
    const n = filterRows.length
    if (applied.kind === 'scheme') {
      return applied.prefix
        ? `当前过滤：方案「${applied.name}」，前缀「${applied.prefix}」，命中 ${n} 行`
        : `当前过滤：方案「${applied.name}」，空前缀返回全部，共 ${n} 行`
    }
    if (applied.kind === 'manual') return `当前过滤：前缀「${applied.prefix}」（未保存方案），命中 ${n} 行`
    return `当前过滤：空前缀，返回全部印张，共 ${n} 行`
  }

  if (!token) {
    return (
      <main>
        <h1>印刷套准复核台</h1>
        <p>提交后接口只入队。另一进程领走偏差并写结论，页面轮询到结论出现。</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={enter}>登录</button>
        <p>printer / print123456 可送复核；checker / check123456 只看</p>
      </main>
    )
  }

  return (
    <main>
      <nav style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
        <strong>印刷套准复核台</strong>
        <button onClick={() => setView('jobs')} disabled={view === 'jobs'}>复核台</button>
        <button onClick={() => setView('filter')} disabled={view === 'filter'}>印张过滤</button>
        <span>{me}（{role === 'writer' ? '印刷员' : '质检'}）</span>
        <button onClick={leave}>退出</button>
      </nav>

      {view === 'jobs' && (
        <section>
          <h2>复核台</h2>
          {role === 'writer' && (
            <p>
              <input value={sheet} onChange={(e) => setSheet(e.target.value)} />
              <input value={cyan} onChange={(e) => setCyan(e.target.value)} />
              <input value={magenta} onChange={(e) => setMagenta(e.target.value)} />
              <button onClick={send}>送复核</button>
            </p>
          )}
          {error && <p>{error}</p>}
          <table>
            <thead>
              <tr><th>印张</th><th>青</th><th>品</th><th>状态</th><th>结论</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.sheet}</td>
                  <td>{row.cyan_mm}</td>
                  <td>{row.magenta_mm}</td>
                  <td>{row.status}</td>
                  <td>{row.verdict || '等待'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view === 'filter' && (
        <section>
          <h2>印张过滤</h2>
          <p>
            前缀
            <input
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              placeholder="如：封面；空为全部"
            />
            <button onClick={applyPrefix}>应用过滤</button>
            方案名
            <input
              value={schemeName}
              onChange={(e) => setSchemeName(e.target.value)}
              placeholder="如：甲"
            />
            <button onClick={saveScheme}>保存为方案</button>
          </p>
          {filterError && <p>{filterError}</p>}
          <p><strong>{describeFilter()}</strong></p>
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
            <div>
              <h3>方案列表</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li>
                  <button onClick={pickAll} disabled={applied.kind === 'all'}>全部（空前缀）</button>
                </li>
                {schemes.map((scheme) => (
                  <li key={scheme.id} style={{ marginTop: '0.25rem' }}>
                    <button
                      onClick={() => pickScheme(scheme)}
                      disabled={applied.kind === 'scheme' && applied.schemeId === scheme.id}
                    >
                      {scheme.name}（前缀「{scheme.prefix || '空'}」）
                    </button>
                    <span> {scheme.created_by} 存 </span>
                    {canDrop(scheme) && <button onClick={() => dropScheme(scheme)}>删除</button>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>结果</h3>
              <table>
                <thead>
                  <tr><th>印张</th><th>青</th><th>品</th><th>状态</th><th>结论</th></tr>
                </thead>
                <tbody>
                  {filterRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.sheet}</td>
                      <td>{row.cyan_mm}</td>
                      <td>{row.magenta_mm}</td>
                      <td>{row.status}</td>
                      <td>{row.verdict || '等待'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>方案履历</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {history.map((item) => (
                  <li key={item.id}>
                    {new Date(item.created_at).toLocaleString()} · {item.actor}
                    {item.action === 'create' ? ' 保存方案 ' : ' 删除方案 '}
                    「{item.scheme_name}」（前缀「{item.prefix || '空'}」）
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
