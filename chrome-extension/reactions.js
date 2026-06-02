// ── 반응 클릭 인터셉터 ────────────────────────────────────────────────────────

function _attachReactionInterceptor(reactionsEl, reactionData, posId) {
  reactionsEl.addEventListener('click', function(e) {
    var reactionEl = e.target.closest('reaction-element')
                  || e.target.closest('.reaction.reaction-block')
    if (!reactionEl || !reactionsEl.contains(reactionEl)) return

    e.stopImmediatePropagation()
    e.preventDefault()

    var allReactionEls = [].slice.call(reactionsEl.querySelectorAll('reaction-element, .reaction.reaction-block'))
    var idx = allReactionEls.indexOf(reactionEl)
    if (idx === -1) return

    var isChosen = reactionEl.classList.contains('is-chosen')
    var counter  = reactionEl.querySelector('.reaction-counter')
    var img      = reactionEl.querySelector('.media-sticker')
    var blobSrc  = img ? img.src : null
    var rect     = reactionEl.getBoundingClientRect()

    if (!isChosen) {
      // ── 선택 ──
      reactionEl.classList.add('is-chosen')
      if (counter) counter.textContent = String(parseInt(counter.textContent) + 1)

      // 버튼 스케일 펄스
      reactionEl.style.transition = 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)'
      reactionEl.style.transform = 'scale(1.2)'
      setTimeout(function() {
        reactionEl.style.transform = 'scale(1)'
        setTimeout(function() { reactionEl.style.transition = ''; reactionEl.style.transform = '' }, 150)
      }, 120)

      // 스티커 바운스
      if (img) {
        img.style.animation = 'none'
        void img.offsetHeight
        img.style.animation = 'teledit-sticker-pop 0.42s ease'
        setTimeout(function() { img.style.animation = '' }, 420)
      }

      // 플로팅 이모지
      if (blobSrc) {
        var floater = document.createElement('div')
        floater.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2 - 14) + 'px;top:' + (rect.top - 8) + 'px;width:28px;height:28px;z-index:99999;pointer-events:none;animation:teledit-float-up 0.65s ease forwards;'
        var fImg = document.createElement('img')
        fImg.src = blobSrc
        fImg.style.cssText = 'width:100%;height:100%;object-fit:contain;'
        floater.appendChild(fImg)
        document.body.appendChild(floater)
        setTimeout(function() { floater.remove() }, 750)
      }

    } else {
      // ── 해제 ──
      reactionEl.style.transition = 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)'
      reactionEl.style.transform = 'scale(0.85)'
      setTimeout(function() {
        reactionEl.classList.remove('is-chosen')
        reactionEl.style.transform = 'scale(1)'
        setTimeout(function() { reactionEl.style.transition = ''; reactionEl.style.transform = '' }, 150)
      }, 120)
      if (counter) counter.textContent = String(parseInt(counter.textContent) - 1)
    }

    // 캐시 갱신
    if (posId) {
      var data = bubbleDataCache.get(posId)
      if (data && data.reactions[idx]) {
        data.reactions[idx].count  = parseInt(counter ? counter.textContent : '0')
        data.reactions[idx].chosen = reactionEl.classList.contains('is-chosen')
      }
    }
  }, true)
}
