// ── 댓글 영역 렌더링 ────────────────────────────────────────────────────────

function _buildRepliesFooter(bubble, pos, posId, iconBackup) {
  var repliesRe = bubble.querySelector('replies-element')
  if (!repliesRe) return

  // connectedCallback 데이터 로드 차단
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
      // 댓글 없을 때: 아이콘이 없으면 백업에서 복원
      if (!footerInner.querySelector('.replies-footer-icon') && iconBackup) {
        footerInner.insertBefore(iconBackup.cloneNode(true), footerInner.firstChild)
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
