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
