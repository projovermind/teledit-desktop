// ── 채널 말풍선 DOM 주입 — 오케스트레이터 ────────────────────────────────────

function insertBubble(text, pos) {
  if (!isChannelView()) {
    console.log('[Teledit] 채널이 아닌 채팅 — 스킵')
    return false
  }

  var posId   = pos ? String(pos.id) : null
  var fakeMid = 'teledit-' + (posId || Date.now())
  if (document.querySelector('[data-mid="' + fakeMid + '"]')) return false

  // 진입 시간
  var entryTs = pos && pos.entryTime
    ? Math.floor(new Date(pos.entryTime).getTime() / 1000)
    : Math.floor(Date.now() / 1000)

  // 미래 시간 스킵
  var nowTs = Math.floor(Date.now() / 1000)
  if (entryTs > nowTs) return false

  var template = document.querySelector('.bubble.channel-post.with-replies:not(.teledit-injected)')
  if (!template) { console.warn('[Teledit] 템플릿 없음'); return false }
  var bubble = template.cloneNode(true)

  // connectedCallback 전에 아이콘 백업 (connectedCallback이 삭제할 수 있음)
  var _savedIcon = bubble.querySelector('.replies-footer-icon')
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

  // 메시지 텍스트 교체
  var msgSpan = bubble.querySelector('.translatable-message')
  if (msgSpan) {
    while (msgSpan.firstChild) msgSpan.removeChild(msgSpan.firstChild)
    // #해시태그를 파란색으로 렌더링
    var parts = text.split(/(#[^\s#]+)/g)
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
  }

  // ── 리액션 (bubble-reactions.js) ──
  var rxResult = _buildBubbleReactions(bubble, pos, posId, entryTs)

  // 불필요한 원본 요소 제거
  bubble.querySelector('.reply')?.remove()
  bubble.querySelector('.webpage')?.remove()

  // ── profit1 이미지 처리 ──
  // 단순화: .message 유지 (텍스트만 비움), .attachment를 .message 앞에 추가
  // reactions/time은 .message 안에 그대로 둠 (Telegram 기본 구조)
  var _isProfit1 = pos && pos._messageType === 'profit1'
  var _parentPosId = pos && pos._parentPosId ? pos._parentPosId : null
  if (_isProfit1 && _parentPosId) {
    var _bcEl = bubble.querySelector('.bubble-content')

    // 1. .message에서 .time 미리 추출 (복사), 그 다음 .message 제거
    var _msgDiv = bubble.querySelector('.message')
    var _clonedTime = _msgDiv ? _msgDiv.querySelector('.time')?.cloneNode(true) : null
    if (_msgDiv) _msgDiv.remove()

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
    _placeholder.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="362" height="500"><rect fill="#0d1117" width="362" height="500"/></svg>')
    _placeholder.style.cssText = 'width:362px;height:500px;display:block;'
    _attachment.appendChild(_placeholder)
    _attachment.style.cssText = 'width:362px;position:relative;overflow:hidden;'

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
          _placeholder.style.cssText = 'width:100%;height:auto;display:block;'
          var h = _placeholder.naturalHeight * (_attachment.offsetWidth / _placeholder.naturalWidth)
          _attachment.style.setProperty('max-height', 'none', 'important')
          _attachment.style.setProperty('height', Math.round(h) + 'px', 'important')
        }
        _placeholder.src = imgUrl
      }
    })
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
  if (!insertResult) return false

  if (pos) injectedBubbles.set(fakeMid, { text: text, pos: pos })

  // 시간/뷰 업데이트
  bubble.querySelectorAll('.post-views').forEach(function(el) { el.textContent = String(rxResult.viewCount) })
  bubble.querySelectorAll('.time .i18n').forEach(function(el) { el.textContent = timeStr })
  bubble.querySelectorAll('.time-inner').forEach(function(el) { el.title = titleStr })

  // profit1: 시간/뷰수 직접 설정 + reactions 이동
  if (_isProfit1) {
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
