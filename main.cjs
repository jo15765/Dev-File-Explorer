// main.cjs (CommonJS) — main process
const { app, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

/* ---------------- Window ---------------- */

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 750,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // preload uses Node
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

/* ---------------- Icons (robust) ---------------- */

function prefToElectronSize(pref) {
    return pref === 'small' ? 'small' : pref === 'large' ? 'large' : 'normal';
}

async function iconDataURLFor(p, preferred /* 'small'|'medium'|'large' */) {
    if (!app.isReady()) await app.whenReady();

    const first = prefToElectronSize(preferred || 'medium');
    const candidates = [first, 'normal', 'small', 'large'].filter(function (v, i, a) { return a.indexOf(v) === i; });

    for (let i = 0; i < candidates.length; i++) {
        const size = candidates[i];
        try {
            const img = await app.getFileIcon(p, { size });
            if (img && !img.isEmpty()) return img.toDataURL();
        } catch (e) { /* try next */ }
    }

    // Fallback: thumbnail
    const dim = preferred === 'large' ? 96 : preferred === 'small' ? 24 : 48;
    try {
        const thumb = await nativeImage.createThumbnailFromPath(p, { width: dim, height: dim });
        if (thumb && !thumb.isEmpty()) return thumb.toDataURL();
    } catch (e) {}

    return '';
}

/* ---------------- Favorites store & system folders ---------------- */

function storeFile() { return path.join(app.getPath('userData'), 'favorites.json'); }
function defaultStore() { return { setupCompleted: false, items: [] }; } // items: [{path,label,emoji}]

async function readStore() {
    try {
        const raw = await fsp.readFile(storeFile(), 'utf8');
        const parsed = JSON.parse(raw);
        return {
            setupCompleted: !!parsed.setupCompleted,
            items: Array.isArray(parsed.items) ? parsed.items : []
        };
    } catch (e) { return defaultStore(); }
}

async function writeStore(store) {
    const payload = { setupCompleted: !!store.setupCompleted, items: Array.isArray(store.items) ? store.items : [] };
    await fsp.mkdir(path.dirname(storeFile()), { recursive: true });
    await fsp.writeFile(storeFile(), JSON.stringify(payload, null, 2), 'utf8');
}

function favObj(p, emoji, label) { return { path: p, label: label || (path.basename(p) || p), emoji: emoji || '📁' }; }

function systemFolderDefs() {
    return [
        { key: 'desktop',   label: 'Desktop',   emoji: '🖥️', path: app.getPath('desktop')   },
        { key: 'downloads', label: 'Downloads', emoji: '⬇️', path: app.getPath('downloads') },
        { key: 'documents', label: 'Documents', emoji: '📄', path: app.getPath('documents') },
        { key: 'music',     label: 'Music',     emoji: '🎵', path: app.getPath('music')     },
        { key: 'pictures',  label: 'Pictures',  emoji: '🖼️', path: app.getPath('pictures')  },
        { key: 'videos',    label: 'Videos',    emoji: '🎬', path: app.getPath('videos')    },
    ];
}

async function systemFoldersWithExists() {
    const defs = systemFolderDefs();
    const out = [];
    for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        let exists = false;
        try { exists = (await fsp.stat(d.path)).isDirectory(); } catch (e) { exists = false; }
        out.push({ ...d, exists });
    }
    return out;
}

async function systemPathSet() {
    const defs = await systemFoldersWithExists();
    const s = new Set();
    for (let i = 0; i < defs.length; i++) if (defs[i].exists && defs[i].path) s.add(defs[i].path);
    return s;
}

function dedupeByPath(items) {
    const seen = Object.create(null), out = [];
    for (let i = 0; i < items.length; i++) {
        const p = items[i].path;
        if (!seen[p]) { seen[p] = 1; out.push(items[i]); }
    }
    return out;
}

/* ---------------- Favorites operations ---------------- */

async function loadFavorites() {
    const store = await readStore();
    return store.items;
}
async function addFavoritePath(folderPath, label, emoji) {
    let st;
    try { st = await fsp.stat(folderPath); } catch (e) { throw new Error('Only folders can be added to Favorites.'); }
    if (!st.isDirectory()) throw new Error('Only folders can be added to Favorites.');
    const store = await readStore();
    store.items = dedupeByPath(store.items.concat([favObj(folderPath, emoji, label)]));
    await writeStore(store);
    return store.items;
}
async function removeFavoritePath(folderPath) {
    const store = await readStore();
    store.items = store.items.filter(function (f) { return f.path !== folderPath; });
    await writeStore(store);
    return store.items;
}

function isValidBasename(name) {
    if (!name) return false;
    if (name === '.' || name === '..') return false;
    if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return false;
    return true;
}

async function renameFavoriteFolderOnDisk(oldPath, newBase) {
    const sysSet = await systemPathSet();
    if (sysSet.has(oldPath)) throw new Error('Cannot rename system folder.');
    let st;
    try { st = await fsp.stat(oldPath); } catch (e) { throw new Error('Path is not a folder.'); }
    if (!st.isDirectory()) throw new Error('Path is not a folder.');
    if (!isValidBasename(newBase)) throw new Error('Invalid name.');

    const parent = path.dirname(oldPath);
    const newPath = path.join(parent, newBase);
    if (fs.existsSync(newPath)) throw new Error('A file or folder with that name already exists.');

    await fsp.rename(oldPath, newPath);

    // Update store items
    const store = await readStore();
    for (let i = 0; i < store.items.length; i++) {
        if (store.items[i].path === oldPath) { store.items[i].path = newPath; store.items[i].label = newBase; }
    }
    await writeStore(store);
    return { items: store.items, newPath };
}

async function trashFavoriteFolderOnDisk(folderPath) {
    const sysSet = await systemPathSet();
    if (sysSet.has(folderPath)) throw new Error('Cannot delete system folder.');
    let st;
    try { st = await fsp.stat(folderPath); } catch (e) { throw new Error('Path is not a folder.'); }
    if (!st.isDirectory()) throw new Error('Path is not a folder.');

    await shell.trashItem(folderPath);

    const store = await readStore();
    store.items = store.items.filter(function (f) { return f.path !== folderPath; });
    await writeStore(store);
    return { items: store.items };
}

/* ---------------- Move (CUT/PASTE) ---------------- */

async function pathExists(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }

async function copyPath(src, dest) {
    const st = await fsp.stat(src);
    if (st.isDirectory()) {
        await fsp.mkdir(dest, { recursive: true });
        const entries = await fsp.readdir(src);
        for (let i = 0; i < entries.length; i++) {
            const name = entries[i];
            await copyPath(path.join(src, name), path.join(dest, name));
        }
    } else {
        await fsp.copyFile(src, dest);
    }
}
async function removePath(src) {
    await fsp.rm(src, { recursive: true, force: true });
}

async function moveIntoDir(srcPath, destDir) {
    const base = path.basename(srcPath);
    const destPath = path.join(destDir, base);
    if (await pathExists(destPath)) throw new Error('Destination already exists.');
    try {
        await fsp.rename(srcPath, destPath);
    } catch (e) {
        if (e && e.code === 'EXDEV') {
            await copyPath(srcPath, destPath);
            await removePath(srcPath);
        } else {
            throw e;
        }
    }
    return destPath;
}

/* ---------------- Unarchive (.zip / .7z) ---------------- */

function find7z() {
    const candidates = [
        '/opt/homebrew/bin/7z',
        '/opt/homebrew/bin/7za',
        '/usr/local/bin/7z',
        '/usr/local/bin/7za',
        '/usr/bin/7z',
        '/usr/bin/7za'
    ];
    for (let i = 0; i < candidates.length; i++) {
        try { if (fs.existsSync(candidates[i])) return candidates[i]; } catch (e) {}
    }
    return null;
}

function runCmd(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
            if (code === 0) resolve({ ok: true });
            else reject(new Error(stderr || (cmd + ' exited with code ' + code)));
        });
    });
}

async function extractArchive(archivePath, destDir) {
    const ext = path.extname(archivePath).toLowerCase();
    const baseName = path.basename(archivePath, ext);
    const outDir = destDir; // extract into current dir

    if (ext === '.zip') {
        // Use macOS 'ditto' (fast, built-in)
        await runCmd('/usr/bin/ditto', ['-x', '-k', archivePath, outDir], outDir);
        return { ok: true };
    }

    if (ext === '.7z' || ext === '.7zip') {
        const seven = find7z();
        if (!seven) {
            return { ok: false, error: '7z/7za not found. Install p7zip (e.g., `brew install p7zip`).' };
        }
        // 7z x <archive> -o<outDir> -y
        await runCmd(seven, ['x', archivePath, '-y', '-o' + outDir], outDir);
        return { ok: true };
    }

    return { ok: false, error: 'Unsupported archive type.' };
}

/* ---------------- First-run setup ---------------- */

async function getFavoritesState() { return await readStore(); }
async function completeSetupWithKeys(keys) {
    const defs = await systemFoldersWithExists();
    const map = Object.create(null);
    for (let i = 0; i < defs.length; i++) map[defs[i].key] = defs[i];

    const store = await readStore();
    const toAdd = [];
    for (let i = 0; i < keys.length; i++) {
        const def = map[keys[i]];
        if (def && def.exists) toAdd.push(favObj(def.path, def.emoji, def.label));
    }
    store.items = dedupeByPath(store.items.concat(toAdd));
    store.setupCompleted = true;
    await writeStore(store);
    return store;
}
async function skipSetup() {
    const store = await readStore();
    store.setupCompleted = true;
    await writeStore(store);
    return store;
}

/* ---------------- IPC ---------------- */

// File open
ipcMain.handle('open-path', async function (_e, fullPath) {
    try { const res = await shell.openPath(fullPath); return res || ''; }
    catch (err) { return (err && err.message) ? err.message : String(err); }
});

// Directory list
ipcMain.handle('list-dir', async function (_e, dirPath, preferred) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const results = [];

    for (let i = 0; i < entries.length; i++) {
        const d = entries[i];
        const p = path.join(dirPath, d.name);

        let stats = null;
        try { stats = await fsp.lstat(p); } catch (e) {}

        let iconDataUrl = '';
        try { iconDataUrl = await iconDataURLFor(p, preferred || 'medium'); } catch (e) {}

        const isDir = d.isDirectory();
        const ext = isDir ? '' : path.extname(d.name).slice(1);
        const type = isDir ? 'Folder' : (ext ? (ext.toUpperCase() + ' file') : 'File');

        results.push({
            name: d.name,
            path: p,
            isDir: isDir,
            iconDataUrl: iconDataUrl,
            sizeBytes: stats && stats.isFile() ? stats.size : null,
            mtimeMs: stats ? stats.mtimeMs : null,
            type: type,
            isHidden: d.name.charAt(0) === '.'
        });
    }

    results.sort(function (a, b) {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        return an < bn ? -1 : (an > bn ? 1 : 0);
    });

    return results;
});

// Favorites CRUD
ipcMain.handle('favorites-load', async function () { return await loadFavorites(); });
ipcMain.handle('favorites-remove', async function (_e, folderPath) { return await removeFavoritePath(folderPath); });
ipcMain.handle('favorites-add', async function (_e, folderPath, label, emoji) { return await addFavoritePath(folderPath, label, emoji); });

// Rename/Delete on disk for favorites
ipcMain.handle('favorites-rename', async function (_e, folderPath, newBase) {
    try { const out = await renameFavoriteFolderOnDisk(folderPath, newBase); return { ok: true, items: out.items, newPath: out.newPath }; }
    catch (err) { return { ok: false, error: (err && err.message) ? err.message : String(err) }; }
});
ipcMain.handle('trash-path', async function (_e, folderPath) {
    try { const out = await trashFavoriteFolderOnDisk(folderPath); return { ok: true, items: out.items }; }
    catch (err) { return { ok: false, error: (err && err.message) ? err.message : String(err) }; }
});

// Cut/Paste (move)
ipcMain.handle('move-path', async function (_e, srcPath, destDir) {
    try {
        const newPath = await moveIntoDir(srcPath, destDir);
        return { ok: true, newPath };
    } catch (err) {
        return { ok: false, error: (err && err.message) ? err.message : String(err) };
    }
});

// Unarchive
ipcMain.handle('extract-archive', async function (_e, archivePath, destDir) {
    try { const res = await extractArchive(archivePath, destDir); return res; }
    catch (err) { return { ok: false, error: (err && err.message) ? err.message : String(err) }; }
});

// First-run setup
ipcMain.handle('system-folders', async function () { return await systemFoldersWithExists(); });
ipcMain.handle('favorites-state', async function () { return await getFavoritesState(); });
ipcMain.handle('favorites-setup-complete', async function (_e, keys) { return await completeSetupWithKeys(Array.isArray(keys) ? keys : []); });
ipcMain.handle('favorites-setup-skip', async function () { return await skipSetup(); });
