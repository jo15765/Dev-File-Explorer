// preload.cjs — CommonJS preload
const { contextBridge, ipcRenderer } = require('electron');

function computeHome() {
    try { return require('node:os').homedir(); }
    catch (e) { if (process.platform === 'win32') return process.env.USERPROFILE || ''; return process.env.HOME || ''; }
}

contextBridge.exposeInMainWorld('api', {
    homedir: () => computeHome(),

    // Files / listing
    listDir: (dirPath, preferredIcon) => ipcRenderer.invoke('list-dir', dirPath, preferredIcon || 'medium'),

    // Open with OS
    openPath: (fullPath) => ipcRenderer.invoke('open-path', fullPath),

    // Favorites persistence
    loadFavorites:  () => ipcRenderer.invoke('favorites-load'),
    addFavorite:    (folderPath, label, emoji) => ipcRenderer.invoke('favorites-add', folderPath, label, emoji),
    removeFavorite: (folderPath) => ipcRenderer.invoke('favorites-remove', folderPath),

    // Favorites context actions
    renameFavorite: (folderPath, newBase) => ipcRenderer.invoke('favorites-rename', folderPath, newBase),
    trashPath:      (folderPath) => ipcRenderer.invoke('trash-path', folderPath),

    // Cut / Paste (move)
    movePath: (srcPath, destDir) => ipcRenderer.invoke('move-path', srcPath, destDir),

    // Unarchive
    extractArchive: (archivePath, destDir) => ipcRenderer.invoke('extract-archive', archivePath, destDir),

    // First-run setup
    getSystemFolders: () => ipcRenderer.invoke('system-folders'),
    getFavoritesState: () => ipcRenderer.invoke('favorites-state'),
    completeSetup: (keys) => ipcRenderer.invoke('favorites-setup-complete', keys),
    skipSetup: () => ipcRenderer.invoke('favorites-setup-skip'),
});
