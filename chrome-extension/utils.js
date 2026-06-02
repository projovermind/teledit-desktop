// ── 유틸리티 함수 ─────────────────────────────────────────────────────────────
// 순수 유틸 + 간단한 DOM 쿼리. chrome.* API 의존 없음.

function _rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a }

function isChannelView() {
  return !!document.querySelector('.bubble.channel-post')
}

// ── 색상 결정 ────────────────────────────────────────────────────────────────
function resolveColor(pos) {
  if (pos.status === 'OPEN') return COLOR.OPEN
  const reason = pos.status === 'CLOSED_TP' || pos.closeReason === 'TP' ? 'CLOSED_TP' : 'CLOSED_SL'
  return COLOR[reason]
}

// ── 시간 포맷 ────────────────────────────────────────────────────────────────
function fmtTimeKorean(dateStr) {
  const d = new Date(dateStr)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return (h < 12 ? '오전' : '오후') + ' ' + h12.toString().padStart(2, '0') + ':' + m
}

// ── 댓글 시간 포맷 (comment-ui.js에서 사용) ─────────────────────────────────
function _fmtCommentTime(date) {
  var d = date instanceof Date ? date : new Date(date)
  var h = d.getHours()
  var m = d.getMinutes().toString().padStart(2, '0')
  var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  var ap = h < 12 ? 'AM' : 'PM'
  return h12 + ':' + m + ' ' + ap
}

// ── 날짜 라벨 포맷 ───────────────────────────────────────────────────────────
function _formatDateLabel(ts) {
  const d = new Date(ts * 1000)
  const today = new Date()
  const yest  = new Date(today); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString())  return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
