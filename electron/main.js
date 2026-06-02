const { app, BrowserWindow, BrowserView, session, ipcMain, shell, nativeImage } = require('electron')
const path = require('path')

const TELEGRAM_URL = 'https://web.telegram.org/k/'

let mainWindow = null
let tgView = null
let settingsWindow = null
let extensionId = null

// ── 확장 로드 (defaultSession) ────────────────────────────────────────────────
async function loadExtension() {
  const extPath = app.isPackaged
    ? path.join(process.resourcesPath, 'chrome-extension')
    : path.join(__dirname, '..', 'chrome-extension')

  try {
    const ext = await session.defaultSession.loadExtension(extPath, { allowFileAccess: true })
    extensionId = ext.id
    console.log('[Teledit] Extension loaded:', extensionId)
  } catch (err) {
    console.error('[Teledit] Extension load error:', err.message)
  }
}

// ── 메인 윈도우 ───────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#17212b',
    show: false,
    icon: getAppIcon(),
    // macOS: 네이티브 신호등만 좌상단 오버레이
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 11 },
  })

  // 메인 윈도우 콘텐츠는 BrowserView가 전부 덮으므로 빈 다크 배경만
  mainWindow.loadURL('data:text/html,<body style="margin:0;background:%2317212b"></body>')

  // Telegram BrowserView — 창 전체를 채움 (y=0)
  // 확장은 defaultSession에 있으므로 BrowserView도 defaultSession 사용 → content script 주입됨.
  // telegram-preload가 창 컨트롤(min/max/close + 설정)을 페이지에 직접 주입한다.
  tgView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'telegram-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
    },
  })
  mainWindow.setBrowserView(tgView)

  function fillBounds() {
    const b = mainWindow.getContentBounds()
    tgView.setBounds({ x: 0, y: 0, width: b.width, height: b.height })
  }
  fillBounds()
  mainWindow.on('resize', fillBounds)

  tgView.webContents.loadURL(TELEGRAM_URL)

  // 외부 링크는 기본 브라우저로
  tgView.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://web.telegram.org')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 최대화 상태를 주입된 컨트롤에 전파 (max 버튼 아이콘 토글)
  const sendMaxState = () => {
    if (tgView && !tgView.webContents.isDestroyed()) {
      tgView.webContents.send('window:maximized', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null; tgView = null })
}

// ── 설정 윈도우 (확장 popup 재활용) ──────────────────────────────────────────
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return }

  settingsWindow = new BrowserWindow({
    width: 332,
    height: 600,
    parent: mainWindow,
    modal: false,
    frame: false,
    resizable: false,
    backgroundColor: '#17212b',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    icon: getAppIcon(),
  })

  const popupUrl = extensionId
    ? `chrome-extension://${extensionId}/popup.html`
    : `file://${path.join(__dirname, 'settings-fallback.html')}`

  settingsWindow.loadURL(popupUrl)
  settingsWindow.once('ready-to-show', () => settingsWindow.show())
  settingsWindow.on('closed', () => { settingsWindow = null })
}

// ── 아이콘 ────────────────────────────────────────────────────────────────────
function getAppIcon() {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const p = app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'build', name)
  try {
    const img = nativeImage.createFromPath(p)
    return img.isEmpty() ? undefined : p
  } catch { return undefined }
}

// ── IPC (창 컨트롤) ───────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.on('window:settings', () => openSettings())
ipcMain.on('settings:close', () => settingsWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

// ── 앱 시작 ───────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await loadExtension()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
