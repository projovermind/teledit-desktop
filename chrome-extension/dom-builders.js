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
