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
    '.teledit-injected:not(.teledit-no-comments) replies-element .replies-footer-icon{display:none!important}',
    // 댓글 없는 Teledit 버블: Telegram 네이티브 아이콘 강제 표시
    '.teledit-no-comments replies-element .replies-footer-icon{display:inline-flex!important}',
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
      _messageType: msg.type,
      _parentPosId: posId,
      _commentAuthors: authors,
      _commentCount: msg.commentCount != null ? msg.commentCount : null,
    }
    if (insertBubble(msg.text, virtualPos)) inserted++
  }
  return inserted
}

// ── 채널 변경 감지 + 상태 초기화 ─────────────────────────────────────────────

var _currentPeer = ''

function _getCurrentPeer() {
  return window.location.hash + '|' + window.location.pathname
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
  _currentPeer = _getCurrentPeer()
  console.log('[Teledit] 채널 변경 감지 → 상태 초기화')
}

// ── 스크롤 감지 → 재삽입 ────────────────────────────────────────────────────
// Bug 7 fix: reinjectBubbles() 직접 호출 (인라인 중복 제거)
// Bug 8 fix: atBot 가드 제거 → 모든 방향에서 재삽입
// Bug 3 fix: pending 최대 3회 재시도 후 폐기
// Bug 9 fix: 스크롤 보정 조건 수정

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
          _clearChannelState()
          return
        }

        // 스크롤 위치 보존
        var _savedScrollTop = scrollEl.scrollTop
        var _savedScrollHeight = scrollEl.scrollHeight

        // reinjectBubbles() 호출 (고아 날짜구분선 정리 포함)
        reinjectBubbles()

        // Bug 3 fix: pending 재시도 (최대 3회)
        var sorted = [].slice.call(pendingBubbles.entries())
          .sort(function(a, b) { return new Date(a[1].pos.entryTime) - new Date(b[1].pos.entryTime) })
        for (var i = 0; i < sorted.length; i++) {
          var key = sorted[i][0]
          var entry = sorted[i][1]
          if (insertBubble(entry.text, entry.pos)) {
            pendingBubbles.delete(key)
          } else {
            // 재시도 횟수 증가
            entry.retryCount = (entry.retryCount || 0) + 1
            if (entry.retryCount >= 3) {
              pendingBubbles.delete(key)  // 3회 실패 → 폐기
            }
          }
        }

        // Bug 9 fix: 스크롤 위치 보정 (조건 단순화)
        var _heightDiff = scrollEl.scrollHeight - _savedScrollHeight
        if (_heightDiff > 0) {
          scrollEl.scrollTop = _savedScrollTop + _heightDiff
        }

        // 채널 헤더 재적용
        _applyChannelHeader()
      }, 500)  // Bug 8: 500ms debounce (성능 보호)
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

        var totalInserted = 0
        for (var i = 0; i < toInsert.length; i++) {
          var posAuthors = commentAuthorsByPos[toInsert[i].id] || null
          totalInserted += insertPositionMessages(toInsert[i], posAuthors)
        }

        // 삽입으로 높이가 늘었으면 스크롤 보정
        if (scrollEl) {
          var _diff = scrollEl.scrollHeight - _sh
          if (_diff > 0) scrollEl.scrollTop = _st + _diff
        }

        _applyChannelHeader()
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
document.addEventListener('keydown', function(e) {
  if (e.altKey && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault()
    _insertAllPositions()
  }
})

async function _insertAllPositions() {
  if (!isChannelView()) return

  var settings = await loadSettings()
  if (!settings.token) return

  await fetchUserSettings()

  var peer = _getCurrentPeer()
  if (peer !== _currentPeer && _currentPeer !== '') {
    _clearChannelState()
  }
  _currentPeer = peer

  var fetched = await fetchPositions(SERVER_URL, settings.token)
  if (!fetched || !fetched.length) return

  var toInsert = fetched.sort(function(a, b) {
    return new Date(a.entryTime) - new Date(b.entryTime)
  })

  var commentAuthorsByPos = {}
  await Promise.all(toInsert.map(async function(p) {
    commentAuthorsByPos[p.id] = await fetchCommentAuthors(String(p.id))
  }))

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
  startScrollObserver()
  console.log('[Teledit] ' + totalInserted + '개 삽입 (pending: ' + pendingBubbles.size + ')')
}

// ── 채널 헤더 이름/아이콘 변경 ──────────────────────────────────────────────
function _applyChannelHeader() {
  if (!_userSettings) return

  if (_userSettings.channelName) {
    var titleEl = document.querySelector('.chat-info .peer-title')
      || document.querySelector('.top .peer-title')
      || document.querySelector('[class*="ChatInfo"] [class*="title"]')
    if (titleEl) titleEl.textContent = _userSettings.channelName
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
