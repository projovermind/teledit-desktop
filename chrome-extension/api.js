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
