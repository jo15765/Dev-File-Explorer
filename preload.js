const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FileIcon = require('file-icon');

contextBridge.exposeInMainWorld('api', {
    homedir: () => os.homedir(),
    pathJoin: (...parts) => path.join(...parts),
    existsDir: (p) => {
        try { return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory(); }
        catch { return false; }
    },
    readDir: (dir) => {
        try {
            return fs.readdirSync(dir, { withFileTypes: true }).map(d => ({
                name: d.name,
                isDir: d.isDirectory()
            }));
        } catch {
            return [];
        }
    },
    getFileIcon: async (filePath) => {
        try {
            const buf = await FileIcon.buffer(filePath, { size: 32 });
            return `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            return null;
        }
    }
});
