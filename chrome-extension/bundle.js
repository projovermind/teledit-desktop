// ── 공유 상태 (모든 mutable 변수 중앙 관리) ──────────────────────────────────

// constants.js에서 이동
var positions          = []
var observer           = null
var debounceTimer      = null
var seenPositionIds    = new Set()
var checkedPositionIds = null

// 말풍선 영구 캐시
var bubbleDataCache = new Map()  // posId -> { viewCount, reactions:[{blobSrc,count,chosen}] }
var injectedBubbles = new Map()  // fakeMid -> { text, pos }
var pendingBubbles  = new Map()  // posId -> { text, pos }

// comments.js에서 이동
var _userSettings    = null      // { templates, enabled, timing }
var _settingsFetched = false
var _tsCache         = new Map()

// api.js에서 이동
var _posCache     = null
var _posCacheTime = 0

// content.js에서 이동
var _commentAuthorsCache = new Map()  // posId -> { type: [authorName, ...] }
var _scrollObserver      = null
var _scrollDebounce      = null
var _subsObserver        = null
var _subsInterval        = null
var _insertedPositions   = []
var _insertedCustomMessages = []  // 스크롤 reinject용 커스텀 메시지 캐시

// profit-card: 캐시 제거 — 항상 최신 이미지 fetch

// comment-ui.js에서 이동
var _commentOverlay = null
var _commentCache   = new Map()

// NEW: 댓글 수/작성자 캐시 (bug #3 수정 — 아바타 안정성)
var _replyDataCache = new Map()  // posId -> { commentCount, authorNames }
// ── 불변 상수 ────────────────────────────────────────────────────────────────
var TELEDIT_BUILD = 'v1.0.0'  // 번들 버전 (디버그용)
var SERVER_URL    = 'https://crypto-sim-nu.vercel.app'
var STORAGE_KEYS  = ['token', 'enabled']
var ATTR          = 'data-position-id'
var CLS           = 'teledit-position'
var INSERT_BTN_ID = 'teledit-insert-btn'

// 고정 3종 리액션 doc-id (페이지에서 blob URL 조회용)
var REACTION_DOC_IDS = [
  '5098582486267462019',  // ❤️
  '5100483636361167223',  // 👍
  '4911350297600721490',  // 🔥
]

// getReaction() 호출용 이모티콘 문자열 (REACTION_DOC_IDS와 순서 일치)
var REACTION_EMOTICONS = ['❤', '👍', '🔥']

var COLOR = {
  OPEN:      { bg: '#1a3a5c', border: '#5eacd3' },
  CLOSED_TP: { bg: '#1a3d2a', border: '#4caf7d' },
  CLOSED_SL: { bg: '#3d1a1a', border: '#e05c5c' },
}

// 포지션 캐시 TTL (불변)
var _POS_CACHE_TTL = 10000
// ── 유틸리티 함수 ─────────────────────────────────────────────────────────────
// 순수 유틸 + 간단한 DOM 쿼리. chrome.* API 의존 없음.

function _rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a }

function isChannelView() {
  return !!document.querySelector('.bubble.channel-post')
}

// ── 색상 결정 ────────────────────────────────────────────────────────────────
function resolveColor(pos) {
  if (pos.status === 'OPEN') return COLOR.OPEN
  const reason = pos.status === 'CLOSED_TP' || pos.closeReason === 'TP' ? 'CLOSED_TP' : 'CLOSED_SL'
  return COLOR[reason]
}

// ── 시간 포맷 ────────────────────────────────────────────────────────────────
function fmtTimeKorean(dateStr) {
  const d = new Date(dateStr)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return (h < 12 ? '오전' : '오후') + ' ' + h12.toString().padStart(2, '0') + ':' + m
}

// ── 댓글 시간 포맷 (comment-ui.js에서 사용) ─────────────────────────────────
function _fmtCommentTime(date) {
  var d = date instanceof Date ? date : new Date(date)
  var h = d.getHours()
  var m = d.getMinutes().toString().padStart(2, '0')
  var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  var ap = h < 12 ? 'AM' : 'PM'
  return h12 + ':' + m + ' ' + ap
}

// ── 날짜 라벨 포맷 ───────────────────────────────────────────────────────────
// Telegram Web K는 Yesterday를 쓰지 않고 "April 14" 형식을 사용함
function _formatDateLabel(ts) {
  const d = new Date(ts * 1000)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
// ── chrome.storage 관련 ──────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS, resolve))
}

async function loadCheckedIds() {
  const data = await new Promise((r) => chrome.storage.local.get(['checkedPositions'], r))
  checkedPositionIds = data.checkedPositions ? new Set(data.checkedPositions.map(String)) : null
}

function filterChecked(posList) {
  // null(미설정) 또는 빈 Set → 전체 통과
  if (!checkedPositionIds || checkedPositionIds.size === 0) return posList
  return posList.filter(function(p) { return checkedPositionIds.has(String(p.id)) })
}
// ── 서버 API 통신 ────────────────────────────────────────────────────────────

// background worker를 통한 fetch (CORS 우회용 폴백)
function bgFetch(url, headers) {
  return new Promise(function(resolve) {
    try {
      chrome.runtime.sendMessage({ action: 'fetch', url: url, headers: headers }, function(res) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, data: null, error: chrome.runtime.lastError.message })
        } else {
          resolve(res || { ok: false, data: null })
        }
      })
    } catch (e) {
      resolve({ ok: false, data: null, error: e.message })
    }
  })
}

// 직접 fetch 시도 → 실패(CORS) 시 bgFetch 폴백
async function safeFetch(url, headers) {
  try {
    var res = await fetch(url, { headers: headers })
    var data = await res.json()
    return { ok: res.ok, status: res.status, data: data }
  } catch (e) {
    // CORS 또는 네트워크 에러 → background proxy 폴백
    return await bgFetch(url, headers)
  }
}

// ── 포지션 캐시 (10초 TTL) ────────────────────────────────────────────────────

async function fetchPositions(serverUrl, token) {
  // 캐시 히트
  var now = Date.now()
  if (_posCache && (now - _posCacheTime) < _POS_CACHE_TTL) return _posCache

  var base = serverUrl.replace(/\/$/, '')
  var headers = token ? { Authorization: 'Bearer ' + token } : {}
  try {
    // 병렬 호출
    var results = await Promise.all([
      safeFetch(base + '/api/positions?status=OPEN', headers),
      safeFetch(base + '/api/positions?status=CLOSED', headers),
    ])
    var resOpen = results[0], resClosed = results[1]

    var openData   = resOpen.ok   ? resOpen.data   : []
    var closedData = resClosed.ok ? resClosed.data : []

    var open   = Array.isArray(openData)   ? openData   : (openData && openData.positions ? openData.positions : [])
    var closed = Array.isArray(closedData) ? closedData : (closedData && closedData.positions ? closedData.positions : [])

    _posCache = open.concat(closed)
      .filter(function(p) { return p.teleditVisible !== false })
      .sort(function(a, b) { return new Date(a.entryTime) - new Date(b.entryTime) })
    _posCacheTime = Date.now()
    return _posCache
  } catch (err) {
    console.error('[Teledit] fetchPositions 실패:', err)
    return _posCache || []
  }
}

// ── 포지션별 댓글 조회 ───────────────────────────────────────────────────────
async function fetchPositionComments(posId) {
  try {
    var settings = await loadSettings()
    if (!settings.token) return []
    var res = await safeFetch(
      SERVER_URL + '/api/positions/' + posId + '/comments',
      { Authorization: 'Bearer ' + settings.token },
    )
    if (res.ok && res.data && res.data.comments) return res.data.comments
    return []
  } catch (e) {
    console.warn('[Teledit] fetchPositionComments 실패:', e.message)
    return []
  }
}

// ── 포지션 컨텍스트 텍스트 생성 ───────────────────────────────────────────────
function buildContextText() {
  var open   = filterChecked(positions.filter(function(p) { return p.status === 'OPEN' }))
  var closed = filterChecked(positions.filter(function(p) { return p.status !== 'OPEN' })).slice(-5)
  function fmtLine(p, withResult) {
    var lev    = p.leverage  ? p.leverage + 'x ' : ''
    var time   = p.entryTime ? ' 진입시간 ' + fmtTimeKorean(p.entryTime) : ''
    var pnl    = p.pnl != null ? ' PnL ' + (Number(p.pnl) >= 0 ? '+' : '') + Number(p.pnl).toFixed(1) + '%' : ''
    var result = withResult ? ' [' + (p.status === 'CLOSED_TP' || p.closeReason === 'TP' ? 'TP' : 'SL') + ']' : ''
    return p.symbol + ' ' + p.side + ' ' + lev + '진입가 ' + p.entryPrice + time + pnl + result
  }
  var parts = []
  if (open.length)   parts.push('현재포지션: '  + open.map(function(p) { return fmtLine(p) }).join(' | '))
  if (closed.length) parts.push('최근청산: ' + closed.map(function(p) { return fmtLine(p, true) }).join(' | '))
  return parts.join('\n')
}
// ── Telegram DOM 요소 생성 팩토리 ────────────────────────────────────────────

// ── 현재 페이지에서 반응 스티커 blob URL 수집 ───────────────────────────────
function _getReactionBlobMap() {
  const map = {}
  document.querySelectorAll('.reaction-sticker[data-doc-id]').forEach(sticker => {
    const img = sticker.querySelector('img.media-sticker')
    if (img && img.src.startsWith('blob:')) {
      map[sticker.dataset.docId] = img.src
    }
  })
  return map
}

// ── 날짜 구분선 ────────────────────────────────────────────────────────────────
function _buildDateSeparator(entryTs) {
  const label = _formatDateLabel(entryTs)
  const sep = document.createElement('div')
  sep.className = 'teledit-date-sep'
  const lbl = document.createElement('span')
  lbl.className = 'teledit-date-label'
  lbl.textContent = label
  sep.appendChild(lbl)
  return sep
}

// ── 반응 버튼 구조 빌드 ───────────────────────────────────────────────────────
function _buildOneReaction(blobSrc, emoticon, count, chosen, posId, idx) {
  var div = document.createElement('div')
  div.className = 'reaction reaction-block reaction-like-block' + (chosen ? ' is-chosen' : '')

  var stickerWrap = document.createElement('div')
  stickerWrap.className = 'reaction-sticker is-regular media-sticker-wrapper'
  stickerWrap.dataset.docId = REACTION_DOC_IDS[idx] || ''

  if (blobSrc) {
    var img = document.createElement('img')
    img.className = 'media-sticker'
    img.src = blobSrc
    stickerWrap.appendChild(img)
  } else {
    // blob URL 없으면 이모지 텍스트로 폴백
    var emojiSpan = document.createElement('span')
    emojiSpan.style.cssText = 'font-size:20px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;'
    emojiSpan.textContent = emoticon
    stickerWrap.appendChild(emojiSpan)
  }

  div.appendChild(stickerWrap)

  var counter = document.createElement('span')
  counter.className = 'reaction-counter'
  counter.textContent = String(count)
  div.appendChild(counter)

  return div
}
// ── 반응 클릭 인터셉터 ────────────────────────────────────────────────────────

function _attachReactionInterceptor(reactionsEl, reactionData, posId) {
  reactionsEl.addEventListener('click', function(e) {
    var reactionEl = e.target.closest('reaction-element')
                  || e.target.closest('.reaction.reaction-block')
    if (!reactionEl || !reactionsEl.contains(reactionEl)) return

    e.stopImmediatePropagation()
    e.preventDefault()

    var allReactionEls = [].slice.call(reactionsEl.querySelectorAll('reaction-element, .reaction.reaction-block'))
    var idx = allReactionEls.indexOf(reactionEl)
    if (idx === -1) return

    var isChosen = reactionEl.classList.contains('is-chosen')
    var counter  = reactionEl.querySelector('.reaction-counter')
    var img      = reactionEl.querySelector('.media-sticker')
    var blobSrc  = img ? img.src : null
    var rect     = reactionEl.getBoundingClientRect()

    if (!isChosen) {
      // ── 선택 ──
      reactionEl.classList.add('is-chosen')
      if (counter) counter.textContent = String(parseInt(counter.textContent) + 1)

      // 버튼 스케일 펄스
      reactionEl.style.transition = 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)'
      reactionEl.style.transform = 'scale(1.2)'
      setTimeout(function() {
        reactionEl.style.transform = 'scale(1)'
        setTimeout(function() { reactionEl.style.transition = ''; reactionEl.style.transform = '' }, 150)
      }, 120)

      // 스티커 바운스
      if (img) {
        img.style.animation = 'none'
        void img.offsetHeight
        img.style.animation = 'teledit-sticker-pop 0.42s ease'
        setTimeout(function() { img.style.animation = '' }, 420)
      }

      // 플로팅 이모지
      if (blobSrc) {
        var floater = document.createElement('div')
        floater.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2 - 14) + 'px;top:' + (rect.top - 8) + 'px;width:28px;height:28px;z-index:99999;pointer-events:none;animation:teledit-float-up 0.65s ease forwards;'
        var fImg = document.createElement('img')
        fImg.src = blobSrc
        fImg.style.cssText = 'width:100%;height:100%;object-fit:contain;'
        floater.appendChild(fImg)
        document.body.appendChild(floater)
        setTimeout(function() { floater.remove() }, 750)
      }

    } else {
      // ── 해제 ──
      reactionEl.style.transition = 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)'
      reactionEl.style.transform = 'scale(0.85)'
      setTimeout(function() {
        reactionEl.classList.remove('is-chosen')
        reactionEl.style.transform = 'scale(1)'
        setTimeout(function() { reactionEl.style.transition = ''; reactionEl.style.transform = '' }, 150)
      }, 120)
      if (counter) counter.textContent = String(parseInt(counter.textContent) - 1)
    }

    // 캐시 갱신
    if (posId) {
      var data = bubbleDataCache.get(posId)
      if (data && data.reactions[idx]) {
        data.reactions[idx].count  = parseInt(counter ? counter.textContent : '0')
        data.reactions[idx].chosen = reactionEl.classList.contains('is-chosen')
      }
    }
  }, true)
}
// ── 상황별 메시지 시스템 — 유저 설정 기반 템플릿 ─────────────────────────────
// 유저별 템플릿(DB) + 타이밍 + 활성화 설정을 API에서 fetch하여
// 포지션 데이터와 조합해 채널 포스트 생성.

// ── 포지션 메시지 생성 (OPEN / CLOSED 구분) — utils.js에서 이동 ─────────────
function buildAutoMessage(pos) {
  var lev   = pos.leverage ? pos.leverage + 'x' : ''
  var time  = pos.entryTime ? fmtTimeKorean(pos.entryTime) : ''
  // inputPrice(사용자 입력가) 우선, 없으면 entryPrice(슬리피지 적용) 반올림
  var price = pos.inputPrice || Number(pos.entryPrice)
  if (typeof price === 'number') price = parseFloat(price.toPrecision(8))

  if (pos.status === 'OPEN') {
    var tp = pos.takeProfit ? ' | TP: ' + pos.takeProfit : ''
    var sl = pos.stopLoss  ? ' | SL: ' + pos.stopLoss  : ''
    return '[' + pos.symbol + ' ' + pos.side + ' ' + lev + '] 진입가 ' + price + ' | 진입시간 ' + time + tp + sl
  }

  var reason = pos.closeReason === 'TP' || pos.status === 'CLOSED_TP' ? 'TP' : 'SL'
  var pnl    = pos.pnl != null ? ' ' + (Number(pos.pnl) >= 0 ? '+' : '') + Number(pos.pnl).toFixed(2) + '%' : ''
  var cp     = pos.closedPrice ? ' | 청산가 ' + parseFloat(Number(pos.closedPrice).toPrecision(8)) : ''
  return '[' + pos.symbol + ' ' + pos.side + ' ' + lev + '] 진입가 ' + price + cp + ' | ' + reason + pnl + ' | ' + time
}

// 기본 템플릿 (API 실패 시 폴백)
var _DEFAULTS = {
  preEntry:   '⏳ {{symbol}} {{side}} {{leverage}}x | 진입 예정 ${{entryPrice}}',
  long:       '🟢 {{symbol}} LONG {{leverage}}x | 진입 ${{entryPrice}}',
  short:      '🔴 {{symbol}} SHORT {{leverage}}x | 진입 ${{entryPrice}}',
  postEntry:  '📊 {{symbol}} {{side}} {{leverage}}x | 진입 완료 ${{entryPrice}}',
  preClose:   '⏳ {{symbol}} {{side}} | 청산 예정 PnL {{pnl}}USDT ({{roe}}%)',
  close:      '🔴 {{symbol}} {{side}} 청산 | PnL {{pnl}}USDT ({{roe}}%)',
  profit1:    '💰 수익 인증\n{{symbol}} {{side}} {{leverage}}x\n진입 ${{entryPrice}} → 청산 ${{closePrice}}\nPnL {{pnl}}USDT ({{roe}}%)',
  profit2:    '📈 수익 인증\n{{symbol}} {{side}} {{leverage}}x\nPnL {{pnl}}USDT ({{roe}}%)',
}

var _DEFAULT_TIMING = {
  preEntryMin: 60, preEntryMax: 120,
  postEntryMin: 30, postEntryMax: 60,
  preCloseMin: 60, preCloseMax: 120,
  profit1Min: 30, profit1Max: 60,
  profit2Min: 30, profit2Max: 60,
}

/**
 * 유저 설정 API fetch (최초 1회, 이후 캐시)
 */
async function fetchUserSettings() {
  if (_settingsFetched) return _userSettings
  try {
    var settings = await loadSettings()
    if (!settings.token) return null
    var res = await safeFetch(
      SERVER_URL + '/api/user/settings',
      { Authorization: 'Bearer ' + settings.token },
    )
    if (res.ok && res.data && res.data.templates) {
      _userSettings = res.data
      _settingsFetched = true  // 성공 시에만 캐시
      console.log('[Teledit] 유저 설정 로드 완료')
      return _userSettings
    }
  } catch (e) {
    console.warn('[Teledit] 유저 설정 fetch 실패:', e.message)
  }
  return null
}

// ── 템플릿 변수 치환 (CryptoSim applyTemplate과 동일) ────────────────────────
// 가격 크기에 따른 자동 소수점
function _autoDecimals(val) {
  var abs = Math.abs(val)
  if (abs >= 5000) return -1
  if (abs >= 1000) return 0
  if (abs >= 10) return 1
  if (abs >= 1) return 2
  if (abs >= 0.1) return 3
  if (abs >= 0.01) return 4
  return 5
}
function _fmtPrice(v) {
  if (v == null) return ''
  var n = Number(v), d = _autoDecimals(n)
  if (d < 0) return String(Math.round(n / 10) * 10)
  return n.toFixed(d)
}
function _fmtPriceOrNA(v) { return v != null ? _fmtPrice(v) : 'N/A' }

function _applyTemplate(template, pos) {
  if (!template) return null
  var pnl = pos.pnl != null ? Number(pos.pnl).toFixed(2) : 'N/A'
  var roe = 'N/A'
  if (pos.pnl != null && pos.amount > 0) {
    var _roeRaw = pos.pnl / pos.amount * pos.leverage * 100
    var _roeFloor = Math.floor(_roeRaw * 10) / 10  // 버림
    roe = _roeFloor % 1 === 0 ? String(Math.trunc(_roeFloor)) : _roeFloor.toFixed(1)
  }

  // 유저 정보 (_userSettings에서)
  var userName = _userSettings && _userSettings.userName ? _userSettings.userName : ''
  var nick1 = _userSettings && _userSettings.nickname1 ? _userSettings.nickname1 : ''
  var nick2 = _userSettings && _userSettings.nickname2 ? _userSettings.nickname2 : ''

  return template
    .replace(/\{\{symbol\}\}/g, pos.symbol || '')
    .replace(/\{\{side\}\}/g, pos.side || '')
    .replace(/\{\{leverage\}\}/g, String(pos.leverage || ''))
    .replace(/\{\{entryPrice\}\}/g, _fmtPrice(pos.entryPrice))
    .replace(/\{\{inputPrice\}\}/g, _fmtPriceOrNA(pos.inputPrice))
    .replace(/\{\{amount\}\}/g, _fmtPrice(pos.amount))
    .replace(/\{\{quantity\}\}/g, _fmtPrice(pos.quantity))
    .replace(/\{\{marginMode\}\}/g, pos.marginMode || 'CROSS')
    .replace(/\{\{marginModeKR\}\}/g, (pos.marginMode || 'CROSS') === 'CROSS' ? '교차' : '격리')
    .replace(/\{\{takeProfit\}\}/g, _fmtPriceOrNA(pos.takeProfit))
    .replace(/\{\{stopLoss\}\}/g, _fmtPriceOrNA(pos.stopLoss))
    .replace(/\{\{pnl\}\}/g, pnl)
    .replace(/\{\{roe\}\}/g, roe)
    .replace(/\{\{closePrice\}\}/g, _fmtPriceOrNA(pos.closedPrice))
    .replace(/\{\{memo1\}\}/g, pos.memo1 || '')
    .replace(/\{\{memo2\}\}/g, pos.memo2 || '')
    .replace(/\{\{memo3\}\}/g, pos.memo3 || '')
    .replace(/\{\{name\}\}/g, userName)
    .replace(/\{\{nickname1\}\}/g, nick1)
    .replace(/\{\{nickname2\}\}/g, nick2)
}

// ── 타임스탬프 캐시 ──────────────────────────────────────────────────────────

function _cachedTs(posId, type, entryMs, closeMs) {
  var key = posId + ':' + type
  if (_tsCache.has(key)) return _tsCache.get(key)
  var t = _userSettings ? _userSettings.timing : _DEFAULT_TIMING
  var ts
  switch (type) {
    case 'preEntry':   ts = entryMs - _rand(t.preEntryMin, t.preEntryMax) * 1000; break
    case 'long':
    case 'short':      ts = entryMs; break
    case 'postEntry':  ts = entryMs + _rand(t.postEntryMin, t.postEntryMax) * 1000; break
    case 'postEntry1': ts = entryMs + _rand(t.postEntryMin + 30, t.postEntryMax + 60) * 1000; break
    case 'postEntry2': ts = entryMs + _rand(t.postEntryMin + 90, t.postEntryMax + 120) * 1000; break
    case 'postEntry3': ts = entryMs + _rand(t.postEntryMin + 150, t.postEntryMax + 180) * 1000; break
    case 'preClose':   ts = (closeMs || entryMs) - _rand(t.preCloseMin, t.preCloseMax) * 1000; break
    case 'close':      ts = closeMs || entryMs + 1800000; break
    case 'postClose1': ts = (closeMs || entryMs) + _rand(30, 90) * 1000; break
    case 'postClose2': ts = (closeMs || entryMs) + _rand(120, 240) * 1000; break
    case 'postClose3': ts = (closeMs || entryMs) + _rand(300, 480) * 1000; break
    // profit2는 profit1 이후로 보장: profit1 최대값 이후부터 시작
    case 'profit1':    ts = (closeMs || entryMs) + _rand(t.profit1Min, t.profit1Max) * 1000; break
    case 'profit2':    ts = (closeMs || entryMs) + (t.profit1Max + _rand(t.profit2Min, t.profit2Max)) * 1000; break
    default:           ts = entryMs; break
  }
  _tsCache.set(key, ts)
  return ts
}

// ── 메시지 슬롯 정의 ─────────────────────────────────────────────────────────
// phase: 'entry' = entryTime 기반, 'close' = closedAt 기반
var MESSAGE_SLOTS = [
  { type: 'preEntry',   phase: 'entry', templateKey: 'preEntry',   enabledKey: 'preEntry' },
  { type: 'long',       phase: 'entry', templateKey: 'long',       enabledKey: 'long',   sideFilter: 'LONG' },
  { type: 'short',      phase: 'entry', templateKey: 'short',      enabledKey: 'short',  sideFilter: 'SHORT' },
  { type: 'postEntry',  phase: 'entry', templateKey: 'postEntry',  enabledKey: 'postEntry' },
  { type: 'postEntry1', phase: 'entry', templateKey: 'postEntry1', enabledKey: 'postEntry1' },
  { type: 'postEntry2', phase: 'entry', templateKey: 'postEntry2', enabledKey: 'postEntry2' },
  { type: 'postEntry3', phase: 'entry', templateKey: 'postEntry3', enabledKey: 'postEntry3' },
  { type: 'preClose',   phase: 'close', templateKey: 'preClose',   enabledKey: 'preClose' },
  { type: 'close',      phase: 'close', templateKey: 'close',      enabledKey: 'close' },
  { type: 'postClose1', phase: 'close', templateKey: 'postClose1', enabledKey: 'postClose1' },
  { type: 'postClose2', phase: 'close', templateKey: 'postClose2', enabledKey: 'postClose2' },
  { type: 'postClose3', phase: 'close', templateKey: 'postClose3', enabledKey: 'postClose3' },
  { type: 'profit1',    phase: 'close', templateKey: 'profit1',    enabledKey: 'profit1' },
  { type: 'profit2',    phase: 'close', templateKey: 'profit2',    enabledKey: 'profit2' },
]

/**
 * 포지션 → 상황별 채널 포스트 메시지 배열 생성
 */
function buildPositionMessages(pos) {
  var posId = String(pos.id)
  var entryMs = new Date(pos.entryTime).getTime()
  var closeMs = pos.closedAt ? new Date(pos.closedAt).getTime() : null
  var side = (pos.side || 'LONG').toUpperCase()
  var isClosed = (pos.status || 'OPEN') !== 'OPEN'
  var now = Date.now()

  var templates = _userSettings ? _userSettings.templates : _DEFAULTS
  var enabled = _userSettings ? _userSettings.enabled : {}
  var templateImages = _userSettings && _userSettings.templateImages ? _userSettings.templateImages : {}

  var result = []
  for (var i = 0; i < MESSAGE_SLOTS.length; i++) {
    var slot = MESSAGE_SLOTS[i]

    // side 필터
    if (slot.sideFilter && slot.sideFilter !== side) continue

    // close phase는 청산된 포지션만
    if (slot.phase === 'close' && !isClosed) continue

    // 활성화 체크
    if (enabled[slot.enabledKey] === false) continue

    // 템플릿 확인
    var tmpl = templates[slot.templateKey]
    if (!tmpl) continue

    // 변수 치환
    var text = _applyTemplate(tmpl, pos)
    if (!text || !text.trim()) continue

    // 타이밍
    var ts = _cachedTs(posId, slot.type, entryMs, closeMs)
    if (ts > now) continue

    var countMap = {
      preEntry: 'preEntryCount', long: 'longCount', short: 'shortCount',
      postEntry: 'postEntryCount', postEntry1: 'postEntryCount', postEntry2: 'postEntryCount', postEntry3: 'postEntryCount',
      preClose: 'preCloseCount',
      close: 'closeCount', postClose1: 'closeCount', postClose2: 'closeCount', postClose3: 'closeCount',
      profit1: 'profit1Count', profit2: 'profit2Count',
    }
    var _slotImageUrl = templateImages[slot.templateKey] || null
    result.push({
      id: posId + '-' + slot.type,
      text: text,
      entryTime: new Date(ts).toISOString(),
      type: slot.type,
      _ts: ts,
      imageUrl: _slotImageUrl,
      commentCount: (pos.positionCommentCount && countMap[slot.type] != null) ? (pos.positionCommentCount[countMap[slot.type]] || 0) : null,
    })
  }

  // 시간순 정렬 — 항상 오래된 것부터
  result.sort(function(a, b) { return a._ts - b._ts })

  return result
}
// ── 수익인증 카드 이미지 — 서버 API에서 가져오기 ─────────────────────────────

/**
 * 서버에서 수익인증 카드 이미지를 가져와 blob URL로 반환
 */
async function fetchProfitCardImage(posId) {
  try {
    var settings = await loadSettings()
    if (!settings.token) return null

    var url = SERVER_URL + '/api/profit-card/' + posId + '?_t=' + Date.now()

    // 1) 직접 fetch 시도 (캐시 무시)
    try {
      var res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + settings.token },
        cache: 'no-store',
      })
      if (res.ok) {
        var blob = await res.blob()
        if (blob.size > 100) {
          return URL.createObjectURL(blob)
        }
      }
    } catch (e) { /* CORS → proxy 폴백 */ }

    // 2) Background proxy 폴백 (CORS 우회)
    var bgRes = await new Promise(function(resolve) {
      try {
        chrome.runtime.sendMessage({
          action: 'fetchBlob',
          url: url,
          headers: { Authorization: 'Bearer ' + settings.token },
        }, function(response) {
          resolve(response || { dataUrl: null })
        })
      } catch (e) {
        resolve({ dataUrl: null })
      }
    })

    if (bgRes && bgRes.dataUrl) {
      return bgRes.dataUrl
    }

    console.warn('[Teledit] profit card: 직접 fetch + proxy 모두 실패')
    return null
  } catch (e) {
    console.warn('[Teledit] profit card 에러:', e.message)
    return null
  }
}
// ── 커스텀 이미지 fetch (항상 data:URL 반환 — blob: URL은 CSP 차단됨) ────────
async function fetchCustomImage(imageUrl) {
  try {
    // Background proxy 우선 사용 (content script → CORS 차단 방지)
    // background service worker는 extension host_permissions으로 자유롭게 fetch 가능
    var bgRes = await new Promise(function(resolve) {
      try {
        chrome.runtime.sendMessage({
          action: 'fetchBlob',
          url: imageUrl,
          headers: {},
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.warn('[Teledit] proxy 에러:', chrome.runtime.lastError.message)
            resolve({ dataUrl: null })
          } else {
            resolve(response || { dataUrl: null })
          }
        })
      } catch (e) {
        console.warn('[Teledit] sendMessage 에러:', e.message)
        resolve({ dataUrl: null })
      }
    })
    if (bgRes && bgRes.dataUrl) return bgRes.dataUrl

    // proxy 실패 시 직접 fetch 시도 (같은 origin이면 성공할 수 있음)
    try {
      var res = await fetch(imageUrl, { cache: 'no-store' })
      if (res.ok) {
        var blob = await res.blob()
        if (blob.size > 100) {
          return await new Promise(function(resolve) {
            var reader = new FileReader()
            reader.onload = function() { resolve(reader.result) }
            reader.readAsDataURL(blob)
          })
        }
      }
    } catch (e) { /* CORS 실패 → 무시 */ }

    console.warn('[Teledit] custom image: proxy + 직접 fetch 모두 실패:', imageUrl.substring(0, 60))
    return null
  } catch (e) {
    console.warn('[Teledit] custom image 에러:', e.message)
    return null
  }
}

// ── 가짜 댓글 UI — Telegram Discussion 뷰 재현 ─────────────────────────────
// Telegram Web의 댓글 뷰를 그대로 재현:
//   헤더: "← N Comments" + 핀 메시지
//   본문: "Discussion started" 서비스 메시지 + 그룹 채팅 말풍선
//   하단: "Comment" 입력 바

function toggleCommentThread(bubble, pos) {
  if (_commentOverlay) { closeCommentThread(); return }
  showCommentThread(bubble, pos)
}

async function showCommentThread(bubble, pos) {
  if (_commentOverlay) closeCommentThread()

  var posId = pos ? String(pos.id) : null
  var msgEl = bubble.querySelector('.translatable-message')
  var originalText = msgEl ? msgEl.textContent.trim() : ''
  var timeEl = bubble.querySelector('.time .i18n')
  var originalTime = timeEl ? timeEl.textContent.trim() : ''
  var entryDate = pos && pos.entryTime ? new Date(pos.entryTime) : new Date()

  // ── 전체 오버레이 (채팅 영역 대체) ──
  var overlay = document.createElement('div')
  overlay.id = 'teledit-comment-overlay'
  overlay.className = 'teledit-disc-overlay'

  // ── 헤더 바 ──
  var headerBar = document.createElement('div')
  headerBar.className = 'teledit-disc-header'

  var backBtn = document.createElement('button')
  backBtn.className = 'teledit-disc-back'
  var backIcon = document.createElement('span')
  backIcon.className = 'tgico tgico-back teledit-disc-back-icon'
  backBtn.appendChild(backIcon)
  backBtn.addEventListener('click', function() { closeCommentThread() })

  var headerTitle = document.createElement('div')
  headerTitle.className = 'teledit-disc-header-title'
  headerTitle.textContent = 'Comments'

  var headerCount = document.createElement('span')
  headerCount.className = 'teledit-disc-header-count'
  headerCount.textContent = ''

  headerBar.appendChild(backBtn)
  headerBar.appendChild(headerTitle)
  headerBar.appendChild(headerCount)

  // ── 핀 메시지 바 ──
  var pinBar = document.createElement('div')
  pinBar.className = 'teledit-disc-pin'

  var pinLabel = document.createElement('div')
  pinLabel.className = 'teledit-disc-pin-label'
  pinLabel.textContent = 'Pinned Message'

  var pinText = document.createElement('div')
  pinText.className = 'teledit-disc-pin-text'
  // 긴 텍스트 잘라내기
  var truncated = originalText.length > 60 ? originalText.substring(0, 57) + '...' : originalText
  pinText.textContent = truncated

  pinBar.appendChild(pinLabel)
  pinBar.appendChild(pinText)

  // ── 메시지 영역 ──
  var messagesArea = document.createElement('div')
  messagesArea.className = 'teledit-disc-messages'

  // "Discussion started" 서비스 메시지
  var serviceMsg = document.createElement('div')
  serviceMsg.className = 'teledit-disc-service'
  var serviceBubble = document.createElement('div')
  serviceBubble.className = 'teledit-disc-service-inner'
  serviceBubble.textContent = 'Discussion started'
  serviceMsg.appendChild(serviceBubble)
  messagesArea.appendChild(serviceMsg)

  // 로딩 표시
  var loadingEl = document.createElement('div')
  loadingEl.className = 'teledit-disc-loading'
  loadingEl.textContent = 'Loading...'
  messagesArea.appendChild(loadingEl)

  // ── 입력 바 ──
  var inputBar = document.createElement('div')
  inputBar.className = 'teledit-disc-input-bar'

  var inputAvatar = document.createElement('div')
  inputAvatar.className = 'teledit-disc-input-avatar'
  inputAvatar.textContent = 'Y'

  var emojiBtn = document.createElement('span')
  emojiBtn.className = 'teledit-disc-input-icon tgico tgico-smile'

  var inputField = document.createElement('div')
  inputField.className = 'teledit-disc-input-field'
  inputField.setAttribute('contenteditable', 'true')
  inputField.setAttribute('data-placeholder', 'Comment')
  inputField.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      _submitDiscComment(inputField, messagesArea, entryDate)
    }
  })

  var attachBtn = document.createElement('span')
  attachBtn.className = 'teledit-disc-input-icon tgico tgico-attach'

  var micBtn = document.createElement('span')
  micBtn.className = 'teledit-disc-input-icon tgico tgico-microphone'

  inputBar.appendChild(inputAvatar)
  inputBar.appendChild(emojiBtn)
  inputBar.appendChild(inputField)
  inputBar.appendChild(attachBtn)
  inputBar.appendChild(micBtn)

  // ── 조립 ──
  overlay.appendChild(headerBar)
  overlay.appendChild(pinBar)
  overlay.appendChild(messagesArea)
  overlay.appendChild(inputBar)

  // ESC 닫기
  var escHandler = function(e) {
    if (e.key === 'Escape') {
      closeCommentThread()
      document.removeEventListener('keydown', escHandler)
    }
  }
  document.addEventListener('keydown', escHandler)

  // ── 채팅 영역 위에 오버레이 ──
  var chatContainer = document.querySelector('.chat') || document.querySelector('.chats-container') || document.body
  chatContainer.appendChild(overlay)
  _commentOverlay = overlay

  // ── API fetch ──
  var comments = posId ? _commentCache.get(posId) : null
  if (!comments && posId) {
    comments = await fetchPositionComments(posId)
    if (comments.length > 0) _commentCache.set(posId, comments)
  }
  if (!comments) comments = []

  if (!_commentOverlay) return

  // ── 로딩 제거 → 댓글 렌더 ──
  loadingEl.remove()

  comments.forEach(function(c, idx) {
    var offset = (idx + 1) * _rand(60, 300) * 1000
    var commentTime = new Date(entryDate.getTime() + offset)
    var msgBubble = _buildDiscBubble(c.writer, c.text, commentTime)
    messagesArea.appendChild(msgBubble)
  })

  // 헤더 카운트 갱신
  headerCount.textContent = comments.length > 0 ? comments.length + ' Comments' : ''
  headerTitle.textContent = comments.length > 0 ? '' : 'Comments'

  requestAnimationFrame(function() {
    messagesArea.scrollTop = messagesArea.scrollHeight
  })
}

function closeCommentThread() {
  if (_commentOverlay) {
    _commentOverlay.classList.add('closing')
    setTimeout(function() {
      if (_commentOverlay) {
        _commentOverlay.remove()
        _commentOverlay = null
      }
    }, 200)
  }
}

// ── 사용자 댓글 입력 ─────────────────────────────────────────────────────────
function _submitDiscComment(field, messagesArea, entryDate) {
  var text = field.textContent.trim()
  if (!text) return
  var writer = { name: 'You', color: '#6ab3f3' }
  var msgBubble = _buildDiscBubble(writer, text, new Date())
  messagesArea.appendChild(msgBubble)
  messagesArea.scrollTop = messagesArea.scrollHeight
  field.textContent = ''
}

// ── 그룹 채팅 스타일 댓글 말풍선 ─────────────────────────────────────────────
function _buildDiscBubble(writer, text, time) {
  var wrap = document.createElement('div')
  wrap.className = 'teledit-disc-bubble-wrap'

  // 아바타
  var avatar = document.createElement('div')
  avatar.className = 'teledit-disc-avatar'
  if (writer.avatarUrl) {
    var img = document.createElement('img')
    img.src = writer.avatarUrl
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;'
    avatar.appendChild(img)
  } else {
    avatar.style.background = writer.color || '#65aadd'
    avatar.textContent = (writer.name || '?').charAt(0).toUpperCase()
  }

  // 말풍선
  var bubble = document.createElement('div')
  bubble.className = 'teledit-disc-bubble'

  // 발신자명
  var nameEl = document.createElement('div')
  nameEl.className = 'teledit-disc-name'
  nameEl.style.color = writer.color || '#65aadd'
  nameEl.textContent = writer.name

  // 메시지 + 시간
  var bodyRow = document.createElement('div')
  bodyRow.className = 'teledit-disc-body-row'

  var bodyText = document.createElement('span')
  bodyText.className = 'teledit-disc-body'
  bodyText.textContent = text

  var timeEl = document.createElement('span')
  timeEl.className = 'teledit-disc-time'
  timeEl.textContent = _fmtCommentTime(time)

  bodyRow.appendChild(bodyText)
  bodyRow.appendChild(timeEl)

  bubble.appendChild(nameEl)
  bubble.appendChild(bodyRow)

  wrap.appendChild(avatar)
  wrap.appendChild(bubble)

  return wrap
}
// ── 말풍선 데이터 계산 ───────────────────────────────────────────────────────

// ── 뷰 카운트 계산 (dom-helpers.js에서 이동) ────────────────────────────────
function _getViewsBetween(entryTs) {
  const bubbles = [...document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)')]
    .sort((a, b) => parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10))

  let before = null, after = null
  for (const b of bubbles) {
    const ts = parseInt(b.dataset.timestamp, 10)
    const v  = parseInt(b.querySelector('.post-views')?.textContent?.replace(/[^0-9]/g, '') || '0')
    if (ts <= entryTs) before = v
    else if (after === null) { after = v; break }
  }

  if (before !== null && after !== null) return _rand(Math.min(before, after), Math.max(before, after))
  if (before !== null) return _rand(Math.max(1, before - 8), before)
  if (after !== null)  return _rand(after + 5, after + 25)
  return _rand(450, 650)
}

// ── 댓글 수/작성자 캐시 (bug #3 수정) ───────────────────────────────────────
// reinject 시 _rand 재계산으로 아바타가 바뀌는 문제를 posId별 캐시로 해결
function _getReplyData(posId, msgType, dbAuthors, pos) {
  if (_replyDataCache.has(posId)) return _replyDataCache.get(posId)

  var commentCount = 0
  if (pos && pos._commentCount != null) {
    // DB 고정값 사용
    commentCount = pos._commentCount
  } else if (msgType && _userSettings && _userSettings.commentCounts) {
    // DB 값 없을 때 posId 해시 기반 결정론적 계산 (랜덤X → 새로고침 후에도 동일)
    var cc = _userSettings.commentCounts[msgType]
    if (cc && cc.max > 0) {
      var _seed = 0
      for (var _si = 0; _si < posId.length; _si++) _seed = (_seed * 31 + posId.charCodeAt(_si)) | 0
      commentCount = cc.min + Math.abs(_seed) % Math.max(1, cc.max - cc.min + 1)
    }
  }

  var avatarCount = Math.min(commentCount, 3)
  var authorNames = []
  if (dbAuthors && dbAuthors.length >= avatarCount) {
    for (var an = 0; an < avatarCount; an++) authorNames.push(dbAuthors[an])
  } else {
    var fallbackNames = ['해박','J','카파','금안','TP','HG','야미','준음']
    for (var fn = 0; fn < avatarCount; fn++) {
      // 각 슬롯마다 다른 해시 — posId 전체 + 인덱스로 고유값 생성
      var _nameHash = fn * 7 + 13
      for (var _ni = 0; _ni < posId.length; _ni++) _nameHash = (_nameHash * 31 + posId.charCodeAt(_ni)) | 0
      var _idx = Math.abs(_nameHash + fn * 97) % fallbackNames.length
      // 이전 아바타와 중복 방지
      while (fn > 0 && authorNames.indexOf(fallbackNames[_idx]) >= 0) _idx = (_idx + 1) % fallbackNames.length
      authorNames.push(fallbackNames[_idx])
    }
  }

  var data = { commentCount: commentCount, authorNames: authorNames }
  _replyDataCache.set(posId, data)
  return data
}
// ── 댓글 영역 렌더링 ────────────────────────────────────────────────────────

function _buildRepliesFooter(bubble, pos, posId, iconBackup) {
  var repliesRe = bubble.querySelector('replies-element')
  if (!repliesRe) return

  // 핵심: <replies-element>(커스텀 엘리먼트)를 일반 <div>로 교체
  // Telegram의 connectedCallback이 우리가 설정한 아이콘/아바타를 지워버리는 것을 원천 차단
  var plainDiv = document.createElement('div')
  plainDiv.className = repliesRe.className || ''
  plainDiv.innerHTML = repliesRe.innerHTML
  plainDiv.style.cssText = repliesRe.style.cssText || ''
  if (repliesRe.parentElement) {
    repliesRe.parentElement.replaceChild(plainDiv, repliesRe)
  }
  repliesRe = plainDiv

  // connectedCallback 데이터 로드 차단 (이제 div라 불필요하지만 안전장치)
  repliesRe.removeAttribute('data-post-key')

  // 댓글 수/작성자: 캐시에서 가져오기
  var _msgType = pos && pos._messageType ? pos._messageType : null
  var _dbAuthors = pos && pos._commentAuthors ? pos._commentAuthors : null
  var replyData = _getReplyData(posId, _msgType, _dbAuthors, pos)
  var _commentCount = replyData.commentCount
  var authorNames = replyData.authorNames

  // 채널 아바타 삽입 제거 — 댓글 아바타는 이름 기반만 사용

  // CSS 클래스로 아이콘 제어 (JS DOM 조작 최소화)
  if (_commentCount === 0) {
    bubble.classList.add('teledit-no-comments')
  } else {
    bubble.classList.remove('teledit-no-comments')
  }

  // Telegram K 아바타 색상
  var _tgColors = ['red', 'green', 'violet', 'cyan', 'blue', 'pink', 'orange']

  // Bug 11 fix: re-entry 방지 플래그
  var _cleaning = false

  var _cleanReplies = function(el) {
    if (_cleaning) return
    _cleaning = true

    // 기존 아바타/짧은답장 제거
    el.querySelectorAll('.stacked-avatars, .replies-short').forEach(function(c) { c.remove() })

    var footerInner = el.querySelector('.replies-footer')
    if (_commentCount > 0 && footerInner) {
      // 댓글 있을 때: 아이콘 제거 (아바타로 대체)
      footerInner.querySelectorAll('.replies-footer-icon-comments, .replies-footer-icon').forEach(function(c) { c.remove() })
    } else if (_commentCount === 0 && footerInner) {
      // 댓글 없을 때: 아이콘이 없으면 백업 또는 기본 말풍선 SVG 생성
      if (!footerInner.querySelector('.replies-footer-icon')) {
        if (iconBackup) {
          footerInner.insertBefore(iconBackup.cloneNode(true), footerInner.firstChild)
        } else {
          var iconEl = document.createElement('span')
          iconEl.className = 'replies-footer-icon tgico'
          var svgNS = 'http://www.w3.org/2000/svg'
          var svg = document.createElementNS(svgNS, 'svg')
          svg.setAttribute('width', '20')
          svg.setAttribute('height', '20')
          svg.setAttribute('viewBox', '0 0 24 24')
          svg.setAttribute('fill', 'currentColor')
          var path = document.createElementNS(svgNS, 'path')
          path.setAttribute('d', 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z')
          svg.appendChild(path)
          iconEl.appendChild(svg)
          footerInner.insertBefore(iconEl, footerInner.firstChild)
        }
      }
    }

    // 댓글 수 텍스트
    var ftxt = el.querySelector('.replies-footer-text .i18n') || el.querySelector('.i18n')
    if (ftxt) {
      ftxt.textContent = _commentCount > 0
        ? _commentCount + (_commentCount === 1 ? ' Comment' : ' Comments')
        : 'Leave a comment'
    }

    // 댓글 아바타 (최대 3개) — 캐시된 작성자 사용
    if (_commentCount > 0) {
      var avatarCount = authorNames.length

      var wrap = document.createElement('div')
      wrap.className = 'stacked-avatars replies-footer-avatars'
      wrap.style.setProperty('--avatar-size', '30px')

      for (var ai = 0; ai < avatarCount; ai++) {
        var container = document.createElement('div')
        container.className = 'stacked-avatars-avatar-container'
        if (ai === 0) container.classList.add('is-first')
        if (ai === avatarCount - 1) container.classList.add('is-last')

        var avatar = document.createElement('div')
        avatar.className = 'avatar avatar-like avatar-30 avatar-gradient stacked-avatars-avatar'
        if (authorNames[ai] === '__channel__' && _userSettings && _userSettings.channelAvatarUrl) {
          var img = document.createElement('img')
          img.src = _userSettings.channelAvatarUrl
          img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;'
          avatar.style.background = 'transparent'
          avatar.appendChild(img)
        } else {
          var nameHash = 0
          for (var ch = 0; ch < authorNames[ai].length; ch++) nameHash += authorNames[ai].charCodeAt(ch)
          avatar.setAttribute('data-color', _tgColors[nameHash % _tgColors.length])
          var initial = authorNames[ai].slice(0, authorNames[ai].charCodeAt(0) > 255 ? 2 : 1)
          avatar.textContent = initial
        }

        container.appendChild(avatar)
        wrap.appendChild(container)
      }

      el.insertBefore(wrap, el.firstChild)
    }

    _cleaning = false
  }

  // connectedCallback 재렌더링 대응 — re-entry 방지 + 5초 후 해제
  var _repliesObs = new MutationObserver(function() {
    if (_cleaning) return
    _repliesObs.disconnect()
    _cleanReplies(repliesRe)
    _repliesObs.observe(repliesRe, { childList: true, subtree: true })
  })
  _repliesObs.observe(repliesRe, { childList: true, subtree: true })
  setTimeout(function() { _cleanReplies(repliesRe) }, 300)
  setTimeout(function() { _cleanReplies(repliesRe) }, 800)
  setTimeout(function() { _repliesObs.disconnect() }, 5000)

  // ── "Leave a comment" 클릭 → 가짜 댓글 스레드 열기 ──
  var _posRef = pos
  repliesRe.style.cursor = 'pointer'
  repliesRe.addEventListener('click', function(e) {
    e.stopPropagation()
    e.preventDefault()
    toggleCommentThread(bubble, _posRef)
  }, true)
}
// ── 리액션 요소 구성 ────────────────────────────────────────────────────────

function _buildBubbleReactions(bubble, pos, posId, entryTs) {
  // 캐시 or 새 데이터
  var cached    = posId ? bubbleDataCache.get(posId) : null
  var viewCount = cached ? cached.viewCount : _getViewsBetween(entryTs)

  // 현재 페이지의 스티커 blob URL 맵
  var blobMap = _getReactionBlobMap()
  // 반응 개수 결정 우선순위:
  // 1) 커스텀 메시지 개별값 (pos._reactionHeartMin 등)
  // 2) 포지션 DB 확정값 (pos._reactionData[msgType])
  // 3) 유형별 설정 (reactionSettings[msgType])
  // 4) 전역 기본값 (reactions.heart 등)
  // 5) 하드코딩 20~30
  var _msgType = pos ? pos._messageType : null
  var _rxFromDb = pos && pos._reactionData && _msgType ? pos._reactionData[_msgType] : null
  var _rxPerType = _userSettings && _userSettings.reactionSettings && _msgType
    ? _userSettings.reactionSettings[_msgType] : null
  var _rxGlobal = _userSettings && _userSettings.reactions ? _userSettings.reactions : null
  // 999 = "기본값 사용" → 20~30 랜덤
  function _rxResolve(val, fallbackRange) {
    if (val != null && val !== 999) return [val, val]
    return fallbackRange
  }
  function _rxResolveRange(range, fallbackRange) {
    if (range && range[0] !== 999 && range[1] !== 999) return range
    return fallbackRange
  }
  var _rxFallback = [20, 30]
  var _rxRanges = [
    // ❤️ heart
    pos && pos._reactionHeartMin != null
      ? [pos._reactionHeartMin, pos._reactionHeartMax]
      : _rxFromDb ? [_rxFromDb.heart, _rxFromDb.heart]
      : _rxResolveRange(_rxPerType && _rxPerType.heart, _rxGlobal ? [_rxGlobal.heart.min, _rxGlobal.heart.max] : _rxFallback),
    // 👍 thumb
    pos && pos._reactionThumbMin != null
      ? [pos._reactionThumbMin, pos._reactionThumbMax]
      : _rxFromDb ? [_rxFromDb.thumb, _rxFromDb.thumb]
      : _rxResolveRange(_rxPerType && _rxPerType.thumb, _rxGlobal ? [_rxGlobal.thumb.min, _rxGlobal.thumb.max] : _rxFallback),
    // 🔥 fire
    pos && pos._reactionFireMin != null
      ? [pos._reactionFireMin, pos._reactionFireMax]
      : _rxFromDb ? [_rxFromDb.fire, _rxFromDb.fire]
      : _rxResolveRange(_rxPerType && _rxPerType.fire, _rxGlobal ? [_rxGlobal.fire.min, _rxGlobal.fire.max] : _rxFallback),
  ]
  var reactionData = cached
    ? cached.reactions
    : REACTION_DOC_IDS.map(function(docId, i) {
        return {
          blobSrc:  blobMap[docId] || '',
          emoticon: REACTION_EMOTICONS[i],
          count:    _rand(_rxRanges[i][0], _rxRanges[i][1]),
          chosen:   false,
        }
      })

  // ── reactions-element -> 일반 div로 교체
  var origReactionsEl = bubble.querySelector('reactions-element')
  var reactionsEl = null
  if (origReactionsEl) {
    var origTime = origReactionsEl.querySelector('.time')
    reactionsEl = document.createElement('div')
    reactionsEl.className = origReactionsEl.className
    var _visibleReactions = reactionData.filter(function(r) { return r.count > 0 })
    _visibleReactions.forEach(function(r, idx) {
      var btn = _buildOneReaction(r.blobSrc, r.emoticon, r.count, r.chosen, posId, idx)
      if (idx === _visibleReactions.length - 1) btn.classList.add('is-last')
      reactionsEl.appendChild(btn)
    })
    if (origTime) {
      var timeCopy = origTime.cloneNode(true)
      reactionsEl.appendChild(timeCopy)
    }

    // 항상 원래 위치(.message 안)에 교체. profit1은 bubble.js에서 별도 이동
    origReactionsEl.replaceWith(reactionsEl)
  }

  // 캐시 저장 (최초 1회)
  if (posId && !cached) {
    bubbleDataCache.set(posId, { viewCount: viewCount, reactions: reactionData })
  }

  return { reactionsEl: reactionsEl, reactionData: reactionData, viewCount: viewCount }
}
// ── 그룹/위치/날짜그룹 ──────────────────────────────────────────────────────

// ── 그룹 정보 계산 ─────────────────────────────────────────────────────────
// 2분(120s) 기준으로 이전/다음 포스트와의 그룹 경계를 판단한다.
// Bug 18 fix: 실제 포스트만 사용 (주입된 버블 제외)
function _getGroupInfo(entryTs) {
  var THRESHOLD = 120
  // Bug fix: 실제 + 주입 버블 모두 참고하여 그룹 경계 판단
  // 기존에는 실제 버블만 참고하여 여러 Teledit 버블이 각각 isGroupFirst=true가 되어
  // 개별 그룹으로 생성되었음 (clumping 원인 #2)
  var bubbles = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]'))
    .sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })

  var prevTs = null, nextTs = null
  for (var i = 0; i < bubbles.length; i++) {
    var ts = parseInt(bubbles[i].dataset.timestamp, 10)
    if (ts <= entryTs) prevTs = ts
    else if (nextTs === null) { nextTs = ts; break }
  }

  return {
    isGroupFirst: prevTs === null || (entryTs - prevTs) >= THRESHOLD,
    isGroupLast:  nextTs === null || (nextTs - entryTs) >= THRESHOLD,
    prevTs: prevTs, nextTs: nextTs,
  }
}

// ── Unix day number (로케일 무관 날짜 비교) ─────────────────────────────────
function _dayOfTs(ts) {
  // ts는 초 단위 Unix timestamp → 로컬 타임존 기준 날짜 번호
  var d = new Date(ts * 1000)
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000)
}

// 날짜 그룹에서 타임스탬프 추출 (첫 번째 실제 버블의 timestamp 사용)
function _getDateGroupDay(dateGroup) {
  // teledit-date-group: 내부 teledit 버블의 날짜 사용
  if (dateGroup.classList.contains('teledit-date-group')) {
    var anyBubble = dateGroup.querySelector('.bubble.channel-post[data-timestamp]')
    if (anyBubble) return _dayOfTs(parseInt(anyBubble.dataset.timestamp, 10))
    return -1
  }
  // 실제 date-group: teledit 주입 제외한 실제 버블의 날짜 사용
  // (teledit 버블이 실제 그룹 안에 있어도 잘못된 날짜 계산 방지)
  var realBubble = dateGroup.querySelector('.bubble.channel-post[data-timestamp]:not(.teledit-injected)')
  if (realBubble) return _dayOfTs(parseInt(realBubble.dataset.timestamp, 10))
  return -1
}

// ── DOM 삽입 및 그룹 처리 ────────────────────────────────────────────────────
// Bug 1 fix: forceInsert 파라미터 제거 — 항상 범위 체크
// Bug 2 fix: originalText 파라미터 추가 — DOM이 아닌 원본 텍스트 저장
function _insertBubbleIntoDOM(bubble, group, entryTs, pos, posId, isGroupFirst, isGroupLast, originalText) {
  var joinedExistingGroup = false

  if (!isGroupFirst) {
    var prevInjected = [].slice.call(document.querySelectorAll('.bubble.channel-post.teledit-injected[data-timestamp]'))
      .filter(function(b) {
        var ts = parseInt(b.dataset.timestamp, 10)
        return ts < entryTs && (entryTs - ts) < 120
      })
      .sort(function(a, b) { return parseInt(b.dataset.timestamp, 10) - parseInt(a.dataset.timestamp, 10) })[0]

    if (prevInjected) {
      var prevGroup = prevInjected.closest('.bubbles-group.teledit-injected-group')
      if (prevGroup) {
        group = prevGroup
        // 타임스탬프 기준 올바른 DOM 위치에 삽입 (스크롤 reinject 시 중간 버블도 올바른 위치)
        // 안전: teledit-injected만 대상으로 (실제 버블이 그룹에 섞여있는 경우 대비)
        var _siblings = [].slice.call(prevGroup.querySelectorAll('.bubble.channel-post.teledit-injected[data-timestamp]'))
        var _insertBeforeSib = null
        for (var _si2 = 0; _si2 < _siblings.length; _si2++) {
          var _sibTs = parseInt(_siblings[_si2].dataset.timestamp, 10)
          if (!isNaN(_sibTs) && _sibTs > entryTs) { _insertBeforeSib = _siblings[_si2]; break }
        }
        if (_insertBeforeSib) prevGroup.insertBefore(bubble, _insertBeforeSib)
        else prevGroup.appendChild(bubble)
        joinedExistingGroup = true

        // 그룹의 is-group-first/last / bubble-tail 재계산: teledit-injected만 대상
        var _finalSibs = [].slice.call(prevGroup.querySelectorAll('.bubble.channel-post.teledit-injected[data-timestamp]'))
        for (var _fsi = 0; _fsi < _finalSibs.length; _fsi++) {
          var _fs = _finalSibs[_fsi]
          if (_fsi === _finalSibs.length - 1) {
            // 마지막 → is-group-last=true, tail 유지/복원
            _fs.classList.add('is-group-last', 'can-have-tail')
          } else {
            // 중간 → is-group-last 제거, tail 제거
            _fs.classList.remove('is-group-last', 'can-have-tail')
            var _ft = _fs.querySelector('.bubble-tail')
            if (_ft) _ft.remove()
          }
          // is-group-first는 첫 번째만
          if (_fsi === 0) _fs.classList.add('is-group-first')
          else _fs.classList.remove('is-group-first')
        }
      }
    }
  }

  if (!joinedExistingGroup) {
    group.appendChild(bubble)

    // 범위 체크: 스크롤 reinject는 스킵 (핸들러가 이미 필터링), 수동 삽입만 체크
    var inserted = false
    if (!pos || !pos._fromScroll) {
      var realPosts = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)'))
      realPosts.sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })
      if (realPosts.length) {
        var minRealTs = parseInt(realPosts[0].dataset.timestamp, 10)
        var maxRealTs = parseInt(realPosts[realPosts.length - 1].dataset.timestamp, 10)
        if (entryTs < minRealTs - 21600 || entryTs > maxRealTs + 172800) {
          if (posId) pendingBubbles.set(posId, { text: originalText || '', pos: pos })
          bubble.remove()
          group.remove()
          return false
        }
      }
    }

    // ── 삽입 위치 결정 (실제 + 주입 버블 모두 참고) ──
    // Bug fix: 개별 버블 단위로 삽입 위치를 결정하여 그룹 단위 삽입으로 인한
    // clumping 문제 해결. insertBefore 버블이 그룹의 첫 번째가 아닌 경우
    // 그룹 앞이 아닌, 해당 버블의 그룹 바로 앞에 삽입.
    var allPosts = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]'))
    allPosts.sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })

    if (allPosts.length) {
      var insertBefore = null
      var insertAfter = null
      for (var j = 0; j < allPosts.length; j++) {
        if (parseInt(allPosts[j].dataset.timestamp, 10) > entryTs) {
          insertBefore = allPosts[j]
          break
        }
        insertAfter = allPosts[j]
      }
      if (insertBefore) {
        var pg = insertBefore.closest('.bubbles-group')
        if (pg && pg.parentElement) {
          // 핵심 수정: insertBefore가 그룹의 첫 번째 버블인지 확인
          var firstInGroup = pg.querySelector('.bubble.channel-post[data-timestamp]')
          if (firstInGroup === insertBefore) {
            // insertBefore가 그룹 첫 번째 → 그룹 앞에 삽입 (기존 동작)
            pg.parentElement.insertBefore(group, pg)
          } else {
            // insertBefore가 그룹 중간/끝 → insertAfter 버블의 그룹 뒤에 삽입
            // 이렇게 하면 Teledit 버블이 올바른 시간 위치에 나타남
            if (insertAfter) {
              var afterPg = insertAfter.closest('.bubbles-group')
              if (afterPg && afterPg !== pg) {
                // insertAfter가 다른 그룹에 있으면 그 그룹 뒤에 삽입
                afterPg.parentElement.insertBefore(group, afterPg.nextSibling)
              } else {
                // insertAfter가 같은 그룹 안에 있으면 그룹 앞에 삽입
                // (그룹 내부를 쪼갤 수 없으므로 가장 가까운 위치)
                pg.parentElement.insertBefore(group, pg)
              }
            } else {
              pg.parentElement.insertBefore(group, pg)
            }
          }
          inserted = true
        }
      }
      if (!inserted) {
        // 마지막 real 포스트 뒤에 붙이기 (teledit 버블이 아닌 실제 포스트 기준)
        var realPostsForTail = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)'))
        realPostsForTail.sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })
        if (realPostsForTail.length) {
          var lastRealPost = realPostsForTail[realPostsForTail.length - 1]
          var lastPg = lastRealPost.closest('.bubbles-group')
          if (lastPg && lastPg.parentElement) {
            lastPg.parentElement.insertBefore(group, lastPg.nextSibling)
            inserted = true
          }
        }
      }
    }
    if (!inserted) {
      var dg = document.querySelectorAll('.bubbles-date-group')
      if (dg.length) dg[dg.length - 1].appendChild(group)
    }

    // ── Bug 5,16 fix: 날짜 그룹 교정 (Unix day 비교, 방향 판단) ──
    var parentDateGroup = group.closest('.bubbles-date-group')
    if (parentDateGroup) {
      var parentDay = _getDateGroupDay(parentDateGroup)
      var myDay = _dayOfTs(entryTs)

      if (parentDay >= 0 && parentDay !== myDay) {
        var _par = parentDateGroup.parentElement
        if (!_par) return true

        // 같은 날짜의 date-group이 있으면 재사용 (실제든 teledit이든 상관없이)
        // 특히 Telegram이 이미 같은 날짜의 real date-group을 만들었으면 그걸 사용해야
        // 중복 섹션이 생기지 않음
        var existingDateGroup = null
        var allDateGroups = _par.querySelectorAll('.bubbles-date-group')
        for (var dg = 0; dg < allDateGroups.length; dg++) {
          var dgDay = _getDateGroupDay(allDateGroups[dg])
          if (dgDay === myDay) { existingDateGroup = allDateGroups[dg]; break }
        }

        if (existingDateGroup) {
          existingDateGroup.appendChild(group)
        } else {
          var newDateGroup = document.createElement('div')
          newDateGroup.className = 'bubbles-date-group teledit-date-group'
          newDateGroup.appendChild(_buildDateSeparator(entryTs))
          newDateGroup.appendChild(group)

          // Bug 5 fix: 날짜 비교 후 before/after 결정
          if (myDay < parentDay) {
            _par.insertBefore(newDateGroup, parentDateGroup)
          } else {
            // myDay > parentDay → 뒤에 삽입
            if (parentDateGroup.nextSibling) {
              _par.insertBefore(newDateGroup, parentDateGroup.nextSibling)
            } else {
              _par.appendChild(newDateGroup)
            }
          }
        }
      }
    }

    // ── 이전 그룹과의 간격 ──
    var prevGroupEl = group.previousElementSibling
    if (prevGroupEl && prevGroupEl.classList.contains('bubbles-group')) {
      if (!isGroupFirst) {
        var lastPrevBubble = prevGroupEl.querySelector('.bubble:last-child')
        if (lastPrevBubble) {
          lastPrevBubble.classList.remove('is-group-last', 'can-have-tail')
          var prevTail = lastPrevBubble.querySelector('.bubble-tail')
          if (prevTail) prevTail.remove()
        }
      } else if (prevGroupEl.classList.contains('bubbles-group-last')) {
        group.style.marginTop = '6px'
      }
    }

    // ── 다음 그룹과의 간격 ──
    if (!isGroupLast) {
      var nextGroupEl = group.nextElementSibling
      if (nextGroupEl && nextGroupEl.classList.contains('bubbles-group') &&
          !nextGroupEl.classList.contains('teledit-injected-group')) {
        var firstNextBubble = nextGroupEl.querySelector('.bubble:first-child')
        if (firstNextBubble) {
          firstNextBubble.classList.remove('is-group-first')
        }
      }
    }
  }

  return true
}
// ── 채널 말풍선 DOM 주입 — 오케스트레이터 ────────────────────────────────────

function insertBubble(text, pos) {
  var _dbgId = pos ? String(pos.id) : '?'
  if (!isChannelView()) {
    if (pos && pos._fromScroll) console.log('[Teledit] FAIL 채널뷰아님:', _dbgId)
    return false
  }

  var posId   = pos ? String(pos.id) : null
  var fakeMid = 'teledit-' + (posId || Date.now())
  if (document.querySelector('[data-mid="' + fakeMid + '"]')) return false

  var entryTs = pos && pos.entryTime
    ? Math.floor(new Date(pos.entryTime).getTime() / 1000)
    : Math.floor(Date.now() / 1000)

  var nowTs = Math.floor(Date.now() / 1000)
  if (entryTs > nowTs) {
    if (pos && pos._fromScroll) console.log('[Teledit] FAIL 미래시간:', _dbgId)
    var _futureId = pos ? String(pos.id) : null
    if (_futureId) pendingBubbles.set(_futureId, { text: text, pos: pos })
    return false
  }

  var template = document.querySelector('.bubble.channel-post.with-replies:not(.teledit-injected)')
    || document.querySelector('.bubble.channel-post:not(.teledit-injected)')
  if (!template) { if (pos && pos._fromScroll) console.log('[Teledit] FAIL 템플릿없음:', _dbgId); return false }
  var bubble = template.cloneNode(true)

  // 아이콘 백업: 클론에 없으면 페이지의 실제 버블에서 가져옴
  var _savedIcon = bubble.querySelector('.replies-footer-icon')
    || document.querySelector('.bubble.channel-post:not(.teledit-injected) .replies-footer-icon')
  var _iconBackup = _savedIcon ? _savedIcon.cloneNode(true) : null

  // 시간 문자열 생성
  var d = pos && pos.entryTime ? new Date(pos.entryTime) : new Date()
  var existingTimeEl = document.querySelector('.bubble.channel-post:not(.teledit-injected) .time .i18n')
  var existingTimeText = existingTimeEl ? existingTimeEl.textContent.trim() : ''
  var timeStr
  if (existingTimeText) {
    var hours = d.getHours()
    var mins = d.getMinutes().toString().padStart(2, '0')
    var h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    var ap = hours < 12 ? existingTimeText.match(/[Aa][Mm]/)?.[0] || 'AM' : existingTimeText.match(/[Pp][Mm]/)?.[0] || 'PM'
    var hStr = h12.toString().padStart(2, '0')
    var ampmFirst = /^[APap][Mm]\s/.test(existingTimeText)
    timeStr = ampmFirst ? (ap + ' ' + hStr + ':' + mins) : (hStr + ':' + mins + ' ' + ap)
  } else {
    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  var titleStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })

  // 그룹 경계 판단
  var groupInfo = _getGroupInfo(entryTs)
  var isGroupFirst = groupInfo.isGroupFirst
  var isGroupLast  = groupInfo.isGroupLast

  // 기본 속성
  bubble.setAttribute('data-mid', fakeMid)
  bubble.setAttribute('data-timestamp', String(entryTs))
  bubble.dataset.status = pos?.status || 'OPEN'
  bubble.classList.add('teledit-injected')
  bubble.classList.toggle('is-group-first', isGroupFirst)
  bubble.classList.toggle('is-group-last', isGroupLast)

  // 편집 이중 시간 제거
  bubble.querySelectorAll('.time-edited').forEach(function(el) { el.remove() })

  // ── 불필요한 원본 요소 제거 (텍스트 교체 전에 수행!) ──
  // .reply(답글 인용)와 .webpage(링크 프리뷰)도 자체 .translatable-message를 가질 수 있어서,
  // 이들을 먼저 제거하지 않으면 querySelector가 엉뚱한 span을 찾아버림
  bubble.querySelector('.reply')?.remove()
  bubble.querySelector('.webpage')?.remove()

  // 메시지 텍스트 교체 — .message 안의 .translatable-message만 정확히 타겟팅
  var _msgDivT = bubble.querySelector('.message')
  var msgSpan = _msgDivT ? _msgDivT.querySelector('.translatable-message') : bubble.querySelector('.translatable-message')
  // Bug 10 fix: 템플릿이 이미지 전용 포스트일 경우 .translatable-message 생성
  if (!msgSpan) {
    var _msgDiv2 = _msgDivT || bubble.querySelector('.message')
    if (_msgDiv2) {
      msgSpan = document.createElement('span')
      msgSpan.className = 'translatable-message mfp-text'
      _msgDiv2.insertBefore(msgSpan, _msgDiv2.firstChild)
    }
  }
  if (msgSpan) {
    while (msgSpan.firstChild) msgSpan.removeChild(msgSpan.firstChild)
    // text가 null/undefined이면 빈 문자열로 (원본 텍스트 유지 방지)
    var _safeText = (text == null) ? '' : String(text)
    // #해시태그를 파란색으로 렌더링
    var parts = _safeText.split(/(#[^\s#]+)/g)
    for (var pi = 0; pi < parts.length; pi++) {
      if (parts[pi].charAt(0) === '#' && parts[pi].length > 1) {
        var tag = document.createElement('span')
        tag.style.color = 'var(--link-color, #6ab2f2)'
        tag.textContent = parts[pi]
        msgSpan.appendChild(tag)
      } else {
        msgSpan.appendChild(document.createTextNode(parts[pi]))
      }
    }
  } else {
    // msgSpan을 찾지 못하면 - 템플릿이 손상된 것. 로그 남김
    if (pos && pos._messageType && pos._messageType.indexOf('custom') === 0) {
      console.warn('[Teledit] 커스텀 메시지 msgSpan 못 찾음! 템플릿 구조 확인 필요:', bubble.className, bubble.querySelector('.message')?.className)
    }
  }

  // ── 리액션 (bubble-reactions.js) ──
  var rxResult = _buildBubbleReactions(bubble, pos, posId, entryTs)

  // ── profit1 이미지 처리 ──
  // 단순화: .message 유지 (텍스트만 비움), .attachment를 .message 앞에 추가
  // reactions/time은 .message 안에 그대로 둠 (Telegram 기본 구조)
  var _isProfit1 = pos && pos._messageType === 'profit1'
  var _parentPosId = pos && pos._parentPosId ? pos._parentPosId : null
  if (_isProfit1 && _parentPosId) {
    var _bcEl = bubble.querySelector('.bubble-content')

    // 1. .message에서 .time 미리 추출 (복사), 리액션 이동, 그 다음 .message 제거
    var _msgDiv = bubble.querySelector('.message')
    var _clonedTime = _msgDiv ? _msgDiv.querySelector('.time')?.cloneNode(true) : null
    if (_msgDiv) {
      if (rxResult.reactionsEl && _msgDiv.contains(rxResult.reactionsEl)) {
        _bcEl.appendChild(rxResult.reactionsEl)
      }
      _msgDiv.remove()
    }

    // 2. .attachment 생성 (bc 첫 번째 자식)
    var _attachment = bubble.querySelector('.attachment')
    if (!_attachment) {
      _attachment = document.createElement('div')
      _attachment.className = 'attachment media-container'
      if (_bcEl) _bcEl.insertBefore(_attachment, _bcEl.firstChild)
    }
    while (_attachment.firstChild) _attachment.removeChild(_attachment.firstChild)

    // 이미지 플레이스홀더
    var _placeholder = document.createElement('img')
    _placeholder.className = 'media-photo'
    _placeholder.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="290" height="400"><rect fill="#0d1117" width="290" height="400"/></svg>')
    _placeholder.style.cssText = 'width:290px;height:400px;display:block;'
    _attachment.appendChild(_placeholder)
    _attachment.style.cssText = 'width:290px;position:relative;overflow:hidden;'

    // 3. 시간/뷰수 — 기존 .time 요소를 그대로 복사해 absolute 오버레이로 사용
    var _timeOverlay = _clonedTime || document.createElement('div')
    _timeOverlay.className = (_timeOverlay.className || '') + ' teledit-time-overlay'
    _timeOverlay.style.cssText = 'position:absolute;bottom:4px;right:4px;z-index:2;'
    // .time-inner에 Telegram 원본 포토 오버레이 CSS 직접 적용
    var _timeInner = _timeOverlay.querySelector('.time-inner')
    if (_timeInner) {
      _timeInner.style.cssText = 'background:#00000059!important;border-radius:10px;height:18px;padding:0 5px;color:#fff!important;display:flex;align-items:center;'
    }
    _attachment.appendChild(_timeOverlay)

    // 4. 핵심 클래스 — Telegram 실제 이미지 전용 포스트 클래스
    bubble.classList.add('photo', 'is-message-empty')
    bubble.classList.remove('has-webpage', 'video', 'just-media')
    if (_bcEl) _bcEl.style.maxWidth = 'min(100%, 420px)'

    // bubble flex를 column으로 — reactions가 아래로
    bubble.style.flexDirection = 'column'
    bubble.style.alignItems = 'flex-start'

    // 5. reactions: .time 제거
    var _rxEl = rxResult.reactionsEl
    if (_rxEl) {
      var _rxTime = _rxEl.querySelector('.time')
      if (_rxTime) _rxTime.remove()
    }

    // 6. 이미지 fetch + 로드 후 크기 조정
    fetchProfitCardImage(_parentPosId).then(function(imgUrl) {
      if (imgUrl && _placeholder.parentElement) {
        _placeholder.onload = function() {
          var nw = _placeholder.naturalWidth, nh = _placeholder.naturalHeight
          var scale = Math.min(290 / nw, 400 / nh, 1)
          var fw = Math.round(nw * scale), fh = Math.round(nh * scale)
          _placeholder.style.cssText = 'width:' + fw + 'px;height:' + fh + 'px;display:block;'
          _attachment.style.setProperty('width', fw + 'px', 'important')
          _attachment.style.setProperty('height', fh + 'px', 'important')
          _attachment.style.setProperty('max-height', 'none', 'important')
        }
        _placeholder.src = imgUrl
      }
    })
  } else if (pos && pos._messageType === 'customImage' && pos._customImageUrl) {
    // ── 커스텀 메시지 이미지 처리 (profit1 구조 동일 적용) ──
    console.log('[Teledit] customImage 렌더링:', pos.id, 'url:', pos._customImageUrl.substring(0, 80), 'hasText:', !!(text && text.trim()))
    var _bcEl2 = bubble.querySelector('.bubble-content')
    var _msgDiv3 = bubble.querySelector('.message')
    var _clonedTime2 = _msgDiv3 ? _msgDiv3.querySelector('.time')?.cloneNode(true) : null
    var _hasText = text && text.trim().length > 0

    if (!_hasText) {
      // ── 이미지만: profit1과 동일한 구조 ──
      // 1. 리액션 이동 + .message 제거
      if (_msgDiv3) {
        if (rxResult.reactionsEl && _msgDiv3.contains(rxResult.reactionsEl)) {
          _bcEl2.appendChild(rxResult.reactionsEl)
        }
        _msgDiv3.remove()
      }

      // 2. .attachment 생성
      var _att2 = bubble.querySelector('.attachment')
      if (!_att2) {
        _att2 = document.createElement('div')
        _att2.className = 'attachment media-container'
        if (_bcEl2) _bcEl2.insertBefore(_att2, _bcEl2.firstChild)
      }
      while (_att2.firstChild) _att2.removeChild(_att2.firstChild)

      // 이미지 플레이스홀더
      var _CM_MAX_W = 420, _CM_MAX_H = 320
      var _ph2 = document.createElement('img')
      _ph2.className = 'media-photo'
      _ph2.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + _CM_MAX_W + '" height="' + _CM_MAX_H + '"><rect fill="#0d1117" width="' + _CM_MAX_W + '" height="' + _CM_MAX_H + '"/></svg>')
      _ph2.style.cssText = 'max-width:100%;width:' + _CM_MAX_W + 'px;height:auto;display:block;object-fit:contain;'
      _att2.appendChild(_ph2)
      _att2.style.cssText = 'max-width:100%;width:' + _CM_MAX_W + 'px;height:' + _CM_MAX_H + 'px;position:relative;overflow:hidden;'

      // 이미지 로드 → 비율 유지하며 최대 420x320 리사이즈
      ;(function(_img, _attEl, _url, _maxW, _maxH) {
        fetchCustomImage(_url).then(function(imgUrl) {
          if (imgUrl && _img.parentElement) {
            _img.onload = function() {
              var nw = _img.naturalWidth, nh = _img.naturalHeight
              var scale = Math.min(_maxW / nw, _maxH / nh, 1)
              var fw = Math.round(nw * scale), fh = Math.round(nh * scale)
              _img.style.cssText = 'max-width:100%;width:' + fw + 'px;height:auto;display:block;'
              _attEl.style.setProperty('width', fw + 'px', 'important')
              _attEl.style.setProperty('max-width', '100%', 'important')
              _attEl.style.setProperty('height', fh + 'px', 'important')
              _attEl.style.setProperty('max-height', 'none', 'important')
            }
            _img.src = imgUrl
          }
        })
      })(_ph2, _att2, pos._customImageUrl, _CM_MAX_W, _CM_MAX_H)

      // 3. 시간 오버레이 (profit1 동일)
      var _timeOverlay2 = _clonedTime2 || document.createElement('div')
      _timeOverlay2.className = (_timeOverlay2.className || '') + ' teledit-time-overlay'
      _timeOverlay2.style.cssText = 'position:absolute;bottom:4px;right:4px;z-index:2;'
      var _timeInner2 = _timeOverlay2.querySelector('.time-inner')
      if (_timeInner2) {
        _timeInner2.style.cssText = 'background:#00000059!important;border-radius:10px;height:18px;padding:0 5px;color:#fff!important;display:flex;align-items:center;'
      }
      _att2.appendChild(_timeOverlay2)

      // 4. 클래스 (profit1 동일)
      bubble.classList.add('photo', 'is-message-empty')
      bubble.classList.remove('has-webpage', 'video', 'just-media')
      if (_bcEl2) _bcEl2.style.maxWidth = 'min(100%, 420px)'

      // 5. bubble flex column (profit1 동일) — 리액션이 이미지 아래로
      bubble.style.flexDirection = 'column'
      bubble.style.alignItems = 'flex-start'

      // 6. 리액션 안의 .time 제거 (profit1 동일)
      var _rxEl2 = rxResult.reactionsEl
      if (_rxEl2) {
        var _rxTime2 = _rxEl2.querySelector('.time')
        if (_rxTime2) _rxTime2.remove()
      }
    } else {
      // ── 이미지+텍스트 ──
      console.log('[Teledit] 이미지+텍스트 경로 진입, url:', pos._customImageUrl.substring(0, 60))
      if (_msgDiv3) {
        // .message 유지, 리액션도 .message 안에 유지
      }

      var _att2b = bubble.querySelector('.attachment')
      if (!_att2b) {
        _att2b = document.createElement('div')
        _att2b.className = 'attachment media-container'
        if (_bcEl2) _bcEl2.insertBefore(_att2b, _bcEl2.firstChild)
      }
      while (_att2b.firstChild) _att2b.removeChild(_att2b.firstChild)

      // placeholder
      var _ph2b = document.createElement('img')
      _ph2b.className = 'media-photo'
      _ph2b.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect fill="#0d1117" width="320" height="320"/></svg>')
      _ph2b.style.cssText = 'max-width:100%;display:block;'
      _att2b.appendChild(_ph2b)
      _att2b.style.cssText = 'max-width:100%;position:relative;overflow:hidden;'

      ;(function(_img, _attEl, _url) {
        fetchCustomImage(_url).then(function(imgUrl) {
          if (imgUrl && _img.parentElement) {
            _img.onload = function() {
              var nw = _img.naturalWidth, nh = _img.naturalHeight
              var ratio = nh / nw
              var MAX_H = 400

              if (ratio > 1) {
                // ── 세로 긴 이미지: Telegram 스타일 ──
                // 이미지를 MAX_H에 contain → 실제 이미지 너비 계산
                // 컨테이너 = 이미지 / 0.9 (양쪽 5% 블러 여백)
                var imgContainW = Math.round(MAX_H * (nw / nh))
                var containerW = Math.min(420, Math.round(imgContainW / 0.9))
                var containerH = MAX_H

                _attEl.style.cssText = 'width:' + containerW + 'px;height:' + containerH + 'px;position:relative;overflow:hidden;border-radius:6px;'

                // 1) 블러 배경
                var bgImg = document.createElement('img')
                bgImg.src = imgUrl
                bgImg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;filter:blur(20px) brightness(0.6);z-index:0;'
                _attEl.insertBefore(bgImg, _img)

                // 2) 실제 이미지 (contain 중앙)
                _img.style.cssText = 'position:relative;z-index:1;width:100%;height:100%;object-fit:contain;display:block;'
              } else {
                // ── 가로 긴 또는 정사각형 ──
                var fw = Math.min(420, nw)
                var fh = Math.round(fw * ratio)
                _attEl.style.cssText = 'width:' + fw + 'px;height:' + fh + 'px;position:relative;overflow:hidden;max-width:100%;'
                _img.style.cssText = 'width:100%;height:auto;display:block;'
              }
            }
            _img.src = imgUrl
          }
        })
      })(_ph2b, _att2b, pos._customImageUrl)

      bubble.classList.add('photo')
      bubble.classList.remove('has-webpage', 'video', 'just-media')
      if (_bcEl2) _bcEl2.style.maxWidth = 'min(100%, 420px)'
    }
  } else {
    bubble.querySelector('.attachment')?.remove()
    bubble.classList.remove('has-webpage', 'single-media', 'photo', 'video', 'just-media')
  }

  // 버블 테일
  if (!isGroupLast) {
    bubble.classList.remove('can-have-tail')
    bubble.querySelector('.bubble-tail')?.remove()
  }

  // ── 그룹/삽입 (bubble-groups.js) ──
  var group = document.createElement('div')
  group.className = 'bubbles-group teledit-injected-group'
  var insertResult = _insertBubbleIntoDOM(bubble, group, entryTs, pos, posId, isGroupFirst, isGroupLast, text)
  if (!insertResult) { if (pos && pos._fromScroll) console.log('[Teledit] FAIL DOM삽입:', _dbgId, 'ts:', entryTs); return false }

  if (pos) injectedBubbles.set(fakeMid, { text: text, pos: pos })

  // 시간/뷰 업데이트
  var _expectedView = String(rxResult.viewCount)
  bubble.querySelectorAll('.post-views').forEach(function(el) {
    el.textContent = _expectedView
    var _vg = false
    var _vo = new MutationObserver(function() {
      if (_vg) return
      if (el.textContent !== _expectedView) { _vg = true; el.textContent = _expectedView; _vg = false }
    })
    _vo.observe(el, { childList: true, characterData: true, subtree: true })
  })
  bubble.querySelectorAll('.time .i18n').forEach(function(el) { el.textContent = timeStr })
  bubble.querySelectorAll('.time-inner').forEach(function(el) { el.title = titleStr })

  // 이미지 전용 메시지: 시간/뷰수 직접 설정 + reactions를 bubble-content-wrapper 밖으로 이동
  var _isImageOnlyMsg = _isProfit1 || (pos && pos._messageType === 'customImage' && pos._customImageUrl && !(text && text.trim().length > 0))
  if (_isImageOnlyMsg) {
    var _ov = bubble.querySelector('.teledit-time-overlay')
    if (_ov) {
      var _ovViews = _ov.querySelector('.post-views')
      var _ovTime = _ov.querySelector('.i18n')
      if (_ovViews) _ovViews.textContent = String(rxResult.viewCount)
      if (_ovTime) _ovTime.textContent = timeStr
    }

    // reactions를 bubble-content-wrapper 뒤에 (Telegram 구조 기반)
    if (rxResult.reactionsEl) {
      rxResult.reactionsEl.remove()
      var _bcw = bubble.querySelector('.bubble-content-wrapper')
      if (_bcw && _bcw.nextSibling) bubble.insertBefore(rxResult.reactionsEl, _bcw.nextSibling)
      else bubble.appendChild(rxResult.reactionsEl)
    }
  }

  // 클릭 인터셉터
  if (rxResult.reactionsEl) _attachReactionInterceptor(rxResult.reactionsEl, rxResult.reactionData, posId)

  // ── 댓글 영역 (bubble-replies.js) ──
  _buildRepliesFooter(bubble, pos, posId, _iconBackup)

  return true
}

// ── 스크롤 복귀 후 재주입 ─────────────────────────────────────────────────────
function reinjectBubbles() {
  if (!isChannelView()) return
  document.querySelectorAll('.teledit-date-sep').forEach(function(sep) {
    if (!sep.nextElementSibling?.classList.contains('teledit-injected-group')) sep.remove()
  })
  var sorted = [...injectedBubbles.entries()]
    .sort(function(a, b) {
      var tsA = a[1].pos?.entryTime ? new Date(a[1].pos.entryTime).getTime() : 0
      var tsB = b[1].pos?.entryTime ? new Date(b[1].pos.entryTime).getTime() : 0
      return tsA - tsB
    })
  for (var k = 0; k < sorted.length; k++) {
    var fakeMid = sorted[k][0]
    if (!document.querySelector('[data-mid="' + fakeMid + '"]')) {
      insertBubble(sorted[k][1].text, sorted[k][1].pos)
    }
  }
  if (pendingBubbles.size) {
    var pendingSorted = [...pendingBubbles.values()]
      .sort(function(a, b) { return new Date(a.pos.entryTime) - new Date(b.pos.entryTime) })
    for (var i = 0; i < pendingSorted.length; i++) {
      if (insertBubble(pendingSorted[i].text, pendingSorted[i].pos)) {
        pendingBubbles.delete(String(pendingSorted[i].pos.id))
      }
    }
  }
}
// ── content.js — 수동 삽입 + 스크롤 자동 삽입 ─────────────────────────────────

function _dbg(msg) {
  console.log('[Teledit] ' + msg)
}

function injectPageScript() {
  if (window.__teleditPageScriptInjected) return
  window.__teleditPageScriptInjected = true
  try {
    var script = document.createElement('script')
    script.src = chrome.runtime.getURL('page-script.js')
    script.onload = function() { script.remove() }
    script.onerror = function() { script.remove() }
    ;(document.head || document.documentElement).appendChild(script)
  } catch (e) {}
}

function injectStyles() {
  if (document.getElementById('teledit-styles')) return
  var style = document.createElement('style')
  style.id = 'teledit-styles'
  style.textContent = [
    '@keyframes teledit-sticker-pop{0%{transform:scale(1)}25%{transform:scale(1.55) rotate(-8deg)}60%{transform:scale(0.85) rotate(4deg)}85%{transform:scale(1.1)}100%{transform:scale(1)}}',
    '@keyframes teledit-float-up{0%{opacity:1;transform:translateY(0) scale(1)}60%{opacity:.8;transform:translateY(-32px) scale(1.3)}100%{opacity:0;transform:translateY(-56px) scale(2)}}',
    '.teledit-injected .replies-short{display:none!important}',
    // 댓글 있는 Teledit 버블: 말풍선 아이콘 숨김 (아바타로 대체)
    '.teledit-injected:not(.teledit-no-comments) .replies-footer .replies-footer-icon{display:none!important}',
    // 댓글 없는 Teledit 버블: Telegram 네이티브 아이콘 강제 표시
    '.teledit-no-comments .replies-footer .replies-footer-icon{display:inline-flex!important}',
    // 날짜 구분선
    '.teledit-date-sep{text-align:center;margin:5px auto 5px!important;padding:0}',
    '.teledit-date-sep .teledit-date-label{display:inline-flex;background:var(--message-highlighting-color, rgba(0,0,0,0.35))!important;padding:4.5px 10px;border-radius:14px;color:#fff;font-size:15px;font-weight:500;line-height:20px}',
  ].join('')
  document.head.appendChild(style)
}

// ── 댓글 작성자 캐시 ─────────────────────────────────────────────────────────

async function fetchCommentAuthors(posId) {
  if (_commentAuthorsCache.has(posId)) return _commentAuthorsCache.get(posId)
  try {
    var settings = await loadSettings()
    if (!settings.token) return null
    var res = await safeFetch(
      SERVER_URL + '/api/positions/' + posId + '/comments',
      { Authorization: 'Bearer ' + settings.token },
    )
    if (!res.ok || !res.data || !res.data.comments) return null
    var byType = {}
    res.data.comments.forEach(function(c) {
      if (!byType[c.messageType]) byType[c.messageType] = []
      byType[c.messageType].push(c.authorName)
    })
    _commentAuthorsCache.set(posId, byType)
    return byType
  } catch (e) { return null }
}

// ── 커스텀 메시지 API fetch ──────────────────────────────────────────────────
async function fetchCustomMessages(serverUrl, token) {
  try {
    var res = await safeFetch(
      serverUrl.replace(/\/$/, '') + '/api/teledit-messages',
      token ? { Authorization: 'Bearer ' + token } : {},
    )
    console.log('[Teledit] 커스텀 메시지 API 응답:', 'ok=' + res.ok, 'status=' + res.status, 'isArray=' + Array.isArray(res.data), 'length=' + (Array.isArray(res.data) ? res.data.length : 'N/A'))
    if (!res.ok) return []
    var data = res.data
    var filtered = Array.isArray(data) ? data.filter(function(m) { return m.visible }) : []
    console.log('[Teledit] visible 필터 후:', filtered.length + '개')
    return filtered
  } catch (e) {
    console.error('[Teledit] fetchCustomMessages 실패:', e)
    return []
  }
}

// ── 커스텀 메시지 1개 삽입 ───────────────────────────────────────────────────
function insertCustomMessage(msg) {
  console.log('[Teledit] insertCustomMessage:', 'id=' + msg.id, 'content=' + JSON.stringify(msg.content).substring(0, 80), 'imageUrl=' + (msg.imageUrl ? 'yes' : 'no'), 'sendTime=' + msg.sendTime)
  var cmCommentCount = 0
  if (msg.commentMin >= 0 && msg.commentMax >= 0) {
    cmCommentCount = msg.commentMin + Math.floor(Math.random() * (msg.commentMax - msg.commentMin + 1))
  }
  var virtualPos = {
    id: 'cm-' + msg.id,
    entryTime: msg.sendTime,
    symbol: '',
    side: '',
    leverage: 0,
    status: 'CUSTOM',
    _messageType: msg.imageUrl ? 'customImage' : 'custom',
    _parentPosId: null,
    _commentAuthors: null,
    _commentCount: cmCommentCount,
    _customImageUrl: msg.imageUrl || null,
    _reactionHeartMin: msg.heartMin ?? 20,
    _reactionHeartMax: msg.heartMax ?? 30,
    _reactionThumbMin: msg.thumbMin ?? 20,
    _reactionThumbMax: msg.thumbMax ?? 30,
    _reactionFireMin: msg.fireMin ?? 20,
    _reactionFireMax: msg.fireMax ?? 30,
    _wideRange: true,
  }
  return insertBubble(msg.content, virtualPos) ? 1 : 0
}

// ── 포지션 1개 → 상황별 채널 포스트 삽입 ─────────────────────────────────────
function insertPositionMessages(pos, commentAuthors) {
  var posId = String(pos.id)
  var messages = buildPositionMessages(pos)

  if (!messages || messages.length === 0) {
    return insertBubble(buildAutoMessage(pos), pos) ? 1 : 0
  }

  var inserted = 0
  var _authorTypeMap = {
    postEntry1: 'postEntry', postEntry2: 'postEntry', postEntry3: 'postEntry',
    postClose1: 'close', postClose2: 'close', postClose3: 'close',
  }

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i]
    var _lookupType = _authorTypeMap[msg.type] || msg.type
    var authors = commentAuthors && commentAuthors[_lookupType] ? commentAuthors[_lookupType] : null
    var virtualPos = {
      id: msg.id,
      entryTime: msg.entryTime,
      symbol: pos.symbol,
      side: pos.side,
      leverage: pos.leverage,
      status: pos.status,
      entryPrice: pos.entryPrice,
      closedPrice: pos.closedPrice,
      closedAt: pos.closedAt,
      pnl: pos.pnl,
      amount: pos.amount,
      quantity: pos.quantity,
      entryFee: pos.entryFee,
      inputPrice: pos.inputPrice,
      closeReason: pos.closeReason,
      _messageType: msg.imageUrl ? 'customImage' : msg.type,
      _parentPosId: posId,
      _commentAuthors: authors,
      _commentCount: msg.commentCount != null ? msg.commentCount : null,
      _customImageUrl: msg.imageUrl || null,
      _reactionData: pos.reactionData ? (typeof pos.reactionData === 'string' ? JSON.parse(pos.reactionData) : pos.reactionData) : null,
      _wideRange: true,
    }
    if (insertBubble(msg.text, virtualPos)) inserted++
  }
  return inserted
}

// ── 채널 변경 감지 + 상태 초기화 ─────────────────────────────────────────────

var _currentPeer = ''

function _getCurrentPeer() {
  // Telegram Web K: hash = #-1234567890 또는 #@username 또는 #-1234567890?t=12345 등
  // 채널 ID만 추출하여 날짜 점프/메시지 이동 시 상태가 초기화되지 않도록 함
  var hash = window.location.hash || ''
  // 숫자(-포함) 또는 @username 부분만 추출, 나머지(쿼리/앵커) 무시
  var m = hash.match(/^#(-?\d+)/) || hash.match(/^#(@[a-zA-Z0-9_]+)/)
  return (m ? m[0] : hash).split('?')[0]
}

function _clearChannelState() {
  injectedBubbles.clear()
  pendingBubbles.clear()
  bubbleDataCache.clear()
  _replyDataCache.clear()
  _commentAuthorsCache.clear()
  if (_scrollObserver) {
    _scrollObserver.disconnect()
    _scrollObserver = null
  }
  if (_subsInterval) {
    clearInterval(_subsInterval)
    _subsInterval = null
  }
  if (_subsObserver) {
    _subsObserver.disconnect()
    _subsObserver = null
  }
  _currentPeer = _getCurrentPeer()
  console.log('[Teledit] 채널 변경 감지 → 상태 초기화')
}

// ── 스크롤 감지 → 재삽입 ────────────────────────────────────────────────────
// Bug 7 fix: reinjectBubbles() 직접 호출 (인라인 중복 제거)
// Bug 8 fix: atBot 가드 제거 → 모든 방향에서 재삽입
// Bug 3 fix: pending 최대 3회 재시도 후 폐기
// Bug 9 fix: 스크롤 보정 조건 수정

// ── 잘못된 위치의 teledit 버블 감지 & 제거 ───────────────────────────────
// DOM 순회하며 timestamp가 역순인 teledit 버블을 찾아 제거
// (다음 스크롤/reinject 시 _insertedPositions 캐시로부터 올바른 위치에 재삽입)
// 한 pass로 모든 버블을 못 잡을 수 있으므로 변화 없을 때까지 반복
function _validateBubblePositions() {
  var totalRemoved = 0
  var _MAX_PASSES = 10
  for (var pass = 0; pass < _MAX_PASSES; pass++) {
    var all = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]'))
    if (all.length < 2) break
    var toRemove = []

    for (var i = 0; i < all.length; i++) {
      var cur = all[i]
      if (!cur.classList.contains('teledit-injected')) continue
      var curTs = parseInt(cur.dataset.timestamp, 10)
      if (isNaN(curTs)) continue
      var curGrp = cur.closest('.bubbles-group')
      var misplaced = false

      // 이전 DOM 이웃: 같은 그룹 아니면 비교
      if (i > 0 && all[i - 1].closest('.bubbles-group') !== curGrp) {
        var prevTs = parseInt(all[i - 1].dataset.timestamp, 10)
        if (!isNaN(prevTs) && prevTs > curTs) misplaced = true
      }

      // 다음 DOM 이웃: 같은 그룹 아니면 비교
      if (!misplaced && i < all.length - 1 && all[i + 1].closest('.bubbles-group') !== curGrp) {
        var nextTs = parseInt(all[i + 1].dataset.timestamp, 10)
        if (!isNaN(nextTs) && nextTs < curTs) misplaced = true
      }

      if (misplaced) toRemove.push(cur)
    }

    if (toRemove.length === 0) break  // 더 이상 잘못된 버블 없음 → 종료

    for (var r = 0; r < toRemove.length; r++) {
      var el = toRemove[r]
      var mid = el.getAttribute('data-mid')
      var grp = el.closest('.bubbles-group.teledit-injected-group')
      if (grp) grp.remove(); else el.remove()
      if (mid) injectedBubbles.delete(mid)
      totalRemoved++
    }
  }

  if (totalRemoved > 0) console.log('[Teledit] 잘못된 위치 ' + totalRemoved + '개 제거 (재삽입 대기)')
  return totalRemoved
}

function startScrollObserver() {
  if (_scrollObserver) return

  var _tryAttach = function() {
    var scrollEl = document.querySelector('.bubbles .scrollable-y')
    if (!scrollEl) return false

    var _onScroll = function() {
      clearTimeout(_scrollDebounce)
      _scrollDebounce = setTimeout(function() {
        if (!isChannelView()) return

        var peer = _getCurrentPeer()
        if (peer !== _currentPeer) {
          // 채널 변경: 상태만 초기화 (스크롤 옵저버는 유지)
          injectedBubbles.clear()
          pendingBubbles.clear()
          bubbleDataCache.clear()
          _replyDataCache.clear()
          _commentAuthorsCache.clear()
          _currentPeer = peer
          return
        }

        // 현재 보이는 실제 포스트의 시간 범위 계산
        var _visibleReal = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)'))
        if (!_visibleReal.length) return
        _visibleReal.sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })
        var _SCROLL_MARGIN = 7200  // ±2시간 여유
        var _rawMin = parseInt(_visibleReal[0].dataset.timestamp, 10)
        var _rawMax = parseInt(_visibleReal[_visibleReal.length - 1].dataset.timestamp, 10)
        var _minTs = _rawMin - _SCROLL_MARGIN
        var _maxTs = _rawMax + _SCROLL_MARGIN

        // 고아 날짜구분선 정리
        document.querySelectorAll('.teledit-date-sep').forEach(function(sep) {
          if (!sep.nextElementSibling?.classList.contains('teledit-injected-group')) sep.remove()
        })

        var _st = scrollEl.scrollTop
        var _sh = scrollEl.scrollHeight
        var _insertedCount = 0

        // 핵심: _insertedPositions 캐시에서 현재 범위에 해당하는 메시지를 직접 생성하여 삽입
        if (_insertedPositions && _insertedPositions.length) {
          for (var pi = 0; pi < _insertedPositions.length; pi++) {
            var _p = _insertedPositions[pi]
            var msgs = buildPositionMessages(_p.pos)
            if (!msgs) continue
            for (var mi = 0; mi < msgs.length; mi++) {
              var msg = msgs[mi]
              var msgTs = Math.floor(new Date(msg.entryTime).getTime() / 1000)
              if (msgTs < _minTs || msgTs > _maxTs) continue
              var _fmid = 'teledit-' + msg.id
              if (document.querySelector('[data-mid="' + _fmid + '"]')) continue
              var vp = {
                id: msg.id, entryTime: msg.entryTime, symbol: _p.pos.symbol, side: _p.pos.side,
                leverage: _p.pos.leverage, status: _p.pos.status, entryPrice: _p.pos.entryPrice,
                closedPrice: _p.pos.closedPrice, closedAt: _p.pos.closedAt, pnl: _p.pos.pnl,
                amount: _p.pos.amount, quantity: _p.pos.quantity, entryFee: _p.pos.entryFee,
                inputPrice: _p.pos.inputPrice, closeReason: _p.pos.closeReason,
                _messageType: msg.imageUrl ? 'customImage' : msg.type, _parentPosId: String(_p.pos.id),
                _commentAuthors: _p.authors ? _p.authors[msg.type] || null : null,
                _commentCount: msg.commentCount != null ? msg.commentCount : null,
                _customImageUrl: msg.imageUrl || null,
                _reactionData: _p.pos.reactionData ? (typeof _p.pos.reactionData === 'string' ? JSON.parse(_p.pos.reactionData) : _p.pos.reactionData) : null,
                _fromScroll: true,
              }
              if (insertBubble(msg.text, vp)) _insertedCount++
            }
          }
        }

        // 커스텀 메시지도 동일하게 범위 내에서 재삽입
        if (_insertedCustomMessages && _insertedCustomMessages.length) {
          for (var ci = 0; ci < _insertedCustomMessages.length; ci++) {
            var _cm = _insertedCustomMessages[ci]
            if (!_cm || _cm.visible === false) continue
            var _cmTs = Math.floor(new Date(_cm.sendTime).getTime() / 1000)
            if (_cmTs < _minTs || _cmTs > _maxTs) continue
            var _cfmid = 'teledit-cm-' + _cm.id
            if (document.querySelector('[data-mid="' + _cfmid + '"]')) continue
            var _cmCount = 0
            if (_cm.commentMin >= 0 && _cm.commentMax >= 0) {
              _cmCount = _cm.commentMin + Math.floor(Math.random() * (_cm.commentMax - _cm.commentMin + 1))
            }
            var cvp = {
              id: 'cm-' + _cm.id,
              entryTime: _cm.sendTime,
              symbol: '',
              side: '',
              leverage: 0,
              status: 'CUSTOM',
              _messageType: _cm.imageUrl ? 'customImage' : 'custom',
              _parentPosId: null,
              _commentAuthors: null,
              _commentCount: _cmCount,
              _customImageUrl: _cm.imageUrl || null,
              _reactionHeartMin: _cm.heartMin != null ? _cm.heartMin : 20,
              _reactionHeartMax: _cm.heartMax != null ? _cm.heartMax : 30,
              _reactionThumbMin: _cm.thumbMin != null ? _cm.thumbMin : 20,
              _reactionThumbMax: _cm.thumbMax != null ? _cm.thumbMax : 30,
              _reactionFireMin: _cm.fireMin != null ? _cm.fireMin : 20,
              _reactionFireMax: _cm.fireMax != null ? _cm.fireMax : 30,
              _wideRange: true,
              _fromScroll: true,
            }
            if (insertBubble(_cm.content, cvp)) _insertedCount++
          }
        }

        // 잘못된 위치의 teledit 버블 검증 & 제거 (다음 스크롤에서 재삽입됨)
        _validateBubblePositions()

        if (_insertedCount > 0) {
          var _diff = scrollEl.scrollHeight - _sh
          if (_diff > 0) scrollEl.scrollTop = _st + _diff
        }

        _applyChannelHeader()
      }, 300)
    }

    scrollEl.addEventListener('scroll', _onScroll, { passive: true })
    _scrollObserver = {
      disconnect: function() { scrollEl.removeEventListener('scroll', _onScroll) },
    }
    console.log('[Teledit] 스크롤 감지 시작 (pending: ' + pendingBubbles.size + ')')
    return true
  }

  if (!_tryAttach()) {
    _currentPeer = _getCurrentPeer()
    var _attempts = 0
    var _findInterval = setInterval(function() {
      if (_tryAttach() || ++_attempts > 20) clearInterval(_findInterval)
    }, 200)
  } else {
    _currentPeer = _getCurrentPeer()
  }
}

// ── 팝업 메시지 수신 ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
  if (msg.action === 'getStatus') {
    sendResponse({ initialized: !!window.__teleditLoaded, isChannelView: isChannelView() })
    return true
  }

  if (msg.action === 'insertPositions') {
    (async function() {
      try {
        if (!isChannelView()) {
          sendResponse({ error: '채널 뷰가 아닙니다' })
          return
        }

        var ids = new Set(msg.positionIds || [])
        if (ids.size === 0) {
          sendResponse({ error: '선택된 포지션 없음' })
          return
        }

        var settings = await loadSettings()
        if (!settings.token) {
          sendResponse({ error: '로그인 필요' })
          return
        }

        await fetchUserSettings()

        var peer = _getCurrentPeer()
        if (peer !== _currentPeer && _currentPeer !== '') {
          _clearChannelState()
        }
        _currentPeer = peer

        // Bug 11 fix: 팝업 삽입 시 캐시 강제 초기화 (새 포지션 즉시 반영)
        _posCache = null
        _posCacheTime = 0

        var fetched = await fetchPositions(SERVER_URL, settings.token)
        if (!fetched || !fetched.length) {
          sendResponse({ error: '포지션 로드 실패' })
          return
        }

        var toInsert = fetched
          .filter(function(p) { return ids.has(String(p.id)) })
          .sort(function(a, b) { return new Date(a.entryTime) - new Date(b.entryTime) })

        // 댓글 작성자 프리페치
        var commentAuthorsByPos = {}
        await Promise.all(toInsert.map(async function(p) {
          commentAuthorsByPos[p.id] = await fetchCommentAuthors(String(p.id))
        }))

        // 스크롤 위치 보존 (삽입으로 인한 점프 방지)
        var scrollEl = document.querySelector('.bubbles .scrollable-y')
        var _st = scrollEl ? scrollEl.scrollTop : 0
        var _sh = scrollEl ? scrollEl.scrollHeight : 0

        // 포지션 캐시 저장 (스크롤 reinject용)
        _insertedPositions = toInsert.map(function(p) {
          return { pos: p, authors: commentAuthorsByPos[p.id] || null }
        })

        var totalInserted = 0
        for (var i = 0; i < toInsert.length; i++) {
          var posAuthors = commentAuthorsByPos[toInsert[i].id] || null
          totalInserted += insertPositionMessages(toInsert[i], posAuthors)
        }

        if (scrollEl) {
          var _diff = scrollEl.scrollHeight - _sh
          if (_diff > 0) scrollEl.scrollTop = _st + _diff
        }

        _applyChannelHeader()
        _validateBubblePositions()
        startScrollObserver()

        sendResponse({
          inserted: totalInserted,
          pending: pendingBubbles.size,
        })
      } catch (e) {
        sendResponse({ error: e.message || '삽입 실패' })
      }
    })()
    return true
  }
  if (msg.action === 'insertCustomMessages') {
    (async function() {
      try {
        if (!isChannelView()) {
          sendResponse({ error: '채널 뷰가 아닙니다' })
          return
        }

        var ids = new Set(msg.messageIds || [])
        if (ids.size === 0) {
          sendResponse({ error: '선택된 메시지 없음' })
          return
        }

        var settings = await loadSettings()
        if (!settings.token) {
          sendResponse({ error: '로그인 필요' })
          return
        }

        var peer = _getCurrentPeer()
        if (peer !== _currentPeer && _currentPeer !== '') {
          _clearChannelState()
        }
        _currentPeer = peer

        var cmList = await fetchCustomMessages(SERVER_URL, settings.token)
        if (!cmList || !cmList.length) {
          sendResponse({ error: '커스텀 메시지 없음' })
          return
        }

        var toInsert = cmList
          .filter(function(m) { return ids.has(String(m.id)) })
          .sort(function(a, b) { return new Date(a.sendTime) - new Date(b.sendTime) })

        var scrollEl = document.querySelector('.bubbles .scrollable-y')
        var _st = scrollEl ? scrollEl.scrollTop : 0
        var _sh = scrollEl ? scrollEl.scrollHeight : 0

        var totalInserted = 0
        for (var i = 0; i < toInsert.length; i++) {
          if (insertCustomMessage(toInsert[i])) totalInserted++
        }

        if (scrollEl) {
          var _diff = scrollEl.scrollHeight - _sh
          if (_diff > 0) scrollEl.scrollTop = _st + _diff
        }

        _applyChannelHeader()
        _validateBubblePositions()
        startScrollObserver()

        sendResponse({
          inserted: totalInserted,
          pending: pendingBubbles.size,
        })
      } catch (e) {
        sendResponse({ error: e.message || '삽입 실패' })
      }
    })()
    return true
  }
})

// ── Alt+E 단축키 → 전체 포지션 삽입 ─────────────────────────────────────────
// ── Alt+D 단축키 → 전체 커스텀 메시지 삽입 ──────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault()
    _insertAll()
  }
})

async function _insertAll() {
  // 모든 캐시 초기화 → 항상 최신 데이터로 재생성 (첫 Alt+E에도 정확한 결과)
  injectedBubbles.clear()
  pendingBubbles.clear()
  _tsCache.clear()
  _posCache = null
  _posCacheTime = 0
  _settingsFetched = false
  _userSettings = null

  // DOM에 남은 기존 텔레딧 버블 제거
  document.querySelectorAll('.teledit-injected').forEach(function(el) { el.closest('.bubbles-group.teledit-injected-group')?.remove() || el.remove() })
  document.querySelectorAll('.teledit-injected-group').forEach(function(el) { el.remove() })
  document.querySelectorAll('.teledit-date-group').forEach(function(el) { el.remove() })
  document.querySelectorAll('.teledit-date-sep').forEach(function(el) { el.remove() })

  // 유저 설정을 먼저 강제 로드 (실패 시 진행 중단)
  var userSettings = await fetchUserSettings()
  if (!userSettings) {
    console.warn('[Teledit] 유저 설정 로드 실패 → 삽입 취소')
    return
  }
  // 디버그: 로드된 템플릿 확인
  console.log('[Teledit] _insertAll 시작. 템플릿 예시:',
    '\n  preEntry:', (userSettings.templates?.preEntry || '(없음)').substring(0, 50),
    '\n  long:', (userSettings.templates?.long || '(없음)').substring(0, 50),
    '\n  close:', (userSettings.templates?.close || '(없음)').substring(0, 50))

  await _insertAllPositions()
  await _insertAllCustomMessages()
}

async function _insertAllPositions() {
  if (!isChannelView()) return

  var settings = await loadSettings()
  if (!settings.token) return

  var peer = _getCurrentPeer()
  if (peer !== _currentPeer && _currentPeer !== '') {
    _clearChannelState()
  }
  _currentPeer = peer

  var fetched = await fetchPositions(SERVER_URL, settings.token)
  if (!fetched || !fetched.length) return

  console.log('[Teledit] 포지션 ' + fetched.length + '개 로드. 날짜범위: ' +
    new Date(fetched[fetched.length-1].entryTime).toLocaleString() + ' ~ ' +
    new Date(fetched[0].entryTime).toLocaleString())

  var toInsert = fetched.sort(function(a, b) {
    return new Date(a.entryTime) - new Date(b.entryTime)
  })

  var commentAuthorsByPos = {}
  await Promise.all(toInsert.map(async function(p) {
    commentAuthorsByPos[p.id] = await fetchCommentAuthors(String(p.id))
  }))

  // 포지션 캐시 저장 (스크롤 reinject용)
  _insertedPositions = toInsert.map(function(p) {
    return { pos: p, authors: commentAuthorsByPos[p.id] || null }
  })

  var scrollEl = document.querySelector('.bubbles .scrollable-y')
  var _st = scrollEl ? scrollEl.scrollTop : 0
  var _sh = scrollEl ? scrollEl.scrollHeight : 0

  var totalInserted = 0
  for (var i = 0; i < toInsert.length; i++) {
    var posAuthors = commentAuthorsByPos[toInsert[i].id] || null
    totalInserted += insertPositionMessages(toInsert[i], posAuthors)
  }

  if (scrollEl) {
    var _diff = scrollEl.scrollHeight - _sh
    if (_diff > 0) scrollEl.scrollTop = _st + _diff
  }

  _applyChannelHeader()
  _validateBubblePositions()
  startScrollObserver()
  console.log('[Teledit] ' + totalInserted + '개 삽입 (pending: ' + pendingBubbles.size + ')')
}

async function _insertAllCustomMessages() {
  if (!isChannelView()) return

  var settings = await loadSettings()
  if (!settings.token) return

  var peer = _getCurrentPeer()
  if (peer !== _currentPeer && _currentPeer !== '') {
    _clearChannelState()
  }
  _currentPeer = peer

  var cmList = await fetchCustomMessages(SERVER_URL, settings.token)
  if (!cmList || !cmList.length) return

  var scrollEl = document.querySelector('.bubbles .scrollable-y')
  var _st = scrollEl ? scrollEl.scrollTop : 0
  var _sh = scrollEl ? scrollEl.scrollHeight : 0

  var totalInserted = 0
  cmList.sort(function(a, b) { return new Date(a.sendTime) - new Date(b.sendTime) })
  // 스크롤 reinject용 캐시 저장
  _insertedCustomMessages = cmList.slice()
  for (var i = 0; i < cmList.length; i++) {
    totalInserted += insertCustomMessage(cmList[i])
  }

  if (scrollEl) {
    var _diff = scrollEl.scrollHeight - _sh
    if (_diff > 0) scrollEl.scrollTop = _st + _diff
  }

  _applyChannelHeader()
  _validateBubblePositions()
  startScrollObserver()
  console.log('[Teledit] 커스텀 메시지 ' + totalInserted + '개 삽입 (pending: ' + pendingBubbles.size + ')')
}

// ── 채널 헤더 이름/아이콘 변경 ──────────────────────────────────────────────
function _applyChannelHeader() {
  if (!_userSettings) return

  if (_userSettings.channelName) {
    var displayName = _userSettings.channelName
    if (_userSettings.channelGeneration != null) {
      displayName += ' ' + _userSettings.channelGeneration + '기'
    }
    var titleEl = document.querySelector('.chat-info .peer-title')
      || document.querySelector('.top .peer-title')
      || document.querySelector('[class*="ChatInfo"] [class*="title"]')
    if (titleEl) titleEl.textContent = displayName
  }

  // 구독자수 — setInterval 폴링 + MutationObserver 이중 방어
  if (_userSettings.subscriberCount > 0) {
    var subsText = _userSettings.subscriberCount.toLocaleString('en-US').replace(/,/g, ' ') + ' subscribers'
    var _subsPattern = /\d[\d,\s\.]*\s*(subscribers?|members?|구독자|명)/i
    var _subsGuard = false

    function _applySubsCount() {
      if (_subsGuard) return
      _subsGuard = true
      var applied = false
      // 1차: 이미 subscriber/member 텍스트가 있는 span 교체
      var spans = document.querySelectorAll('span.i18n, .i18n, .chat-info span, .top span, [class*="subtitle"] span, [class*="info"] span, [class*="status"] span')
      for (var si = 0; si < spans.length; si++) {
        var el = spans[si]
        var t = (el.textContent || '').trim()
        if (_subsPattern.test(t)) {
          if (el.textContent !== subsText) el.textContent = subsText
          applied = true
        }
      }
      // 2차: 아직 없으면 subtitle 영역에 직접 삽입
      if (!applied) {
        var subtitleEl = document.querySelector('.chat-info .info .status')
          || document.querySelector('.top .info .status')
          || document.querySelector('[class*="ChatInfo"] [class*="subtitle"]')
          || document.querySelector('[class*="ChatInfo"] [class*="status"]')
        if (subtitleEl && subtitleEl.textContent !== subsText) {
          subtitleEl.textContent = subsText
        }
      }
      _subsGuard = false
    }

    _applySubsCount()

    // 기존 interval / observer 해제 후 재등록
    if (_subsInterval) { clearInterval(_subsInterval); _subsInterval = null }
    if (_subsObserver) { _subsObserver.disconnect(); _subsObserver = null }

    // 300ms마다 강제 보정 (Virtual DOM 재렌더 타이밍 무관하게 동작)
    _subsInterval = setInterval(_applySubsCount, 300)

    // MutationObserver는 즉각 반응용 보조
    _subsObserver = new MutationObserver(function(mutations) {
      for (var mi = 0; mi < mutations.length; mi++) {
        var m = mutations[mi]
        if (m.type === 'characterData') {
          var t2 = (m.target.textContent || '').trim()
          if (_subsPattern.test(t2) && m.target.textContent !== subsText) {
            m.target.textContent = subsText
          }
        } else if (m.type === 'childList') {
          _applySubsCount()
        }
      }
    })
    _subsObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
  } else {
    if (_subsInterval) { clearInterval(_subsInterval); _subsInterval = null }
    if (_subsObserver) { _subsObserver.disconnect(); _subsObserver = null }
  }

  if (_userSettings.channelAvatarUrl) {
    var avatarEl = document.querySelector('.chat-info .avatar')
      || document.querySelector('.top .avatar')
      || document.querySelector('[class*="ChatInfo"] .avatar')
    if (avatarEl) {
      var existingImg = avatarEl.querySelector('img')
      if (existingImg) {
        existingImg.src = _userSettings.channelAvatarUrl
      } else {
        avatarEl.textContent = ''
        avatarEl.style.background = 'transparent'
        var img = document.createElement('img')
        img.src = _userSettings.channelAvatarUrl
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;'
        avatarEl.appendChild(img)
      }
    }
  }
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function init() {
  if (window.__teleditLoaded) return
  window.__teleditLoaded = true
  try {
    injectPageScript()
    injectStyles()
    var settings = await loadSettings()
    if (settings.token) {
      await fetchUserSettings()
      fetchPositions(SERVER_URL, settings.token).catch(function() {})
    }
    console.log('[Teledit] 준비 완료')
  } catch (e) {
    console.error('[Teledit] init 실패:', e)
    window.__teleditLoaded = false
  }
}

chrome.storage.onChanged.addListener(function(changes) {
  if ('token' in changes) {
    window.__teleditLoaded = false
    init()
  }
})

init()
