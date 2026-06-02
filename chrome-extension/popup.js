const SERVER_URL = 'https://crypto-sim-nu.vercel.app'
const STORAGE_KEYS = ['token', 'email', 'enabled']

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function showStatus(msg, isError = false, duration = 2500) {
  const el = document.getElementById('status')
  el.textContent = msg
  el.style.color = isError ? '#e05c5c' : '#6a8fa8'
  if (duration) setTimeout(() => { el.textContent = '' }, duration)
}

// wrap 자식 전부 제거 후 node 삽입
function setWrapContent(wrap, node) {
  while (wrap.firstChild) wrap.removeChild(wrap.firstChild)
  wrap.appendChild(node)
}

function makeHint(text) {
  const d = document.createElement('div')
  d.className   = 'pos-hint'
  d.textContent = text
  return d
}

// ── 탭 전환 ──────────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId)
  })
  document.querySelectorAll('.tab-content').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId)
  })
}

// ── 뷰 전환 ──────────────────────────────────────────────────────────────────
async function renderView() {
  const data = await getStorage(STORAGE_KEYS)
  const isLoggedIn = !!data.token

  document.getElementById('view-login').style.display = isLoggedIn ? 'none'  : 'block'
  document.getElementById('view-main').style.display  = isLoggedIn ? 'block' : 'none'

  if (isLoggedIn) {
    document.getElementById('info-email').textContent = data.email || ''
    renderPositions(data.token)
    renderCustomMessages(data.token)
  }
}

// ── 커스텀 메시지 fetch ─────────────────────────────────────────────────────
async function fetchCustomMessages(token) {
  try {
    const res = await fetch(`${SERVER_URL}/api/teledit-messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data.filter(m => m.visible) : []
  } catch { return [] }
}

function buildCmItem(msg, checkedIds, rootEl) {
  const item = document.createElement('label')
  item.className = 'cm-item'

  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = checkedIds.has(String(msg.id))
  cb.dataset.id = String(msg.id)
  cb.addEventListener('change', () => {
    const checked = [...rootEl.querySelectorAll('.cm-item input[type="checkbox"]')]
      .filter(c => c.checked).map(c => c.dataset.id)
    chrome.storage.local.set({ checkedCmIds: checked })
  })

  const info = document.createElement('div')
  info.className = 'cm-item-info'

  const header = document.createElement('div')
  header.className = 'cm-item-header'

  const num = document.createElement('span')
  num.className = 'cm-item-num'
  num.textContent = '#' + msg.messageNumber

  const time = document.createElement('span')
  time.className = 'cm-item-time'
  const d = new Date(msg.sendTime)
  time.textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')

  header.append(num, time)
  if (msg.imageUrl) {
    const img = document.createElement('span')
    img.className = 'cm-item-img'
    img.textContent = '🖼'
    header.appendChild(img)
  }

  const text = document.createElement('div')
  text.className = 'cm-item-text'
  text.textContent = msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : '')

  info.append(header, text)
  item.append(cb, info)
  return item
}

async function renderCustomMessages(token) {
  const wrap = document.getElementById('cm-list-wrap')
  setWrapContent(wrap, makeHint('로딩 중...'))

  const messages = await fetchCustomMessages(token)
  if (!messages.length) { setWrapContent(wrap, makeHint('커스텀 메시지 없음')); return }

  const stored = await new Promise(r => chrome.storage.local.get(['checkedCmIds'], r))
  const checkedIds = stored.checkedCmIds
    ? new Set(stored.checkedCmIds.map(String))
    : new Set(messages.map(m => String(m.id)))

  const container = document.createElement('div')
  container.className = 'pos-list'
  container.style.maxHeight = '120px'
  for (const msg of messages) container.appendChild(buildCmItem(msg, checkedIds, container))

  setWrapContent(wrap, container)
  if (!stored.checkedCmIds) {
    const allIds = messages.map(m => String(m.id))
    chrome.storage.local.set({ checkedCmIds: allIds })
  }
}

// ── 로그인 ───────────────────────────────────────────────────────────────────
async function login() {
  const email    = document.getElementById('email').value.trim()
  const password = document.getElementById('password').value

  if (!email || !password) {
    showStatus('아이디와 비밀번호를 입력하세요', true)
    return
  }

  const btn = document.getElementById('btn-login')
  btn.disabled = true
  btn.textContent = '로그인 중...'

  try {
    const res = await fetch(`${SERVER_URL}/api/extension/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.json()

    if (!res.ok) {
      showStatus(body.message || '로그인 실패', true)
      return
    }

    await chrome.storage.local.set({ email, token: body.token, enabled: true })
    document.getElementById('password').value = ''
    await renderView()
    showStatus('로그인 성공')
  } catch {
    showStatus('서버 연결 실패', true)
  } finally {
    btn.disabled = false
    btn.textContent = '로그인'
  }
}

// ── 로그아웃 ─────────────────────────────────────────────────────────────────
function logout() {
  chrome.storage.local.remove(['token', 'email'], async () => {
    await renderView()
    showStatus('로그아웃됨')
  })
}

// ── 업데이트 배너 ─────────────────────────────────────────────────────────────
function checkUpdateBanner() {
  chrome.storage.local.get(['updateAvailable', 'latestVersion', 'downloadUrl'], (data) => {
    if (!data.updateAvailable) return
    const link = document.getElementById('update-link')
    link.textContent = `새 버전 v${data.latestVersion} 다운로드`
    link.onclick = () => chrome.tabs.create({ url: data.downloadUrl })
    document.getElementById('update-banner').style.display = 'flex'
  })
}

// ── 포지션 fetch ─────────────────────────────────────────────────────────────
async function fetchPositions(token) {
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const [resOpen, resClosed] = await Promise.all([
      fetch(`${SERVER_URL}/api/positions?status=OPEN`,   { headers }),
      fetch(`${SERVER_URL}/api/positions?status=CLOSED`, { headers }),
    ])
    const open   = resOpen.ok   ? await resOpen.json()   : []
    const closed = resClosed.ok ? await resClosed.json() : []
    return [...open, ...closed]
      .filter(p => p.teleditVisible !== false)
      .sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime))
  } catch {
    return null
  }
}

// ── 체크 상태 저장 ────────────────────────────────────────────────────────────
function saveChecked(listEl) {
  const checked = [...listEl.querySelectorAll('input[type="checkbox"]')]
    .filter((cb) => cb.checked)
    .map((cb) => cb.dataset.id)
  chrome.storage.local.set({ checkedPositions: checked })
}

// ── 포지션 아이템 생성 ────────────────────────────────────────────────────────
function buildPosItem(pos, checkedIds, rootEl) {
  const item = document.createElement('label')
  item.className = 'pos-item'

  const cb = document.createElement('input')
  cb.type       = 'checkbox'
  cb.checked    = checkedIds.has(String(pos.id))
  cb.dataset.id = String(pos.id)
  cb.addEventListener('change', () => saveChecked(rootEl))

  const num = pos.positionNumber ? `#${pos.positionNumber}` : ''
  const lev = pos.leverage ? `${pos.leverage}x` : ''
  const labelSpan = document.createElement('span')
  labelSpan.className = 'pos-item-label'
  labelSpan.textContent = `${num} ${pos.symbol} ${lev}`.trim()

  const badge = document.createElement('span')
  badge.className = 'pos-badge'
  if (pos.status === 'OPEN') {
    badge.classList.add('open');       badge.textContent = 'OPEN'
  } else if (pos.status === 'CLOSED_TP' || pos.closeReason === 'TP') {
    badge.classList.add('closed-tp'); badge.textContent = 'TP'
  } else {
    badge.classList.add('closed-sl'); badge.textContent = 'SL'
  }

  item.append(cb, labelSpan, badge)
  return item
}

// ── 섹션 헤더 생성 ────────────────────────────────────────────────────────────
function buildGroupHeader(title, count) {
  const header = document.createElement('div')
  header.className = 'pos-group-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'pos-group-title'
  titleEl.textContent = title
  const countEl = document.createElement('span')
  countEl.className = 'pos-group-count'
  countEl.textContent = String(count)
  header.append(titleEl, countEl)
  return header
}

// ── 포지션 목록 렌더링 (현재 / 히스토리 섹션 분리) ────────────────────────────
async function renderPositions(token) {
  const wrap = document.getElementById('pos-list-wrap')
  setWrapContent(wrap, makeHint('로딩 중...'))

  const positions = await fetchPositions(token)
  if (!positions)        { setWrapContent(wrap, makeHint('불러오기 실패')); return }
  if (!positions.length) { setWrapContent(wrap, makeHint('포지션 없음'));  return }

  const stored = await new Promise((r) => chrome.storage.local.get(['checkedPositions'], r))
  const checkedIds = stored.checkedPositions
    ? new Set(stored.checkedPositions.map(String))
    : new Set(positions.map((p) => String(p.id)))

  const openPos   = positions.filter(p => p.status === 'OPEN')
  const closedPos = positions.filter(p => p.status !== 'OPEN')

  const container = document.createElement('div')
  container.className = 'pos-sections'

  // ── 현재 포지션 섹션 ──
  const openSection = document.createElement('div')
  openSection.className = 'pos-group'
  openSection.appendChild(buildGroupHeader('현재 포지션', openPos.length))
  if (openPos.length) {
    const openList = document.createElement('div')
    openList.className = 'pos-list'
    for (const pos of openPos) openList.appendChild(buildPosItem(pos, checkedIds, container))
    openSection.appendChild(openList)
  } else {
    openSection.appendChild(makeHint('진행 중인 포지션 없음'))
  }
  container.appendChild(openSection)

  // ── 포지션 히스토리 섹션 ──
  const closedSection = document.createElement('div')
  closedSection.className = 'pos-group'
  closedSection.appendChild(buildGroupHeader('포지션 히스토리', closedPos.length))
  if (closedPos.length) {
    const closedList = document.createElement('div')
    closedList.className = 'pos-list'
    for (const pos of closedPos) closedList.appendChild(buildPosItem(pos, checkedIds, container))
    closedSection.appendChild(closedList)
  } else {
    closedSection.appendChild(makeHint('청산 히스토리 없음'))
  }
  container.appendChild(closedSection)

  setWrapContent(wrap, container)
  if (!stored.checkedPositions) saveChecked(container)
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderView()
  checkUpdateBanner()

  // 로그인 / 로그아웃
  document.getElementById('btn-login').addEventListener('click', login)
  document.getElementById('btn-logout').addEventListener('click', logout)
  document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login()
  })
  // 포지션 삽입 버튼
  document.getElementById('btn-insert').addEventListener('click', async () => {
    const btn = document.getElementById('btn-insert')
    const statusEl = document.getElementById('insert-status')
    btn.disabled = true
    btn.textContent = '삽입 중...'
    statusEl.textContent = ''

    // 체크된 포지션 ID 수집
    const checked = [...document.querySelectorAll('.pos-item input[type="checkbox"]:checked')]
      .map(cb => cb.dataset.id)

    if (checked.length === 0) {
      statusEl.textContent = '포지션을 선택하세요'
      statusEl.style.color = '#e05c5c'
      btn.disabled = false
      btn.textContent = '체크된 포지션 삽입'
      return
    }

    try {
      // content script에 삽입 요청
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab) throw new Error('활성 탭 없음')

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'insertPositions',
        positionIds: checked,
      })

      if (response && response.inserted != null) {
        var msg = response.inserted + '개 삽입'
        if (response.pending > 0) msg += ' (' + response.pending + '개 스크롤 시 자동 삽입)'
        statusEl.textContent = msg
        statusEl.style.color = '#4caf7d'
      } else {
        statusEl.textContent = response?.error || '삽입 실패'
        statusEl.style.color = '#e05c5c'
      }
    } catch (e) {
      var errMsg = e && e.message ? e.message : String(e)
      if (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish')) {
        statusEl.textContent = '페이지를 새로고침하세요 (F5)'
      } else {
        statusEl.textContent = errMsg
      }
      statusEl.style.color = '#e05c5c'
    }

    btn.disabled = false
    btn.textContent = '체크된 포지션 삽입'
  })

  // 포지션 새로고침
  document.getElementById('pos-refresh').addEventListener('click', async () => {
    const data = await getStorage(['token'])
    if (data.token) renderPositions(data.token)
  })

  // 커스텀 메시지 삽입 버튼
  document.getElementById('btn-insert-cm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-insert-cm')
    const statusEl = document.getElementById('cm-insert-status')
    btn.disabled = true
    btn.textContent = '삽입 중...'
    statusEl.textContent = ''

    const checked = [...document.querySelectorAll('.cm-item input[type="checkbox"]:checked')]
      .map(cb => cb.dataset.id)

    if (checked.length === 0) {
      statusEl.textContent = '메시지를 선택하세요'
      statusEl.style.color = '#e05c5c'
      btn.disabled = false
      btn.textContent = '체크된 메시지 삽입'
      return
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab) throw new Error('활성 탭 없음')
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'insertCustomMessages',
        messageIds: checked,
      })
      if (response && response.inserted != null) {
        var msg = response.inserted + '개 삽입'
        if (response.pending > 0) msg += ' (' + response.pending + '개 스크롤 시 자동 삽입)'
        statusEl.textContent = msg
        statusEl.style.color = '#4caf7d'
      } else {
        statusEl.textContent = response?.error || '삽입 실패'
        statusEl.style.color = '#e05c5c'
      }
    } catch (e) {
      var errMsg = e && e.message ? e.message : String(e)
      if (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish')) {
        statusEl.textContent = '페이지를 새로고침하세요 (F5)'
      } else {
        statusEl.textContent = errMsg
      }
      statusEl.style.color = '#e05c5c'
    }
    btn.disabled = false
    btn.textContent = '체크된 메시지 삽입'
  })

  // 커스텀 메시지 새로고침
  document.getElementById('cm-refresh').addEventListener('click', async () => {
    const data = await getStorage(['token'])
    if (data.token) renderCustomMessages(data.token)
  })

  // 탭 전환
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  // 버전 표시
  const v = chrome.runtime.getManifest().version
  document.getElementById('version-label').textContent = `v${v}`
})
