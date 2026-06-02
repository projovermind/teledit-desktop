// ── 그룹/위치/날짜그룹 ──────────────────────────────────────────────────────

// ── 그룹 정보 계산 ─────────────────────────────────────────────────────────
// 2분(120s) 기준으로 이전/다음 포스트와의 그룹 경계를 판단한다.
// Bug 18 fix: 실제 포스트만 사용 (주입된 버블 제외)
function _getGroupInfo(entryTs) {
  var THRESHOLD = 120
  var bubbles = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)'))
    .sort(function(a, b) { return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10) })

  var prevTs = null, nextTs = null
  for (var i = 0; i < bubbles.length; i++) {
    var ts = parseInt(bubbles[i].dataset.timestamp, 10)
    if (ts <= entryTs) prevTs = ts
    else if (nextTs === null) { nextTs = ts; break }
  }

  return {
    isGroupFirst: prevTs === null || (entryTs - prevTs) >= THRESHOLD,
    isGroupLast:  nextTs === null || (nextTs - entryTs) >= THRESHOLD,
    prevTs: prevTs, nextTs: nextTs,
  }
}

// ── Unix day number (로케일 무관 날짜 비교) ─────────────────────────────────
function _dayOfTs(ts) {
  // ts는 초 단위 Unix timestamp → 로컬 타임존 기준 날짜 번호
  var d = new Date(ts * 1000)
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000)
}

// 날짜 그룹에서 타임스탬프 추출 (첫 번째 실제 버블의 timestamp 사용)
function _getDateGroupDay(dateGroup) {
  var firstBubble = dateGroup.querySelector('.bubble.channel-post[data-timestamp]')
  if (firstBubble) return _dayOfTs(parseInt(firstBubble.dataset.timestamp, 10))
  // 버블 없으면 teledit 라벨에서 추정 불가 → -1 반환
  return -1
}

// ── DOM 삽입 및 그룹 처리 ────────────────────────────────────────────────────
// Bug 1 fix: forceInsert 파라미터 제거 — 항상 범위 체크
// Bug 2 fix: originalText 파라미터 추가 — DOM이 아닌 원본 텍스트 저장
function _insertBubbleIntoDOM(bubble, group, entryTs, pos, posId, isGroupFirst, isGroupLast, originalText) {
  var joinedExistingGroup = false

  if (!isGroupFirst) {
    var prevInjected = [].slice.call(document.querySelectorAll('.bubble.channel-post.teledit-injected[data-timestamp]'))
      .filter(function(b) {
        var ts = parseInt(b.dataset.timestamp, 10)
        return ts < entryTs && (entryTs - ts) < 120
      })
      .sort(function(a, b) { return parseInt(b.dataset.timestamp, 10) - parseInt(a.dataset.timestamp, 10) })[0]

    if (prevInjected) {
      var prevGroup = prevInjected.closest('.bubbles-group.teledit-injected-group')
      if (prevGroup) {
        group = prevGroup
        prevGroup.appendChild(bubble)
        joinedExistingGroup = true
        prevInjected.classList.remove('is-group-last', 'can-have-tail')
        var tail = prevInjected.querySelector('.bubble-tail')
        if (tail) tail.remove()
      }
    }
  }

  if (!joinedExistingGroup) {
    group.appendChild(bubble)

    // Bug 4 fix: 삽입 위치 계산에 실제 포스트만 사용 (주입 버블 제외)
    var realPosts = [].slice.call(document.querySelectorAll('.bubble.channel-post[data-timestamp]:not(.teledit-injected)'))
    realPosts.sort(function(a, b) {
      return parseInt(a.dataset.timestamp, 10) - parseInt(b.dataset.timestamp, 10)
    })

    // ── 범위 체크: 항상 적용 (forceInsert 없음) ──
    var inserted = false
    if (realPosts.length) {
      var minRealTs = parseInt(realPosts[0].dataset.timestamp, 10)
      var maxRealTs = parseInt(realPosts[realPosts.length - 1].dataset.timestamp, 10)

      if (entryTs < minRealTs || entryTs > maxRealTs) {
        // Bug 2 fix: DOM이 아닌 원본 텍스트 저장
        if (posId) pendingBubbles.set(posId, { text: originalText || '', pos: pos })
        bubble.remove()
        group.remove()
        return false
      }
    }

    // ── 삽입 위치 결정 (실제 포스트 기준) ──
    if (realPosts.length) {
      var insertBefore = null
      for (var j = 0; j < realPosts.length; j++) {
        if (parseInt(realPosts[j].dataset.timestamp, 10) > entryTs) {
          insertBefore = realPosts[j]
          break
        }
      }
      if (insertBefore) {
        var pg = insertBefore.closest('.bubbles-group')
        if (pg && pg.parentElement) {
          pg.parentElement.insertBefore(group, pg)
          inserted = true
        }
      }
      if (!inserted) {
        var lastPg = realPosts[realPosts.length - 1].closest('.bubbles-group')
        if (lastPg && lastPg.parentElement) {
          lastPg.parentElement.insertBefore(group, lastPg.nextSibling)
          inserted = true
        }
      }
    }
    if (!inserted) {
      var dg = document.querySelectorAll('.bubbles-date-group')
      if (dg.length) dg[dg.length - 1].appendChild(group)
    }

    // ── Bug 5,16 fix: 날짜 그룹 교정 (Unix day 비교, 방향 판단) ──
    var parentDateGroup = group.closest('.bubbles-date-group')
    if (parentDateGroup) {
      var parentDay = _getDateGroupDay(parentDateGroup)
      var myDay = _dayOfTs(entryTs)

      if (parentDay >= 0 && parentDay !== myDay) {
        var _par = parentDateGroup.parentElement
        if (!_par) return true

        // 이미 같은 날짜의 teledit 그룹이 있으면 재사용
        var existingTeleditGroup = null
        var allTeleditGroups = _par.querySelectorAll('.bubbles-date-group.teledit-date-group')
        for (var tg = 0; tg < allTeleditGroups.length; tg++) {
          var tgDay = _getDateGroupDay(allTeleditGroups[tg])
          if (tgDay === myDay) { existingTeleditGroup = allTeleditGroups[tg]; break }
        }

        if (existingTeleditGroup) {
          existingTeleditGroup.appendChild(group)
        } else {
          var newDateGroup = document.createElement('div')
          newDateGroup.className = 'bubbles-date-group teledit-date-group'
          newDateGroup.appendChild(_buildDateSeparator(entryTs))
          newDateGroup.appendChild(group)

          // Bug 5 fix: 날짜 비교 후 before/after 결정
          if (myDay < parentDay) {
            _par.insertBefore(newDateGroup, parentDateGroup)
          } else {
            // myDay > parentDay → 뒤에 삽입
            if (parentDateGroup.nextSibling) {
              _par.insertBefore(newDateGroup, parentDateGroup.nextSibling)
            } else {
              _par.appendChild(newDateGroup)
            }
          }
        }
      }
    }

    // ── 이전 그룹과의 간격 ──
    var prevGroupEl = group.previousElementSibling
    if (prevGroupEl && prevGroupEl.classList.contains('bubbles-group')) {
      if (!isGroupFirst) {
        var lastPrevBubble = prevGroupEl.querySelector('.bubble:last-child')
        if (lastPrevBubble) {
          lastPrevBubble.classList.remove('is-group-last', 'can-have-tail')
          var prevTail = lastPrevBubble.querySelector('.bubble-tail')
          if (prevTail) prevTail.remove()
        }
      } else if (prevGroupEl.classList.contains('bubbles-group-last')) {
        group.style.marginTop = '6px'
      }
    }

    // ── 다음 그룹과의 간격 ──
    if (!isGroupLast) {
      var nextGroupEl = group.nextElementSibling
      if (nextGroupEl && nextGroupEl.classList.contains('bubbles-group') &&
          !nextGroupEl.classList.contains('teledit-injected-group')) {
        var firstNextBubble = nextGroupEl.querySelector('.bubble:first-child')
        if (firstNextBubble) {
          firstNextBubble.classList.remove('is-group-first')
        }
      }
    }
  }

  return true
}
