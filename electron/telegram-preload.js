// telegram-preload.js — web.telegram.org/k/ 위에 tdesktop 스타일 창 컨트롤을 주입.
// 별도 타이틀바 띠 없이 텔레그램이 창 전체를 채우고, 우상단에만 컨트롤이 떠 있음.
const { ipcRenderer } = require('electron')

const isMac = process.platform === 'darwin'

const ICON = {
  settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>',
  min: '<svg width="11" height="1" viewBox="0 0 11 1"><rect width="11" height="1" fill="currentColor"/></svg>',
  max: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5.5h7v7" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  close: '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
}

const HEADER_BG = '#17212b'   // Telegram K 다크 헤더 색 (불일치 시 조정)
const BTN_FG = '#7d8e9e'
const BTN_FG_HOVER = '#ffffff'

function makeBtn(html, title, onClick, opts) {
  opts = opts || {}
  const b = document.createElement('button')
  b.innerHTML = html
  b.title = title
  b.style.cssText = [
    'width:' + (opts.w || 46) + 'px', 'height:34px',
    'border:none', 'background:transparent', 'cursor:pointer',
    'color:' + BTN_FG, 'padding:0', 'margin:0',
    'display:flex', 'align-items:center', 'justify-content:center',
    '-webkit-app-region:no-drag', 'outline:none',
    'transition:background .12s,color .12s',
  ].join(';')
  b.addEventListener('mouseenter', () => {
    b.style.background = opts.danger ? '#c42b1c' : 'rgba(255,255,255,0.08)'
    b.style.color = BTN_FG_HOVER
  })
  b.addEventListener('mouseleave', () => {
    b.style.background = 'transparent'
    b.style.color = BTN_FG
  })
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick() })
  return b
}

function buildControls() {
  if (document.getElementById('teledit-winctl')) return
  if (!document.documentElement) return

  // 바깥 컨테이너: 우상단 고정 + 좌측 드래그 패드
  const bar = document.createElement('div')
  bar.id = 'teledit-winctl'
  bar.style.cssText = [
    'position:fixed', 'top:0', 'right:0', 'height:34px',
    'z-index:2147483646',
    'display:flex', 'align-items:stretch',
    '-webkit-app-region:drag',           // 빈 영역에서 창 드래그
    'pointer-events:none',               // 패드는 클릭 통과
  ].join(';')

  // 좌측 투명 드래그 패드 (창 이동용 손잡이)
  const pad = document.createElement('div')
  pad.style.cssText = 'width:44px;height:34px;-webkit-app-region:drag;pointer-events:auto'
  bar.appendChild(pad)

  // 버튼 묶음: 불투명 배경으로 텔레그램 코너 아이콘을 깔끔히 덮음
  const wrap = document.createElement('div')
  wrap.style.cssText = [
    'display:flex', 'align-items:center', 'height:34px',
    'background:' + HEADER_BG, 'pointer-events:auto',
    '-webkit-app-region:no-drag',
  ].join(';')

  // 설정(⚙)은 모든 OS에 주입 (Teledit 설정 진입점)
  wrap.appendChild(makeBtn(ICON.settings, 'Teledit 설정', () => ipcRenderer.send('window:settings'), { w: 40 }))

  // Windows/Linux: min/max/close 추가 (macOS는 네이티브 신호등 사용)
  if (!isMac) {
    wrap.appendChild(makeBtn(ICON.min, '최소화', () => ipcRenderer.send('window:minimize')))
    const maxBtn = makeBtn(ICON.max, '최대화', () => ipcRenderer.send('window:maximize'))
    maxBtn.id = 'teledit-maxbtn'
    wrap.appendChild(maxBtn)
    wrap.appendChild(makeBtn(ICON.close, '닫기', () => ipcRenderer.send('window:close'), { danger: true }))
  }

  bar.appendChild(wrap)
  document.documentElement.appendChild(bar)
}

// 최대화 상태 → max 버튼 아이콘 토글
ipcRenderer.on('window:maximized', (_e, isMax) => {
  const b = document.getElementById('teledit-maxbtn')
  if (b) b.innerHTML = isMax ? ICON.restore : ICON.max
})

// Telegram은 SPA라 DOM이 늦게/다시 그려짐 → 주기적으로 컨트롤 존재 보장
function ensure() { try { buildControls() } catch (_) {} }
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', ensure)
} else {
  ensure()
}
setInterval(ensure, 1500)
