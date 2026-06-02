// ── 공유 상태 (모든 mutable 변수 중앙 관리) ──────────────────────────────────

// constants.js에서 이동
var positions          = []
var observer           = null
var debounceTimer      = null
var seenPositionIds    = new Set()
var checkedPositionIds = null

// 말풍선 영구 캐시
var bubbleDataCache = new Map()  // posId -> { viewCount, reactions:[{blobSrc,count,chosen}] }
var injectedBubbles = new Map()  // fakeMid -> { text, pos }
var pendingBubbles  = new Map()  // posId -> { text, pos }

// comments.js에서 이동
var _userSettings    = null      // { templates, enabled, timing }
var _settingsFetched = false
var _tsCache         = new Map()

// api.js에서 이동
var _posCache     = null
var _posCacheTime = 0

// content.js에서 이동
var _commentAuthorsCache = new Map()  // posId -> { type: [authorName, ...] }
var _scrollObserver      = null
var _scrollDebounce      = null
var _insertedPositions   = []

// profit-card: 캐시 제거 — 항상 최신 이미지 fetch

// comment-ui.js에서 이동
var _commentOverlay = null
var _commentCache   = new Map()

// NEW: 댓글 수/작성자 캐시 (bug #3 수정 — 아바타 안정성)
var _replyDataCache = new Map()  // posId -> { commentCount, authorNames }
