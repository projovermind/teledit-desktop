const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  // 드래그 영역 (상단)
  const drag = document.createElement('div')
  drag.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:36px', 'height:32px',
    '-webkit-app-region:drag', 'z-index:99998', 'pointer-events:none',
  ].join(';')
  document.body.appendChild(drag)

  // 닫기 버튼
  const close = document.createElement('button')
  close.innerHTML = '&#10005;'
  close.style.cssText = [
    'position:fixed', 'top:6px', 'right:8px', 'width:22px', 'height:22px',
    'border-radius:50%', 'border:none',
    'background:rgba(255,255,255,0.07)', 'color:#8fa7be',
    'cursor:pointer', 'font-size:12px', 'line-height:1',
    'display:flex', 'align-items:center', 'justify-content:center',
    'z-index:99999', '-webkit-app-region:no-drag',
    'transition:background 0.1s,color 0.1s',
  ].join(';')
  close.addEventListener('mouseenter', () => {
    close.style.background = 'rgba(196,43,28,0.85)'
    close.style.color = '#fff'
  })
  close.addEventListener('mouseleave', () => {
    close.style.background = 'rgba(255,255,255,0.07)'
    close.style.color = '#8fa7be'
  })
  close.addEventListener('click', () => ipcRenderer.send('settings:close'))
  document.body.appendChild(close)

  // 바디 상단에 여백 (버튼이 팝업 콘텐츠와 겹치지 않게)
  if (document.body.style.paddingTop === '') {
    document.body.style.paddingTop = '6px'
  }
})
