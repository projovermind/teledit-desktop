// ── 불변 상수 ────────────────────────────────────────────────────────────────
var TELEDIT_BUILD = 'v20260413-1131'  // 번들 버전 (디버그용)
var SERVER_URL    = 'https://crypto-sim-nu.vercel.app'
var STORAGE_KEYS  = ['token', 'enabled']
var ATTR          = 'data-position-id'
var CLS           = 'teledit-position'
var INSERT_BTN_ID = 'teledit-insert-btn'

// 고정 3종 리액션 doc-id (페이지에서 blob URL 조회용)
var REACTION_DOC_IDS = [
  '5098582486267462019',  // ❤️
  '5100483636361167223',  // 👍
  '4911350297600721490',  // 🔥
]

// getReaction() 호출용 이모티콘 문자열 (REACTION_DOC_IDS와 순서 일치)
var REACTION_EMOTICONS = ['❤', '👍', '🔥']

var COLOR = {
  OPEN:      { bg: '#1a3a5c', border: '#5eacd3' },
  CLOSED_TP: { bg: '#1a3d2a', border: '#4caf7d' },
  CLOSED_SL: { bg: '#3d1a1a', border: '#e05c5c' },
}

// 포지션 캐시 TTL (불변)
var _POS_CACHE_TTL = 10000
