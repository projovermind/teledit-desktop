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
    result.push({
      id: posId + '-' + slot.type,
      text: text,
      entryTime: new Date(ts).toISOString(),
      type: slot.type,
      _ts: ts,
      commentCount: (pos.positionCommentCount && countMap[slot.type] != null) ? (pos.positionCommentCount[countMap[slot.type]] || 0) : null,
    })
  }

  // 시간순 정렬 — 항상 오래된 것부터
  result.sort(function(a, b) { return a._ts - b._ts })

  return result
}
