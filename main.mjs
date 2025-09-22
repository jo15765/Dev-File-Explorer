import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let fileIcon;

async function createWindow() {
    fileIcon = await import('file-icon');

    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
        const iconBuffer = await fileIcon.default(filePath, { size: 48 });
        return `data:image/png;base64,${iconBuffer.toString('base64')}`;
    } catch (err) {
        return null;
    }
});
