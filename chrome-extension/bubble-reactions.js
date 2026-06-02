// ── 리액션 요소 구성 ────────────────────────────────────────────────────────

function _buildBubbleReactions(bubble, pos, posId, entryTs) {
  // 캐시 or 새 데이터
  var cached    = posId ? bubbleDataCache.get(posId) : null
  var viewCount = cached ? cached.viewCount : _getViewsBetween(entryTs)

  // 현재 페이지의 스티커 blob URL 맵
  var blobMap = _getReactionBlobMap()
  var reactionData = cached
    ? cached.reactions
    : REACTION_DOC_IDS.map(function(docId, i) {
        return {
          blobSrc:  blobMap[docId] || '',
          emoticon: REACTION_EMOTICONS[i],
          count:    _rand(20, 30),
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
    reactionData.forEach(function(r, idx) {
      var btn = _buildOneReaction(r.blobSrc, r.emoticon, r.count, r.chosen, posId, idx)
      if (idx === reactionData.length - 1) btn.classList.add('is-last')
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
