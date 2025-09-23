document.addEventListener('DOMContentLoaded', function () {
    let sidebar     = document.getElementById('sidebar');
    let favsEl      = document.getElementById('favorites');
    let iconsView   = document.getElementById('iconsView');
    let iconsGrid   = document.getElementById('iconsGrid');
    let detailsView = document.getElementById('detailsView');
    let detailsBody = document.getElementById('detailsBody');
    let pathEl   = document.getElementById('pathInput');
    let viewEl   = document.getElementById('viewSelect');
    let goBtn    = document.getElementById('goBtn');
    let whereEl  = document.getElementById('where');
    let statusEl = document.getElementById('status');
    let bodyEl   = document.body;
    let optionsWrap   = document.getElementById('optionsWrap');
    let optionsBtn    = document.getElementById('optionsBtn');
    let optionsMenu   = document.getElementById('optionsMenu');
    let optShowHidden = document.getElementById('optShowHidden');
    let optShowExt    = document.getElementById('optShowExt');
    let overlay   = document.getElementById('setupOverlay');
    let sysListEl = document.getElementById('sysList');
    let setupNo   = document.getElementById('setupNo');
    let setupAdd  = document.getElementById('setupAdd');
    let home = '';
    let sep  = '/';
    let currentDir = '';
    let activeFavKey = null;
    let viewMode = viewEl.value;
    let favorites = [];
    let cutPath = null;
    let showHidden = false;
    let showExtensions = true;
    let systemPathSet = new Set();

    function parentDir(p) {
        if (!p) return p;
        let s = sep;
        let norm = (p.slice(-1) === s && p !== s) ? p.slice(0, -1) : p;
        let idx  = norm.lastIndexOf(s);
        if (idx <= 0) return s;
        return norm.slice(0, idx);
    }
    function setStatus(msg) { statusEl.textContent = msg || ''; }
    function setWhere(p)    { whereEl.textContent  = p || '';   }
    function setViewClasses() {
        bodyEl.classList.remove('icons-small', 'icons-medium');
        if (viewMode === 'small') bodyEl.classList.add('icons-small');
        else bodyEl.classList.add('icons-medium');
    }
    function showView(mode) {
        if (mode === 'details') { iconsView.style.display = 'none'; detailsView.style.display = 'block'; }
        else { detailsView.style.display = 'none'; iconsView.style.display = 'block'; setViewClasses(); }
    }
    function formatBytes(bytes) {
        if (bytes == null) return '';
        let k = 1024; if (Math.abs(bytes) < k) return bytes + ' B';
        let units = ['KB','MB','GB','TB','PB','EB'], u=-1;
        do { bytes/=k; ++u; } while (Math.abs(bytes)>=k && u<units.length-1);
        return (bytes>=10?bytes.toFixed(0):bytes.toFixed(1)) + ' ' + units[u];
    }
    function formatDate(ms) {
        if (!ms) return '';
        let d = new Date(ms);
        function pad(n){ n=String(n); return n.length<2 ? '0'+n : n; }
        return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
    }
    function displayName(name, isDir) {
        if (isDir || showExtensions) return name;
        if (name.startsWith('.')) return name;
        let idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(0, idx) : name;
    }
    function isValidNewName(n) {
        return !!n && n !== '.' && n !== '..' && !/[\/\\]/.test(n);
    }

    let ctxEl = null;
    let globalUnsubs = [];
    let openTimestamp = 0;

    function addGlobal(type, handler, opts) {
        document.addEventListener(type, handler, opts || false);
        globalUnsubs.push(function () { document.removeEventListener(type, handler, opts || false); });
    }
    function closeCtxMenu() {
        if (ctxEl && ctxEl.parentNode) ctxEl.parentNode.removeChild(ctxEl);
        ctxEl = null;
        while (globalUnsubs.length) { (globalUnsubs.pop())(); }
    }
    function createCtxMenu(items, x, y) {
        closeCtxMenu();
        if (!items || !items.length) return;
        let m = document.createElement('div'); m.className = 'ctx-menu';
        for (let i=0;i<items.length;i++){
            (function(it){
                let row = document.createElement('div');
                if (it.label==='—'||it.label==='-'){ row.className='ctx-sep'; m.appendChild(row); return; }
                row.className = 'ctx-item' + (it.disabled?' disabled':'');
                row.textContent = it.label;
                if (!it.disabled && it.onClick) row.addEventListener('click', function(){ closeCtxMenu(); it.onClick(); });
                m.appendChild(row);
            })(items[i]);
        }
        document.body.appendChild(m);
        let vw=innerWidth, vh=innerHeight, r=m.getBoundingClientRect();
        m.style.left = Math.min(x, Math.max(8, vw - r.width  - 8)) + 'px';
        m.style.top  = Math.min(y, Math.max(8, vh - r.height - 8)) + 'px';

        openTimestamp = Date.now();
        addGlobal('mousedown', function(e){ if (Date.now()-openTimestamp<50 && e.button===2) return; if (ctxEl && !ctxEl.contains(e.target)) closeCtxMenu(); }, true);
        addGlobal('keydown', function(e){ if (e.key==='Escape') closeCtxMenu(); });
        addGlobal('blur', closeCtxMenu);
        addGlobal('resize', closeCtxMenu);
        addGlobal('scroll', closeCtxMenu, true);

        ctxEl = m;
    }

    function renderFavorites() {
        favsEl.innerHTML = '';
        for (let i=0;i<favorites.length;i++){
            let fav = favorites[i];
            let li = document.createElement('li');
            li.className = 'fav' + (activeFavKey === fav.path ? ' active' : '');
            li.dataset.path = fav.path; li.dataset.label = fav.label || fav.path; li.dataset.emoji = fav.emoji || '📁';
            let ic = document.createElement('span'); ic.className='emoji'; ic.textContent = fav.emoji || '📁';
            let nm = document.createElement('span'); nm.textContent = fav.label || fav.path;
            li.appendChild(ic); li.appendChild(nm);
            (function(p){ li.addEventListener('click', function(){ navigateTo(p, p); }); })(fav.path);
            favsEl.appendChild(li);
        }
    }

    favsEl.addEventListener('contextmenu', function (e) {
        let li = e.target.closest && e.target.closest('li.fav'); if (!li) return; e.preventDefault();
        let favPath  = li.dataset.path;
        let favLabel = li.dataset.label || favPath;
        let favEmoji = li.dataset.emoji || '📁';
        let isSystem = (favEmoji === '🖥️' || favEmoji === '⬇️' || favEmoji === '📄' || favEmoji === '🎵' || favEmoji === '🖼️' || favEmoji === '🎬');

        let items = [];
        if (cutPath && cutPath !== favPath) {
            items.push({ label:'Paste into "'+favLabel+'"', onClick: async function(){ let r=await window.api.movePath(cutPath, favPath); if(!r||!r.ok){ alert(r&&r.error?r.error:'Move failed.'); return; } cutPath=null; if(currentDir===favPath) await renderDir(currentDir);} });
            items.push({ label:'—' });
        }
        items.push({
            label:'Rename…', disabled:isSystem, onClick: function(){
                let currentName = favLabel.split(sep).pop();
                let next = prompt('Rename folder to:', currentName);
                if(!isValidNewName(next)) return;
                window.api.renameFavorite(favPath, next).then(function (res) {
                    if (!res || !res.ok) { alert(res && res.error ? res.error : 'Rename failed.'); return; }
                    favorites = res.items || favorites; renderFavorites();
                    if (currentDir === favPath) navigateTo(res.newPath);
                });
            }
        });
        items.push({
            label:'Delete…', disabled:isSystem, onClick: function(){
                if(!confirm('Move this folder to Trash?')) return;
                window.api.trashPath(favPath).then(function (res) {
                    if (!res || !res.ok) { alert(res && res.error ? res.error : 'Delete failed.'); return; }
                    favorites = res.items || favorites; renderFavorites();
                    if (currentDir === favPath || (currentDir && currentDir.indexOf(favPath + sep) === 0)) navigateTo(parentDir(favPath));
                });
            }
        });
        items.push({ label:'Remove from Favorites', onClick: function(){ window.api.removeFavorite(favPath).then(function (items) { favorites = items || favorites; renderFavorites(); }); } });
        setTimeout(function(){ createCtxMenu(items, e.clientX, e.clientY); }, 0);
    });

    function setupFavoritesDnD() {
        sidebar.addEventListener('dragover', function (e) {
            let dt = e.dataTransfer;
            if (dt && dt.types && (dt.types.indexOf('text/x-path') >= 0 || dt.types.indexOf('text/plain') >= 0)) {
                e.preventDefault(); dt.dropEffect = 'copy'; sidebar.classList.add('dragover');
            }
        });
        sidebar.addEventListener('dragleave', function () { sidebar.classList.remove('dragover'); });
        sidebar.addEventListener('drop', async function (e) {
            e.preventDefault(); sidebar.classList.remove('dragover');
            let dt = e.dataTransfer; if (!dt) return;
            let droppedPath = dt.getData('text/x-path') || dt.getData('text/plain'); if (!droppedPath) return;
            try { let res = await window.api.addFavorite(droppedPath); favorites = res || favorites; renderFavorites(); }
            catch (err) { console.error('Add favorite failed:', err); }
        });
    }

    function makeTile(item) {
        let tile = document.createElement('div');
        tile.className = 'tile' + (item.isDir ? ' folder' : '');
        tile.title = item.name;
        tile.dataset.path = item.path;
        tile.dataset.name = item.name;
        tile.dataset.isDir = item.isDir ? '1' : '0';

        if (item.isDir) {
            tile.draggable = true;
            tile.addEventListener('dragstart', function (e) {
                if (!e.dataTransfer) return;
                e.dataTransfer.setData('text/x-path', item.path);
                e.dataTransfer.setData('text/plain', item.path);
                e.dataTransfer.effectAllowed = 'copy';
            });
        }

        let label = document.createElement('div');
        label.className = 'label'; label.textContent = displayName(item.name, !!item.isDir);

        if (item.iconDataUrl) {
            let img = document.createElement('img'); img.className='icon'; img.alt=''; img.decoding='async'; img.loading='lazy';
            img.src = item.iconDataUrl;
            img.onerror = function(){ img.remove(); let f=document.createElement('div'); f.className='icon fallback'; f.textContent=item.isDir?'📁':'📄'; tile.insertBefore(f,label); };
            tile.appendChild(img);
        } else {
            let f = document.createElement('div'); f.className='icon fallback'; f.textContent = item.isDir?'📁':'📄'; tile.appendChild(f);
        }
        tile.appendChild(label);

        tile.addEventListener('dblclick', function(){ if (item.isDir) navigateTo(item.path); else window.api.openPath(item.path); });
        tile.tabIndex = 0;
        tile.addEventListener('keydown', function(e){ if (e.key==='Enter'){ if(item.isDir) navigateTo(item.path); else window.api.openPath(item.path);} });

        return tile;
    }

    function addParentTile(dirPath) {
        if (!dirPath) return;
        if (dirPath === sep || dirPath === parentDir(dirPath)) return;
        let tile = document.createElement('div'); tile.className='tile'; tile.title='.. (Up one level)';
        let icon = document.createElement('div'); icon.className='icon fallback'; icon.textContent='↩︎';
        icon.style.display='flex'; icon.style.alignItems='center'; icon.style.justifyContent='center'; icon.style.fontWeight='600';
        let label = document.createElement('div'); label.className='label'; label.textContent='..';
        tile.appendChild(icon); tile.appendChild(label);
        tile.addEventListener('dblclick', function(){ navigateTo(parentDir(currentDir)); });
        iconsGrid.appendChild(tile);
    }

    function rowForItem(item) {
        let tr = document.createElement('tr');
        tr.dataset.path = item.path; tr.dataset.name = item.name; tr.dataset.isDir = item.isDir ? '1' : '0';

        let tdName = document.createElement('td'); tdName.className='col-name'; tdName.textContent = displayName(item.name, !!item.isDir); tdName.title=item.name;
        let tdType = document.createElement('td'); tdType.className='col-type'; tdType.textContent = item.type || (item.isDir?'Folder':'File');
        let tdSize = document.createElement('td'); tdSize.className='col-size'; tdSize.textContent = item.isDir ? '' : formatBytes(item.sizeBytes);
        let tdMod  = document.createElement('td'); tdMod.className='col-mod';  tdMod.textContent  = formatDate(item.mtimeMs);

        tr.addEventListener('dblclick', function(){ if (item.isDir) navigateTo(item.path); else window.api.openPath(item.path); });

        if (item.isDir) {
            tr.draggable = true;
            tr.addEventListener('dragstart', (function (it) {
                return function (e) { if (!e.dataTransfer) return; e.dataTransfer.setData('text/x-path', it.path); e.dataTransfer.setData('text/plain', it.path); e.dataTransfer.effectAllowed = 'copy'; };
            })(item));
        }

        tr.appendChild(tdName); tr.appendChild(tdType); tr.appendChild(tdSize); tr.appendChild(tdMod);
        return tr;
    }

    function isArchiveName(name) {
        let n = name.toLowerCase();
        return n.endsWith('.zip') || n.endsWith('.7z') || n.endsWith('.7zip');
    }

    async function compressSelected(paths) {
        if (!paths || !paths.length) return;
        let res = await window.api.compress(paths, currentDir);
        if (!res || !res.ok) { alert((res && res.error) ? res.error : 'Compress failed.'); return; }
        await renderDir(currentDir);
    }

    function itemContextMenu(e, pathStr, nameStr, isDir) {
        let isSystem = systemPathSet.has(pathStr);
        let alreadyFav = favorites.some(function (f) { return f && f.path === pathStr; });

        let items = [];

        items.push({ label: isDir ? 'Open Folder' : 'Open', onClick: function(){ if(isDir) navigateTo(pathStr); else window.api.openPath(pathStr); } });
        items.push({ label: 'Cut', onClick: function(){ cutPath = pathStr; } });

        items.push({
            label: 'Rename…',
            disabled: isSystem,
            onClick: async function () {
                let next = prompt('Rename "'+nameStr+'" to:', nameStr);
                if (!isValidNewName(next)) return;
                let res = await window.api.renamePath(pathStr, next);
                if (!res || !res.ok) { alert(res && res.error ? res.error : 'Rename failed.'); return; }
                if (res.favorites && Array.isArray(res.favorites)) { favorites = res.favorites; renderFavorites(); }
                await renderDir(currentDir);
            }
        });

        items.push({ label: 'Compress…', onClick: function(){ compressSelected([pathStr]); } });
        items.push({
            label: 'Add to Favorites',
            disabled: !isDir || alreadyFav,
            onClick: async function () {
                let res = await window.api.addFavorite(pathStr);
                if (res && res.ok === false) { alert(res.error || 'Failed to add favorite.'); return; }
                if (Array.isArray(res)) { favorites = res; renderFavorites(); }
            }
        });

        items.push({
            label: 'Move to Trash…',
            onClick: async function () {
                if (!confirm('Move "'+nameStr+'" to Trash?')) return;
                let res = await window.api.trashPath(pathStr);
                if (!res || !res.ok) { alert(res && res.error ? res.error : 'Move to Trash failed.'); return; }
                if (cutPath === pathStr) cutPath = null;
                await renderDir(currentDir);
            }
        });

        if (isDir && cutPath && cutPath !== pathStr) {
            items.push({ label: 'Paste into "'+nameStr+'"', onClick: async function(){ let r=await window.api.movePath(cutPath, pathStr); if(!r||!r.ok){ alert(r&&r.error?r.error:'Move failed.'); return; } cutPath=null; await renderDir(currentDir); } });
        }

        if (!isDir && isArchiveName(nameStr)) {
            items.push({ label: 'Unarchive Here', onClick: async function(){ let r=await window.api.extractArchive(pathStr, currentDir); if(!r||!r.ok){ alert(r&&r.error?r.error:'Unarchive failed.'); return; } await renderDir(currentDir); } });
        }

        e.preventDefault();
        setTimeout(function(){ createCtxMenu(items, e.clientX, e.clientY); }, 0);
    }

    function backgroundContextMenu(e) {
        let items = [{
            label: 'Paste Here',
            disabled: !(cutPath && currentDir),
            onClick: async function () {
                if (!(cutPath && currentDir)) return;
                let res = await window.api.movePath(cutPath, currentDir);
                if (!res || !res.ok) { alert(res && res.error ? res.error : 'Move failed.'); return; }
                cutPath = null; await renderDir(currentDir);
            }
        }];
        e.preventDefault();
        setTimeout(function(){ createCtxMenu(items, e.clientX, e.clientY); }, 0);
    }

    iconsGrid.addEventListener('contextmenu', function (e) {
        let tile = e.target.closest && e.target.closest('.tile');
        if (tile && tile.dataset && typeof tile.dataset.path !== 'undefined') {
            let isDir = tile.dataset.isDir === '1';
            let nm = tile.dataset.name || '';
            let p = tile.dataset.path;
            if (p) { itemContextMenu(e, p, nm, isDir); return; }
        }
        backgroundContextMenu(e);
    });
    iconsView.addEventListener('contextmenu', function (e) { if (e.target === iconsView) backgroundContextMenu(e); });

    detailsBody.addEventListener('contextmenu', function (e) {
        let tr = e.target.closest && e.target.closest('tr');
        if (tr && tr.dataset && tr.dataset.path) {
            let isDir = tr.dataset.isDir === '1';
            let nm = tr.dataset.name || '';
            let p = tr.dataset.path;
            itemContextMenu(e, p, nm, isDir);
        } else {
            backgroundContextMenu(e);
        }
    });
    detailsView.addEventListener('contextmenu', function (e) { if (e.target === detailsView) backgroundContextMenu(e); });

    async function renderDir(dirPath) {
        currentDir   = dirPath || '';
        pathEl.value = currentDir; setWhere(currentDir);

        if (!currentDir) {
            iconsGrid.innerHTML = ''; detailsBody.innerHTML = ''; showView(viewMode); setStatus('No directory loaded'); return;
        }

        setStatus('Loading…');
        let rows;
        try { rows = await window.api.listDir(currentDir, viewMode === 'details' ? 'medium' : viewMode); if (!Array.isArray(rows)) rows = []; }
        catch { rows = []; }

        let filtered = rows.filter(function (r) { return showHidden || !r.isHidden; });

        if (viewMode === 'details') {
            showView('details'); detailsBody.innerHTML = '';

            if (currentDir !== sep && currentDir !== parentDir(currentDir)) {
                let upTr = document.createElement('tr');
                let upName = document.createElement('td');
                upName.className = 'col-name'; upName.textContent = '↩︎  ..';
                upTr.addEventListener('dblclick', function () { navigateTo(parentDir(currentDir)); });
                upTr.appendChild(upName); upTr.appendChild(document.createElement('td')); upTr.appendChild(document.createElement('td')); upTr.appendChild(document.createElement('td'));
                detailsBody.appendChild(upTr);
            }

            for (let i = 0; i < filtered.length; i++) {
                detailsBody.appendChild(rowForItem(filtered[i]));
            }
        } else {
            showView(viewMode); iconsGrid.innerHTML = '';
            addParentTile(currentDir);
            for (let j = 0; j < filtered.length; j++) {
                iconsGrid.appendChild(makeTile(filtered[j]));
            }
        }

        setStatus(filtered.length + ' item' + (filtered.length === 1 ? '' : 's'));
    }

    async function navigateTo(dirPath, favKey) {
        if (favKey === void 0) favKey = null;
        activeFavKey = favKey; renderFavorites(); await renderDir(dirPath || home);
    }

    goBtn.addEventListener('click', function () { let t = (pathEl.value || '').trim(); navigateTo(t || home); });
    pathEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { let t = (pathEl.value || '').trim(); navigateTo(t || home); } });
    viewEl.addEventListener('change', async function () {
        viewMode = viewEl.value; if (viewMode !== 'details' && viewMode !== 'small' && viewMode !== 'medium') viewMode = 'medium';
        await renderDir(currentDir);
    });

    function setOptionsOpen(open) { if (open) optionsWrap.classList.add('open'); else optionsWrap.classList.remove('open'); }
    optionsBtn.addEventListener('click', function (e) { e.stopPropagation(); setOptionsOpen(!optionsWrap.classList.contains('open')); });
    document.addEventListener('click', function (e) { if (!optionsWrap.contains(e.target)) setOptionsOpen(false); });
    optShowHidden.addEventListener('change', async function () { await window.api.setPreferences({ showHidden: !!optShowHidden.checked }); });
    optShowExt.addEventListener('change', async function () { await window.api.setPreferences({ showExtensions: !!optShowExt.checked }); });
    window.api.onPrefsChanged(function (np) {
        showHidden = !!np.showHidden; showExtensions = !!np.showExtensions;
        optShowHidden.checked = showHidden; optShowExt.checked = showExtensions;
        renderDir(currentDir);
    });

    function renderSysOptions(list) {
        sysListEl.innerHTML = '';
        for (let i=0;i<list.length;i++){
            let it = list[i];
            let row = document.createElement('div'); row.className='sys-row';
            let cb = document.createElement('input'); cb.type='checkbox'; cb.id='sys_'+it.key; cb.value=it.key; cb.disabled=!it.exists;
            let lab = document.createElement('label'); lab.setAttribute('for', cb.id); lab.textContent = (it.emoji||'') + ' ' + it.label + (it.exists?'':' (not found)');
            row.appendChild(cb); row.appendChild(lab); sysListEl.appendChild(row);
        }
    }
    setupNo.addEventListener('click', async function () { await window.api.skipSetup(); overlay.classList.remove('show'); });
    setupAdd.addEventListener('click', async function () {
        let checks = sysListEl.querySelectorAll('input[type="checkbox"]');
        let keys = []; for (let i=0;i<checks.length;i++){ if (checks[i].checked && !checks[i].disabled) keys.push(checks[i].value); }
        let st = await window.api.completeSetup(keys);
        favorites = st && Array.isArray(st.items) ? st.items : favorites; renderFavorites(); overlay.classList.remove('show');
    });

    (async function init() {
        try {
            let prefs = await window.api.getPreferences();
            showHidden = !!prefs.showHidden; showExtensions = !!prefs.showExtensions;
            optShowHidden.checked = showHidden; optShowExt.checked = showExtensions;

            let h = await window.api.homedir();
            home = (typeof h === 'string') ? h : String(h || '');
            sep = home.indexOf('\\') >= 0 ? '\\' : '/';

            let state = await window.api.getFavoritesState();
            favorites = Array.isArray(state.items) ? state.items : []; renderFavorites();
            let sys = await window.api.getSystemFolders();
            if (Array.isArray(sys)) {
                for (let i=0;i<sys.length;i++){ if (sys[i].exists) systemPathSet.add(sys[i].path); }
            }

            if (!state.setupCompleted) {
                renderSysOptions(Array.isArray(sys) ? sys : []);
                overlay.classList.add('show');
            }

            setupFavoritesDnD();
            await navigateTo(home, null);
        } catch (err) {
            console.error('Init failed:', err);
            setStatus('Failed to initialize: ' + (err && err.message ? err.message : String(err)));
        }
    }());
});
