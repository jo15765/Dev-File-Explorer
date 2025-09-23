'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const util = require('util');
const execFileP = util.promisify(execFile);
let win;

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false
        }
    });
    win.loadFile('index.html');
}

app.whenReady().then(async () => {
    createWindow();
    const s = await loadState();
    buildMenu(s.prefs);
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function stateFile() { return path.join(app.getPath('userData'), 'favorites-state.json'); }
const defaultPrefs = { showHidden: false, showExtensions: true };

async function loadState() {
    try {
        const buf = await fsp.readFile(stateFile(), 'utf8');
        const parsed = JSON.parse(buf);
        return {
            setupCompleted: !!parsed.setupCompleted,
            items: Array.isArray(parsed.items) ? parsed.items : [],
            prefs: { ...defaultPrefs, ...(parsed.prefs || {}) }
        };
    } catch {
        return { setupCompleted: false, items: [], prefs: { ...defaultPrefs } };
    }
}
async function saveState(s) {
    await fsp.mkdir(path.dirname(stateFile()), { recursive: true });
    await fsp.writeFile(stateFile(), JSON.stringify(s, null, 2), 'utf8');
}
function sysFolderEmoji(key) {
    return ({ desktop:'🖥️', downloads:'⬇️', documents:'📄', music:'🎵', pictures:'🖼️', videos:'🎬' })[key] || '📁';
}
function isSamePath(a,b){ return path.resolve(a) === path.resolve(b); }

function buildMenu(prefs) {
    const template = [];
    if (process.platform === 'darwin') {
        template.push({ label: app.name, submenu: [{ role:'about' }, { type:'separator' }, { role:'hide' }, { role:'hideOthers' }, { role:'unhide' }, { type:'separator' }, { role:'quit' }] });
    }
    template.push({
        label: 'Options',
        submenu: [
            { label:'Show Hidden Files', type:'checkbox', checked:!!prefs.showHidden, click: async (mi)=>{ await setPrefs({ showHidden: mi.checked }); } },
            { label:'Show File Extensions', type:'checkbox', checked:!!prefs.showExtensions, click: async (mi)=>{ await setPrefs({ showExtensions: mi.checked }); } },
        ]
    });
    template.push({ role:'viewMenu' }, { role:'editMenu' });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
async function setPrefs(patch){
    const s = await loadState();
    s.prefs = { ...defaultPrefs, ...(s.prefs||{}), ...(patch||{}) };
    await saveState(s);
    buildMenu(s.prefs);
    if (win && !win.isDestroyed()) win.webContents.send('prefs-changed', s.prefs);
}

async function copyPath(src, dst) {
    const st = await fsp.lstat(src);
    if (st.isDirectory()) {
        await fsp.mkdir(dst, { recursive: true });
        for (const name of await fsp.readdir(src)) {
            await copyPath(path.join(src, name), path.join(dst, name));
        }
    } else {
        await fsp.copyFile(src, dst);
    }
}
async function removePath(p) { await fsp.rm(p, { recursive:true, force:true }); }
async function runCmd(bin, args, cwd) { await util.promisify(execFile)(bin, args, { cwd }); }

function iconSizeOption(s){ return s==='small'?'small':(s==='large'?'large':'normal'); }
async function getIconDataURL(fullPath, iconSize){
    try { const img = await app.getFileIcon(fullPath, { size: iconSizeOption(iconSize) }); return img && !img.isEmpty() ? img.toDataURL() : ''; }
    catch { return ''; }
}
async function listDirectory(dirPath, iconSize){
    const dirents = await fsp.readdir(dirPath, { withFileTypes:true });
    const items = [];
    for (const de of dirents) {
        const name = de.name; const full = path.join(dirPath, name);
        try {
            const st = await fsp.lstat(full);
            const isDir = st.isDirectory();
            const iconDataUrl = await getIconDataURL(full, iconSize);
            items.push({
                name, path: full, isDir,
                sizeBytes: isDir ? 0 : st.size,
                mtimeMs: st.mtimeMs,
                type: isDir ? 'Folder' : (path.extname(name).slice(1) || 'File'),
                isHidden: name.startsWith('.'),
                iconDataUrl
            });
        } catch {}
    }
    return items.sort((a,b)=> (a.isDir!==b.isDir) ? (a.isDir?-1:1) : a.name.localeCompare(b.name, undefined, { sensitivity:'base' }));
}

function uniqueZipName(destDir, baseName){
    let name = baseName, i = 2;
    while (fs.existsSync(path.join(destDir, name))) {
        const base = baseName.endsWith('.zip') ? baseName.slice(0,-4) : baseName;
        name = `${base} (${i}).zip`; i++;
    }
    return name;
}
async function compressPaths(paths, destDir){
    if (!paths || !paths.length) throw new Error('No paths to compress.');
    await fsp.access(destDir);
    if (paths.length === 1) {
        const base = path.basename(paths[0]) + '.zip';
        const zipPath = path.join(destDir, uniqueZipName(destDir, base));
        await runCmd('/usr/bin/ditto', ['-c','-k','--sequesterRsrc','--keepParent', paths[0], zipPath], destDir);
        return zipPath;
    }
    const stage = path.join(destDir, '.zip-stage-' + Date.now());
    await fsp.mkdir(stage, { recursive:true });
    try {
        for (const p of paths) await copyPath(p, path.join(stage, path.basename(p)));
        const zipPath = path.join(destDir, uniqueZipName(destDir, 'Archive.zip'));
        await runCmd('/usr/bin/zip', ['-r', zipPath, '.'], stage);
        return zipPath;
    } finally { try { await removePath(stage); } catch {} }
}
async function extractArchive(archivePath, destDir){
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.zip')) { await runCmd('/usr/bin/ditto', ['-x','-k', archivePath, destDir], destDir); return; }
    if (lower.endsWith('.7z') || lower.endsWith('.7zip')) {
        const candidates = ['/opt/homebrew/bin/7z','/usr/local/bin/7z','/usr/bin/7z'];
        let bin = null; for (const p of candidates) { try { await fsp.access(p); bin = p; break; } catch {} }
        if (!bin) throw new Error('7z not found. Install with: brew install p7zip');
        await runCmd(bin, ['x','-y','-o'+destDir, archivePath], destDir); return;
    }
    throw new Error('Unsupported archive type');
}

function systemFolderInfo() {
    const keys = ['desktop','downloads','documents','music','pictures','videos'];
    return keys.map(key=>{
        const p = app.getPath(key);
        return { key, path:p, label:key[0].toUpperCase()+key.slice(1), emoji: sysFolderEmoji(key), exists: fs.existsSync(p) };
    });
}
function isSystemPath(p) {
    const sys = systemFolderInfo().map(x => x.path);
    const r = path.resolve(p);
    return sys.some(sp => path.resolve(sp) === r);
}

ipcMain.handle('homedir', async () => app.getPath('home'));
ipcMain.handle('open-path', async (_e, p)=>{ try{ await shell.openPath(p); return {ok:true}; } catch(err){ return {ok:false, error:err.message||String(err)}; }});
ipcMain.handle('list-dir', async (_e, dirPath, iconSize)=>{ try{ return await listDirectory(dirPath, iconSize||'medium'); } catch{ return []; }});
ipcMain.handle('move-path', async (_e, srcPath, destDir) => {
    try {
        await fsp.access(destDir);
        const target = path.join(destDir, path.basename(srcPath));
        try { await fsp.rename(srcPath, target); }
        catch (err) { if (err && err.code === 'EXDEV') { await copyPath(srcPath, target); await removePath(srcPath); } else throw err; }
        return { ok:true, newPath: target };
    } catch (err) { return { ok:false, error: err.message || String(err) }; }
});
ipcMain.handle('trash-path', async (_e, p)=>{ try{ await shell.trashItem(p); return {ok:true}; } catch(err){ return {ok:false, error:err.message||String(err)}; }});
ipcMain.handle('rename-path', async (_e, oldPath, nextName) => {
    try {
        if (isSystemPath(oldPath)) throw new Error('Cannot rename a system folder.');
        if (!nextName || /[\/\\]/.test(nextName) || nextName === '.' || nextName === '..') throw new Error('Invalid name.');
        const parent = path.dirname(oldPath);
        const newPath = path.join(parent, nextName);
        await fsp.rename(oldPath, newPath);
        const s = await loadState();
        let changed = false;
        s.items = s.items.map(it => {
            if (path.resolve(it.path) === path.resolve(oldPath)) {
                changed = true;
                return { ...it, path: newPath, label: nextName };
            }
            return it;
        });
        if (changed) await saveState(s);

        return { ok: true, newPath, favorites: s.items };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
});

ipcMain.handle('extract-archive', async (_e, archivePath, destDir)=>{ try{ await extractArchive(archivePath, destDir); return {ok:true}; } catch(err){ return {ok:false, error:err.message||String(err)}; }});
ipcMain.handle('compress-paths', async (_e, paths, destDir)=>{ try{ const zipPath = await compressPaths(Array.isArray(paths)?paths:[], destDir); return {ok:true, zipPath}; } catch(err){ return {ok:false, error:err.message||String(err)}; }});
ipcMain.handle('get-system-folders', async ()=> systemFolderInfo());
ipcMain.handle('get-favorites-state', async ()=> loadState());
ipcMain.handle('complete-setup', async (_e, keys)=>{
    const s = await loadState();
    if (Array.isArray(keys)) {
        const sys = systemFolderInfo();
        for (const key of keys) {
            const info = sys.find(x => x.key === key && x.exists);
            if (info && !s.items.some(it => isSamePath(it.path, info.path))) {
                s.items.push({ path: info.path, label: info.label, emoji: info.emoji });
            }
        }
    }
    s.setupCompleted = true; await saveState(s); return s;
});
ipcMain.handle('skip-setup', async ()=>{ const s = await loadState(); s.setupCompleted = true; await saveState(s); return s; });
ipcMain.handle('add-favorite', async (_e, p)=> {
    try {
        const st = await fsp.lstat(p);
        if (!st.isDirectory()) throw new Error('Only folders can be favorited.');
        const s = await loadState();
        if (!s.items.some(it => isSamePath(it.path, p))) {
            s.items.push({ path:p, label: path.basename(p), emoji:'📁' });
            await saveState(s);
        }
        return s.items;
    } catch (err) { return { ok:false, error: err.message || String(err) }; }
});
ipcMain.handle('remove-favorite', async (_e, p)=>{ const s = await loadState(); s.items = s.items.filter(it => !isSamePath(it.path, p)); await saveState(s); return s.items; });
ipcMain.handle('rename-favorite', async (_e, oldPath, nextName)=>{
    try{
        if (isSystemPath(oldPath)) throw new Error('Cannot rename a system folder.');
        const parent = path.dirname(oldPath);
        const newPath = path.join(parent, nextName);
        await fsp.rename(oldPath, newPath);
        const s = await loadState();
        s.items = s.items.map(it => isSamePath(it.path, oldPath) ? { ...it, path:newPath, label:nextName } : it);
        await saveState(s);
        return { ok:true, items:s.items, newPath };
    }catch(err){ return { ok:false, error: err.message || String(err) }; }
});

ipcMain.handle('get-preferences', async ()=> (await loadState()).prefs || { showHidden:false, showExtensions:true });
ipcMain.handle('set-preferences', async (_e, patch)=>{ await setPrefs(patch||{}); return (await loadState()).prefs; });
