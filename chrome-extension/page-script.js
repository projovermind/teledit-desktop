// page-script.js — MAIN world에서 실행 (Telegram 글로벌 API 접근)
// manifest.json의 content_scripts에서 "world": "MAIN"으로 주입됨
'use strict'
;(function() {
  if (window.__teleditAnimInit) return
  window.__teleditAnimInit = true

  const EMOTICONS = ['❤', '👍', '🔥']
  const animUrls = new Map()  // emoticon → decompressed Lottie JSON blob URL

  async function loadAnimUrl(emoticon) {
    try {
      const reaction = await window.apiManagerProxy?.getReaction?.(emoticon)
      const doc = reaction?.around_animation
      if (!doc) return null
      const blob = await window.appDownloadManager?.downloadMedia?.({ doc, media: doc })
      if (!blob) return null
      // TGS = gzip-compressed Lottie JSON → DecompressionStream으로 압축 해제
      const ds = new DecompressionStream('gzip')
      const decompBlob = await new Response(blob.stream().pipeThrough(ds)).blob()
      return URL.createObjectURL(new Blob([decompBlob], { type: 'application/json' }))
    } catch (e) {
      return null
    }
  }

  // 이벤트 리스너는 즉시 등록 (로딩 완료 전 클릭해도 컨테이너 정리됨)
  document.addEventListener('teledit-play-reaction', async function(e) {
    var detail = e.detail || {}
    var container = document.getElementById(detail.containerId)
    if (!container) return
    var url = animUrls.get(detail.emoticon)
    if (!url || !window.lottieLoader) { container.remove(); return }
    try {
      var anim = await window.lottieLoader.loadAnimationFromURL(
        { width: 80, height: 80, skipRatio: 1, autoplay: false, container: container, noCache: true },
        url
      )
      if (anim) {
        anim.play()
        var cleanup = function() { try { container.remove() } catch(ex) {} }
        anim.addEventListener('complete', cleanup)
        setTimeout(cleanup, 2500)
      } else {
        container.remove()
      }
    } catch (err) {
      container.remove()
    }
  })

  // Telegram API 준비될 때까지 대기 후 애니메이션 사전 로드
  ;(async function() {
    var retries = 30
    while (retries-- > 0) {
      if (window.apiManagerProxy && window.appDownloadManager && window.lottieLoader) break
      await new Promise(function(r) { setTimeout(r, 500) })
    }
    await Promise.all(EMOTICONS.map(async function(em) {
      var url = await loadAnimUrl(em)
      if (url) {
        animUrls.set(em, url)
        console.log('[Teledit] around_animation 로드:', em)
      }
    }))
  })()
})()
