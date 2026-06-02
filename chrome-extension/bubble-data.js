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
