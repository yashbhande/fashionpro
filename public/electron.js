const { app, BrowserWindow } = require('electron');
const path = require('path');
// FIX: 'electron-is-dev' package devDependencies mein tha, isliye production build
// (.exe) mein woh bundle hi nahi hota — app khulte hi "Cannot find module" crash ho
// jaata tha. Electron khud batata hai app packaged hai ya nahi (app.isPackaged),
// isliye koi extra package ki zaroorat hi nahi — yeh hamesha kaam karega.
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'FashionPro',
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Dev mode: localhost:3000, Production: build/index.html
  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools(); // Dev tools only in dev mode
  } else {
    win.loadFile(path.join(__dirname, '../build/index.html'));
  }
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});