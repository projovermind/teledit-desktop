// Service Worker — Teledit

const ALARM_NAME    = 'teledit-update-check'
const CHECK_PERIOD  = 6 * 60  // 6시간 (분 단위)

// ── 업데이트 확인 (GitHub Releases) ──────────────────────────────────────────
const GITHUB_REPO = 'projovermind/crypto-sim'

async function checkForUpdate() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github.v3+json' } }
    )
    if (!res.ok) return
    const release = await res.json()
    const latestVersion = (release.tag_name || '').replace('ext-v', '')
    const currentVersion = chrome.runtime.getManifest().version
    // semver 비교: latest > current 일 때만 업데이트
    const _cmpVer = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0) - (pb[i]||0) }
      return 0
    }
    if (latestVersion && _cmpVer(latestVersion, currentVersion) > 0) {
      const asset = release.assets?.find(a => a.name === 'extension.zip')
      await chrome.storage.local.set({
        updateAvailable: true,
        latestVersion,
        downloadUrl: asset?.browser_download_url || release.html_url,
      })
    } else {
      await chrome.storage.local.set({ updateAvailable: false })
    }
  } catch (err) {
    console.warn('[Teledit] update check failed:', err)
  }
}

// ── 알람 등록 ─────────────────────────────────────────────────────────────────
function registerAlarm() {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD })
    }
  })
}

// ── content script용 fetch 프록시 ─────────────────────────────────────────────
// content script에서 직접 fetch하면 CORS 차단되는 환경이 있으므로
// background worker를 통해 우회한다.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetch') {
    fetch(msg.url, { headers: msg.headers || {} })
      .then(res => res.json().then(data => ({ ok: res.ok, status: res.status, data })))
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, status: 0, data: null, error: err.message }))
    return true
  }
  // 이미지 blob fetch (profit card 등)
  if (msg.action === 'fetchBlob') {
    fetch(msg.url, { headers: msg.headers || {}, cache: 'no-store' })
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader()
        reader.onload = () => sendResponse({ dataUrl: reader.result })
        reader.readAsDataURL(blob)
      })
      .catch(err => sendResponse({ dataUrl: null, error: err.message }))
    return true
  }
})

// ── 이벤트 리스너 ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Teledit] extension installed')
  registerAlarm()
  checkForUpdate()
})

chrome.runtime.onStartup.addListener(() => {
  registerAlarm()
  checkForUpdate()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkForUpdate()
})
