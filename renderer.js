// renderer.js — browser code (fixed straight quotes)
document.addEventListener('DOMContentLoaded', function () {
  var sidebar     = document.getElementById('sidebar');
  var favsEl      = document.getElementById('favorites');
  var iconsView   = document.getElementById('iconsView');
  var iconsGrid   = document.getElementById('iconsGrid');
  var detailsView = document.getElementById('detailsView');
  var detailsBody = document.getElementById('detailsBody');

  var pathEl   = document.getElementById('pathInput');
  var viewEl   = document.getElementById('viewSelect');
  var goBtn    = document.getElementById('goBtn');
  var whereEl  = document.getElementById('where');
  var statusEl = document.getElementById('status');
  var bodyEl   = document.body;

  // First-run modal
  var overlay   = document.getElementById('setupOverlay');
  var sysListEl = document.getElementById('sysList');
  var setupNo   = document.getElementById('setupNo');
  var setupAdd  = document.getElementById('setupAdd');

  var home = window.api.homedir();
  var sep  = home.indexOf('\\') >= 0 ? '\\' : '/';

  // Auto-load home on start
  var currentDir = home;
  var activeFavKey = null;
  var viewMode = viewEl.value; // 'small'|'medium'|'large'|'details'
  var favorites = []; // loaded from disk

  // CUT clipboard
  var cutPath = null;

  /* ---------------- Helpers ---------------- */

  function parentDir(p) {
    if (!p) return p;
    var norm = (p.slice(-1) === sep && p !== sep) ? p.slice(0, -1) : p;
    var idx  = norm.lastIndexOf(sep);
    if (idx <= 0) return sep;
    return norm.slice(0, idx);
  }
  function setStatus(msg) { statusEl.textContent = msg || ''; }
  function setWhere(p)    { whereEl.textContent  = p || '';   }

  function setViewClasses() {
    bodyEl.classList.remove('icons-small', 'icons-medium', 'icons-large');
    if (viewMode !== 'details') {
      bodyEl.classList.add(viewMode === 'small' ? 'icons-small' : (viewMode === 'large' ? 'icons-large' : 'icons-medium'));
    }
  }
  function showView(mode) {
    if (mode === 'details') {
      iconsView.style.display = 'none';
      detailsView.style.display = 'block';
    } else {
      detailsView.style.display = 'none';
      iconsView.style.display = 'block';
      setViewClasses();
    }
  }

  function formatBytes(bytes) {
    if (bytes == null) return '';
    var k = 1024;
    if (Math.abs(bytes) < k) return bytes + ' B';
    var units = ['KB','MB','GB','TB','PB','EB'];
    var u = -1;
    do { bytes /= k; ++u; } while (Math.abs(bytes) >= k && u < units.length - 1);
    return (bytes >= 10 ? bytes.toFixed(0) : bytes.toFixed(1)) + ' ' + units[u];
  }
  function formatDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- Generic Context Menu helpers ---------------- */

  var ctxEl = null;
  function closeCtxMenu() { if (ctxEl && ctxEl.parentNode) ctxEl.parentNode.removeChild(ctxEl); ctxEl = null; }
  function createCtxMenu(items, x, y) {
    closeCtxMenu();
    var m = document.createElement('div');
    m.className = 'ctx-menu';
    for (var i = 0; i < items.length; i++) {
      (function (it) {
        var row = document.createElement('div');
        row.className = 'ctx-item' + (it.disabled ? ' disabled' : '');
        row.textContent = it.label;
        if (!it.disabled) row.addEventListener('click', function () { closeCtxMenu(); it.onClick && it.onClick(); });
        m.appendChild(row);
      })(items[i]);
    }
    document.body.appendChild(m);
    var vw = window.innerWidth, vh = window.innerHeight;
    var rect = m.getBoundingClientRect();
    var nx = Math.min(x, vw - rect.width - 8);
    var ny = Math.min(y, vh - rect.height - 8);
    m.style.left = nx + 'px'; m.style.top = ny + 'px';
    setTimeout(function () {
      document.addEventListener('click', closeCtxMenu, { once: true });
      document.addEventListener('contextmenu', closeCtxMenu, { once: true });
      window.addEventListener('blur', closeCtxMenu, { once: true });
      window.addEventListener('resize', closeCtxMenu, { once: true });
      document.addEventListener('keydown', function esc(e){ if (e.key === 'Escape') closeCtxMenu(); }, { once: true });
    }, 0);
    ctxEl = m;
  }

  /* ---------------- Favorites UI & context ---------------- */

  function renderFavorites() {
    favsEl.innerHTML = '';
    for (var i = 0; i < favorites.length; i++) {
      var fav = favorites[i];
      var li = document.createElement('li');
      li.className = 'fav' + (activeFavKey === fav.path ? ' active' : '');
      li.dataset.path = fav.path;
      li.dataset.label = fav.label || fav.path;
      li.dataset.emoji = fav.emoji || '📁';

      var ic = document.createElement('span'); ic.className = 'emoji'; ic.textContent = fav.emoji || '📁';
      var nm = document.createElement('span'); nm.textContent = fav.label || fav.path;

      li.appendChild(ic); li.appendChild(nm);
      (function (p) { li.addEventListener('click', function () { navigateTo(p, p); }); })(fav.path);
      favsEl.appendChild(li);
    }
  }

  favsEl.addEventListener('contextmenu', function (e) {
    var li = e.target.closest && e.target.closest('li.fav');
    if (!li) return; // only on existing favorite
    e.preventDefault();

    var favPath = li.dataset.path;
    var favEmoji = li.dataset.emoji || '📁';
    var isSystem = (favEmoji === '🖥️' || favEmoji === '⬇️' || favEmoji === '📄' || favEmoji === '🎵' || favEmoji === '🖼️' || favEmoji === '🎬');

    var items = [
      {
        label: 'Rename…',
        disabled: isSystem,
        onClick: function () {
          var currentName = (li.dataset.label || favPath).split(sep).pop();
          var next = window.prompt('Rename folder to:', currentName);
          if (!next || next === currentName) return;
          if (next.indexOf('/') >= 0 || next.indexOf('\\') >= 0 || next === '.' || next === '..') { window.alert('Invalid name.'); return; }
          window.api.renameFavorite(favPath, next).then(function (res) {
            if (!res || !res.ok) { window.alert(res && res.error ? res.error : 'Rename failed.'); return; }
            favorites = res.items || favorites; renderFavorites();
            if (currentDir === favPath) navigateTo(res.newPath);
          });
        }
      },
      {
        label: 'Delete…',
        disabled: isSystem,
        onClick: function () {
          var ok = window.confirm('Move this folder to Trash?'); if (!ok) return;
          window.api.trashPath(favPath).then(function (res) {
            if (!res || !res.ok) { window.alert(res && res.error ? res.error : 'Delete failed.'); return; }
            favorites = res.items || favorites; renderFavorites();
            if (currentDir === favPath || (currentDir && currentDir.indexOf(favPath + sep) === 0)) navigateTo(parentDir(favPath));
          });
        }
      },
      {
        label: 'Remove from Favorites',
        disabled: false,
        onClick: function () {
          window.api.removeFavorite(favPath).then(function (items) { favorites = items || favorites; renderFavorites(); });
        }
      }
    ];

    createCtxMenu(items, e.clientX, e.clientY);
  });

  /* ---------------- Drag-to-Favorites ---------------- */

  function setupFavoritesDnD() {
    sidebar.addEventListener('dragover', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.types && (dt.types.indexOf('text/x-path') >= 0 || dt.types.indexOf('text/plain') >= 0)) {
        e.preventDefault(); dt.dropEffect = 'copy'; sidebar.classList.add('dragover');
      }
    });
    sidebar.addEventListener('dragleave', function () { sidebar.classList.remove('dragover'); });
    sidebar.addEventListener('drop', async function (e) {
      e.preventDefault(); sidebar.classList.remove('dragover');
      var dt = e.dataTransfer; if (!dt) return;
      var droppedPath = dt.getData('text/x-path') || dt.getData('text/plain'); if (!droppedPath) return;
      try { var res = await window.api.addFavorite(droppedPath); favorites = res || favorites; renderFavorites(); }
      catch (err) { console.error('Add favorite failed:', err); }
    });
  }

  /* ---------------- File list rendering + context ---------------- */

  function makeTile(item) {
    var tile = document.createElement('div');
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

    var img = document.createElement('img');
    img.className = 'icon'; img.alt = ''; img.src = item.iconDataUrl || '';

    var label = document.createElement('div');
    label.className = 'label'; label.textContent = item.name;

    tile.appendChild(img); tile.appendChild(label);

    tile.addEventListener('click', function () { if (item.isDir) navigateTo(item.path); else window.api.openPath(item.path); });

    tile.tabIndex = 0;
    tile.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { if (item.isDir) navigateTo(item.path); else window.api.openPath(item.path); }
    });

    return tile;
  }

  function addParentTile(dirPath) {
    if (!dirPath) return;
    if (dirPath === sep || dirPath === parentDir(dirPath)) return;
    var tile = document.createElement('div');
    tile.className = 'tile'; tile.title = '.. (Up one level)';

    var icon = document.createElement('div');
    icon.className = 'icon'; icon.textContent = '↩︎';
    icon.style.display = 'flex'; icon.style.alignItems = 'center'; icon.style.justifyContent = 'center'; icon.style.fontWeight = '600';

    var label = document.createElement('div');
    label.className = 'label'; label.textContent = '..';

    tile.appendChild(icon); tile.appendChild(label);
    tile.addEventListener('click', function () { navigateTo(parentDir(currentDir)); });
    iconsGrid.appendChild(tile);
  }

  function rowForItem(item) {
    var tr = document.createElement('tr');
    tr.dataset.path = item.path; tr.dataset.name = item.name; tr.dataset.isDir = item.isDir ? '1' : '0';

    var tdName = document.createElement('td');
    tdName.className = 'col-name'; tdName.textContent = item.name; tdName.title = item.name; tdName.style.cursor = 'pointer';
    tdName.addEventListener('click', (function (it) { return function () { if (it.isDir) navigateTo(it.path); else window.api.openPath(it.path); }; })(item));

    var tdType = document.createElement('td'); tdType.className = 'col-type'; tdType.textContent = item.type || (item.isDir ? 'Folder' : 'File');
    var tdSize = document.createElement('td'); tdSize.className = 'col-size'; tdSize.textContent = item.isDir ? '' : formatBytes(item.sizeBytes);
    var tdMod  = document.createElement('td'); tdMod.className  = 'col-mod';  tdMod.textContent  = formatDate(item.mtimeMs);

    if (item.isDir) {
      tr.draggable = true;
      tr.addEventListener('dragstart', (function (it) {
        return function (e) {
          if (!e.dataTransfer) return;
          e.dataTransfer.setData('text/x-path', it.path);
          e.dataTransfer.setData('text/plain', it.path);
          e.dataTransfer.effectAllowed = 'copy';
        };
      })(item));
    }

    tr.appendChild(tdName); tr.appendChild(tdType); tr.appendChild(tdSize); tr.appendChild(tdMod);
    return tr;
  }

  function isArchiveName(name) {
    var n = name.toLowerCase();
    return n.endsWith('.zip') || n.endsWith('.7z') || n.endsWith('.7zip');
  }

  function itemContextMenu(e, pathStr, nameStr, isDir) {
    var items = [];

    // Open
    items.push({
      label: isDir ? 'Open Folder' : 'Open',
      onClick: function () { if (isDir) navigateTo(pathStr); else window.api.openPath(pathStr); }
    });

    // Cut
    items.push({
      label: 'Cut',
      onClick: function () { cutPath = pathStr; }
    });

    // Paste into (if folder & cut exists)
    if (isDir && cutPath && cutPath !== pathStr) {
      items.push({
        // FIX: use straight quotes and concatenation
        label: 'Paste into "' + nameStr + '"',
        onClick: async function () {
          var res = await window.api.movePath(cutPath, pathStr);
          if (!res || !res.ok) { window.alert(res && res.error ? res.error : 'Move failed.'); return; }
          cutPath = null; // clear
          await renderDir(currentDir);
        }
      });
    }

    // Unarchive
    if (!isDir && isArchiveName(nameStr)) {
      items.push({
        label: 'Unarchive Here',
        onClick: async function () {
          var res = await window.api.extractArchive(pathStr, currentDir);
          if (!res || !res.ok) { window.alert(res && res.error ? res.error : 'Unarchive failed.'); return; }
          await renderDir(currentDir);
        }
      });
    }

    createCtxMenu(items, e.clientX, e.clientY);
  }

  function backgroundContextMenu(e) {
    var items = [];
    if (cutPath && currentDir) {
      items.push({
        label: 'Paste Here',
        onClick: async function () {
          var res = await window.api.movePath(cutPath, currentDir);
          if (!res || !res.ok) { window.alert(res && res.error ? res.error : 'Move failed.'); return; }
          cutPath = null; await renderDir(currentDir);
        }
      });
    }
    if (items.length) createCtxMenu(items, e.clientX, e.clientY);
  }

  // Icons view context menu
  iconsGrid.addEventListener('contextmenu', function (e) {
    var tile = e.target.closest && e.target.closest('.tile');
    if (tile && tile.dataset && typeof tile.dataset.path !== 'undefined') {
      var isDir = tile.dataset.isDir === '1';
      var nm = tile.dataset.name || '';
      var p = tile.dataset.path;
      // parent ".." tile has empty dataset.path; in that case fall back to background menu
      if (p) { e.preventDefault(); itemContextMenu(e, p, nm, isDir); return; }
    }
    e.preventDefault(); backgroundContextMenu(e);
  });

  // Details view context menu
  detailsBody.addEventListener('contextmenu', function (e) {
    var tr = e.target.closest && e.target.closest('tr');
    if (tr && tr.dataset && tr.dataset.path) {
      var isDir = tr.dataset.isDir === '1';
      var nm = tr.dataset.name || '';
      var p = tr.dataset.path;
      e.preventDefault(); itemContextMenu(e, p, nm, isDir);
    } else {
      e.preventDefault(); backgroundContextMenu(e);
    }
  });

  /* ---------------- Render directory ---------------- */

  async function renderDir(dirPath) {
    currentDir   = dirPath || '';
    pathEl.value = currentDir;
    setWhere(currentDir);

    if (!currentDir) {
      iconsGrid.innerHTML = ''; detailsBody.innerHTML = ''; showView(viewMode); setStatus('No directory loaded'); return;
    }

    setStatus('Loading…');
    var rows;
    try { rows = await window.api.listDir(currentDir, viewMode === 'details' ? 'medium' : viewMode); if (!Array.isArray(rows)) rows = []; }
    catch (e) { rows = []; }

    var visibleRows = (viewMode === 'details') ? rows : rows.filter(function (r) { return !r.isHidden; });

    if (viewMode === 'details') {
      showView('details'); detailsBody.innerHTML = '';

      if (currentDir !== sep && currentDir !== parentDir(currentDir)) {
        var upTr = document.createElement('tr');
        var upName = document.createElement('td');
        upName.className = 'col-name'; upName.textContent = '↩︎  ..'; upName.style.cursor = 'pointer';
        upName.addEventListener('click', function () { navigateTo(parentDir(currentDir)); });
        upTr.appendChild(upName); upTr.appendChild(document.createElement('td')); upTr.appendChild(document.createElement('td')); upTr.appendChild(document.createElement('td'));
        detailsBody.appendChild(upTr);
      }

      for (var i = 0; i < rows.length; i++) {
        detailsBody.appendChild(rowForItem(rows[i]));
      }
    } else {
      showView(viewMode); iconsGrid.innerHTML = '';
      addParentTile(currentDir);
      for (var j = 0; j < visibleRows.length; j++) {
        iconsGrid.appendChild(makeTile(visibleRows[j]));
      }
    }

    setStatus(visibleRows.length + ' item' + (visibleRows.length === 1 ? '' : 's'));
  }

  async function navigateTo(dirPath, favKey) {
    if (favKey === void 0) favKey = null;
    activeFavKey = favKey; renderFavorites(); await renderDir(dirPath || home);
  }

  /* ---------------- Controls ---------------- */

  goBtn.addEventListener('click', function () {
    var target = (pathEl.value || '').trim(); navigateTo(target || home);
  });
  pathEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var t = (pathEl.value || '').trim(); navigateTo(t || home); }
  });
  viewEl.addEventListener('change', async function () { viewMode = viewEl.value; await renderDir(currentDir); });

  /* ---------------- First-run setup modal ---------------- */

  function renderSysOptions(list) {
    sysListEl.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var row = document.createElement('div'); row.className = 'sys-row';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'sys_' + it.key; cb.value = it.key; cb.disabled = !it.exists;
      var lab = document.createElement('label'); lab.setAttribute('for', cb.id); lab.textContent = (it.emoji || '') + ' ' + it.label + (it.exists ? '' : ' (not found)');
      row.appendChild(cb); row.appendChild(lab); sysListEl.appendChild(row);
    }
  }

  setupNo.addEventListener('click', async function () { await window.api.skipSetup(); overlay.classList.remove('show'); });
  setupAdd.addEventListener('click', async function () {
    var checks = sysListEl.querySelectorAll('input[type="checkbox"]');
    var keys = []; for (var i = 0; i < checks.length; i++) { if (checks[i].checked && !checks[i].disabled) keys.push(checks[i].value); }
    var st = await window.api.completeSetup(keys);
    favorites = st && Array.isArray(st.items) ? st.items : favorites; renderFavorites(); overlay.classList.remove('show');
  });

  /* ---------------- Init ---------------- */

  (async function init() {
    var state = await window.api.getFavoritesState(); // {setupCompleted, items}
    favorites = Array.isArray(state.items) ? state.items : []; renderFavorites();

    // Show setup modal once
    if (!state.setupCompleted) {
      var sys = await window.api.getSystemFolders();
      renderSysOptions(Array.isArray(sys) ? sys : []);
      overlay.classList.add('show');
    }

    setupFavoritesDnD();

    // Auto-load home on start
    await navigateTo(home, null);
  }());
});
