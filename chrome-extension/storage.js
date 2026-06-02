// ── chrome.storage 관련 ──────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS, resolve))
}

async function loadCheckedIds() {
  const data = await new Promise((r) => chrome.storage.local.get(['checkedPositions'], r))
  checkedPositionIds = data.checkedPositions ? new Set(data.checkedPositions.map(String)) : null
}

function filterChecked(posList) {
  // null(미설정) 또는 빈 Set → 전체 통과
  if (!checkedPositionIds || checkedPositionIds.size === 0) return posList
  return posList.filter(function(p) { return checkedPositionIds.has(String(p.id)) })
}
