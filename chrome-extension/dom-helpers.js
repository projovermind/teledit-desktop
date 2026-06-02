// ── Telegram DOM 쿼리 및 구조 생성 ───────────────────────────────────────────

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

// ── 뷰 카운트 계산 ───────────────────────────────────────────────────────────
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

// ── 그룹 정보 계산 ────────────────────────────────────────────────────────────
// 2분(120s) 기준으로 이전/다음 포스트와의 그룹 경계를 판단한다.
function _getGroupInfo(entryTs) {
  const THRESHOLD = 120
  const bubbles = [...document.querySelectorAll('.bubble.channel-post[data-timestamp]')]
    .sort((a, b) => parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10))

  let prevTs = null, nextTs = null
  for (const b of bubbles) {
    const ts = parseInt(b.dataset.timestamp, 10)
    if (ts <= entryTs) prevTs = ts
    else if (nextTs === null) { nextTs = ts; break }
  }

  return {
    isGroupFirst: prevTs === null || (entryTs - prevTs) >= THRESHOLD,
    isGroupLast:  nextTs === null || (nextTs - entryTs) >= THRESHOLD,
    prevTs, nextTs,
  }
}

// ── 날짜 구분선 ────────────────────────────────────────────────────────────────
function _buildDateSeparator(entryTs) {
  const label = _formatDateLabel(entryTs)
  // 항상 자체 CSS로 렌더 — 클론 문제(각진 테두리, 간격) 방지
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

// ── 섹션 구분선 (현재 포지션 / 종료된 포지션) ─────────────────────────────────
function _buildSectionSeparator(text) {
  const existing = document.querySelector(
    '.bubble.service.is-date:not(.is-sticky):not(.is-fake):not(.teledit-date-sep):not(.teledit-section-sep)'
  )
  if (existing) {
    const clone = existing.cloneNode(true)
    clone.classList.add('teledit-section-sep')
    clone.classList.remove('is-date')
    const textEl = clone.querySelector('.i18n') || clone.querySelector('.service-msg span') || clone.querySelector('.service-msg')
    if (textEl) textEl.textContent = text
    return clone
  }
  const sep = document.createElement('div')
  sep.className = 'bubble service teledit-section-sep'
  const msg = document.createElement('div')
  msg.className = 'service-msg'
  const span = document.createElement('span')
  span.textContent = text
  msg.appendChild(span)
  sep.appendChild(msg)
  return sep
}

// ── 섹션 구분선 삽입 (모든 포지션 삽입 후 호출) ──────────────────────────────
function insertSectionHeaders() {
  // 기존 섹션 구분선 제거
  document.querySelectorAll('.teledit-section-sep').forEach(el => el.remove())

  const openBubbles = [...document.querySelectorAll('.bubble.teledit-injected[data-status="OPEN"]')]
    .sort((a, b) => parseInt(a.dataset.timestamp) - parseInt(b.dataset.timestamp))
  const closedBubbles = [...document.querySelectorAll('.bubble.teledit-injected[data-status]:not([data-status="OPEN"])')]
    .sort((a, b) => parseInt(a.dataset.timestamp) - parseInt(b.dataset.timestamp))

  // 현재 포지션 섹션
  if (openBubbles.length) {
    const firstOpen = openBubbles[0]
    const group = firstOpen.closest('.bubbles-group')
    if (group?.parentElement) {
      // 이미 날짜 구분선이 바로 앞에 있으면 그 앞에 삽입
      const prev = group.previousElementSibling
      const insertBefore = prev?.classList.contains('teledit-date-sep') ? prev : group
      const sep = _buildSectionSeparator('📊 현재 포지션')
      if (sep) insertBefore.parentElement.insertBefore(sep, insertBefore)
    }
  }

  // 종료된 포지션 섹션
  if (closedBubbles.length) {
    const firstClosed = closedBubbles[0]
    const group = firstClosed.closest('.bubbles-group')
    if (group?.parentElement) {
      const prev = group.previousElementSibling
      const insertBefore = prev?.classList.contains('teledit-date-sep') ? prev : group
      const sep = _buildSectionSeparator('📊 종료된 포지션')
      if (sep) insertBefore.parentElement.insertBefore(sep, insertBefore)
    }
  }
}

// ── 카드 DOM 생성 ─────────────────────────────────────────────────────────────
function buildCard(pos) {
  const { bg, border } = resolveColor(pos)
  const pnl      = pos.pnl != null ? `${Number(pos.pnl).toFixed(2)}%` : '—'
  const leverage = pos.leverage    ? `${pos.leverage}x` : ''
  const label    = `[${pos.side} ${leverage}] ${pos.symbol} 진입가 ${pos.entryPrice} / PnL: ${pnl}`
  const div = document.createElement('div')
  div.setAttribute(ATTR, String(pos.id))
  div.className = CLS
  div.textContent = label
  Object.assign(div.style, {
    display:'flex',alignItems:'center',padding:'5px 12px',margin:'2px 8px',
    background:bg,border:`1px solid ${border}`,borderRadius:'8px',
    fontSize:'12px',color:'#e8f4fd',fontFamily:'monospace',letterSpacing:'0.02em',
    pointerEvents:'none',userSelect:'none',zIndex:'0',
  })
  return div
}
