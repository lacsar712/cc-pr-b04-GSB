import { useEffect, useState } from 'react'

// 内置的「全部」方案：空前缀，不落库，不可删
const ALL_FILTER = { schemeId: null, label: '', prefix: '' }

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

  // 印张过滤专页状态
  const [prefixInput, setPrefixInput] = useState('')
  const [schemeName, setSchemeName] = useState('')
  const [schemes, setSchemes] = useState([])
  const [events, setEvents] = useState([])
  const [applied, setApplied] = useState(ALL_FILTER)
  const [filterRows, setFilterRows] = useState([])
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

  // 过滤始终向服务端带前缀重查，不在浏览器藏行
  async function loadFiltered(prefix) {
    setFilterRows(await api(`/api/jobs?prefix=${encodeURIComponent(prefix)}`))
  }

  async function loadSchemes() {
    setSchemes(await api('/api/filter/schemes'))
  }

  async function loadEvents() {
    setEvents(await api('/api/filter/events'))
  }

  useEffect(() => {
    if (!token) return
    const tick = async () => {
      try {
        if (view === 'filter') {
          await loadFiltered(applied.prefix)
          await loadSchemes()
          await loadEvents()
        } else {
          await load()
        }
      } catch {
        // 轮询失败下一轮再试
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
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

  // 保存当前前缀输入为命名方案（印刷员与质检都可）
  async function saveScheme() {
    setFilterError('')
    try {
      await api('/api/filter/schemes', {
        method: 'POST',
        body: JSON.stringify({ name: schemeName, prefix: prefixInput }),
      })
      setSchemeName('')
      await loadSchemes()
      await loadEvents()
    } catch (err) {
      setFilterError(err.message)
    }
  }

  // 只能删自己保存的方案，服务端同样校验
  async function removeScheme(scheme) {
    setFilterError('')
    try {
      await api(`/api/filter/schemes/${scheme.id}`, { method: 'DELETE' })
      if (applied.schemeId === scheme.id) setApplied(ALL_FILTER)
      await loadSchemes()
      await loadEvents()
    } catch (err) {
      setFilterError(err.message)
    }
  }

  // 切换方案：改 applied 即触发 effect 立即带新前缀重查服务端
  function applyScheme(scheme) {
    setApplied({ schemeId: scheme.id, label: scheme.name, prefix: scheme.prefix })
  }

  function applyInput() {
    setApplied({ schemeId: null, label: '', prefix: prefixInput.trim() })
  }

  function leave() {
    localStorage.clear()
    setToken('')
    setRole('')
    setMe('')
    setView('jobs')
  }

  const filterDesc = applied.prefix
    ? `当前过滤：${applied.label ? `方案「${applied.label}」，` : '临时前缀，'}前缀「${applied.prefix}」，服务端只返回匹配行，共 ${filterRows.length} 行。`
    : `当前为空前缀，服务端返回全部印张，共 ${filterRows.length} 行。`

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
      <nav style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #999', paddingBottom: 8, marginBottom: 12 }}>
        <strong>印刷套准复核台</strong>
        <button onClick={() => setView('jobs')} disabled={view === 'jobs'}>复核台</button>
        <button onClick={() => setView('filter')} disabled={view === 'filter'}>印张过滤</button>
        <span>{me}（{role === 'writer' ? '印刷员' : '质检·只读'}）</span>
        <button onClick={leave}>退出</button>
      </nav>

      {view === 'jobs' && (
        <section>
          <h1>印刷套准复核台</h1>
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
          <h1>印张过滤</h1>

          <h2>前缀输入</h2>
          <p>
            印张前缀：
            <input value={prefixInput} onChange={(e) => setPrefixInput(e.target.value)} placeholder="留空返回全部" />
            <button onClick={applyInput}>立即过滤</button>
          </p>
          <p>
            方案名：
            <input value={schemeName} onChange={(e) => setSchemeName(e.target.value)} placeholder="如：方案甲" />
            <button onClick={saveScheme} disabled={!schemeName.trim()}>保存为方案</button>
          </p>
          {filterError && <p>{filterError}</p>}

          <h2>当前过滤说明</h2>
          <p>{filterDesc}</p>

          <h2>方案列表</h2>
          <table>
            <thead>
              <tr><th>方案</th><th>前缀</th><th>保存人</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>全部（内置）</td>
                <td>（空）</td>
                <td>—</td>
                <td><button onClick={() => setApplied(ALL_FILTER)}>应用</button></td>
              </tr>
              {schemes.map((scheme) => (
                <tr key={scheme.id}>
                  <td>{scheme.name}</td>
                  <td>{scheme.prefix || '（空）'}</td>
                  <td>{scheme.created_by}</td>
                  <td>
                    <button onClick={() => applyScheme(scheme)}>应用</button>
                    {scheme.created_by === me && (
                      <button onClick={() => removeScheme(scheme)}>删除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>结果表</h2>
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

          <h2>方案履历</h2>
          <table>
            <thead>
              <tr><th>时间</th><th>操作</th><th>方案</th><th>前缀</th><th>操作者</th></tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td>{new Date(ev.created_at).toLocaleString()}</td>
                  <td>{ev.action === 'create' ? '保存方案' : '删除方案'}</td>
                  <td>{ev.scheme_name}</td>
                  <td>{ev.prefix || '（空）'}</td>
                  <td>{ev.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
