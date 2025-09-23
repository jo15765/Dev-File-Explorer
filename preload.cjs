'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    homedir: () => ipcRenderer.invoke('homedir'),
    openPath: (p) => ipcRenderer.invoke('open-path', p),
    listDir: (p, iconSize) => ipcRenderer.invoke('list-dir', p, iconSize),
    movePath: (src, destDir) => ipcRenderer.invoke('move-path', src, destDir),
    trashPath: (p) => ipcRenderer.invoke('trash-path', p),
    renamePath: (oldPath, nextName) => ipcRenderer.invoke('rename-path', oldPath, nextName), // NEW
    addFavorite: (p) => ipcRenderer.invoke('add-favorite', p),
    removeFavorite: (p) => ipcRenderer.invoke('remove-favorite', p),
    renameFavorite: (p, nextName) => ipcRenderer.invoke('rename-favorite', p, nextName),
    getFavoritesState: () => ipcRenderer.invoke('get-favorites-state'),
    getSystemFolders: () => ipcRenderer.invoke('get-system-folders'),
    completeSetup: (keys) => ipcRenderer.invoke('complete-setup', keys),
    skipSetup: () => ipcRenderer.invoke('skip-setup'),
    extractArchive: (archivePath, destDir) => ipcRenderer.invoke('extract-archive', archivePath, destDir),
    compress: (paths, destDir) => ipcRenderer.invoke('compress-paths', paths, destDir),
    getPreferences: () => ipcRenderer.invoke('get-preferences'),
    setPreferences: (patch) => ipcRenderer.invoke('set-preferences', patch),
    onPrefsChanged: (cb) => ipcRenderer.on('prefs-changed', (_e, prefs) => { try { cb && cb(prefs); } catch {} })
});
