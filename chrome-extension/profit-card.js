// ── 수익인증 카드 이미지 — 서버 API에서 가져오기 ─────────────────────────────

/**
 * 서버에서 수익인증 카드 이미지를 가져와 blob URL로 반환
 */
async function fetchProfitCardImage(posId) {
  try {
    var settings = await loadSettings()
    if (!settings.token) return null

    var url = SERVER_URL + '/api/profit-card/' + posId + '?_t=' + Date.now()

    // 1) 직접 fetch 시도 (캐시 무시)
    try {
      var res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + settings.token },
        cache: 'no-store',
      })
      if (res.ok) {
        var blob = await res.blob()
        if (blob.size > 100) {
          return URL.createObjectURL(blob)
        }
      }
    } catch (e) { /* CORS → proxy 폴백 */ }

    // 2) Background proxy 폴백 (CORS 우회)
    var bgRes = await new Promise(function(resolve) {
      try {
        chrome.runtime.sendMessage({
          action: 'fetchBlob',
          url: url,
          headers: { Authorization: 'Bearer ' + settings.token },
        }, function(response) {
          resolve(response || { dataUrl: null })
        })
      } catch (e) {
        resolve({ dataUrl: null })
      }
    })

    if (bgRes && bgRes.dataUrl) {
      return bgRes.dataUrl
    }

    console.warn('[Teledit] profit card: 직접 fetch + proxy 모두 실패')
    return null
  } catch (e) {
    console.warn('[Teledit] profit card 에러:', e.message)
    return null
  }
}
