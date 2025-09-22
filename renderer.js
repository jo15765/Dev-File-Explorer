document.addEventListener('DOMContentLoaded', () => {
  const pathInput  = document.getElementById('path-input');
  const fileList   = document.getElementById('file-list');
  const favorites  = document.getElementById('favorites');
  const viewSelect = document.getElementById('view-select');
  const homeDir    = window.api.homedir();
  const join       = window.api.pathJoin;
  const existsDir  = window.api.existsDir;
  const readDir    = window.api.readDir;

  const basename = (p) => {
    if (!p) return '';
    return String(p).replace(/[\\\/]+$/, '').split(/[/\\]/).pop() || p;
  };

  const defaultFavorites = [
    join(homeDir, 'Downloads'),
    join(homeDir, 'Documents'),
  ];

  function addFavoriteLink(dirPath) {
    const li = document.createElement('li');
    li.className = 'favorite-item';

    const a = document.createElement('a');
    a.href = '#';
    a.textContent = basename(dirPath);
    a.title = dirPath;             // full path on hover
    a.dataset.path = dirPath;

    if (!existsDir(dirPath)) {
      a.classList.add('disabled');
    } else {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(dirPath);
      });
    }

    li.appendChild(a);
    favorites.appendChild(li);
  }

  function renderFavorites() {
    favorites.innerHTML = '';
    defaultFavorites.forEach(addFavoriteLink);

    const saved = JSON.parse(localStorage.getItem('favorites') || '[]');
    const defSet = new Set(defaultFavorites.map(String));
    saved.forEach((p) => {
      const abs = String(p || '');
      if (!defSet.has(abs)) addFavoriteLink(abs);
    });
  }

  let currentView = localStorage.getItem('fileView') || 'medium';
  if (viewSelect) {
    viewSelect.value = currentView;
    viewSelect.addEventListener('change', () => {
      currentView = viewSelect.value;
      localStorage.setItem('fileView', currentView);
      if (pathInput?.value) loadFiles(pathInput.value);
    });
  }

  async function loadFiles(dir) {
    try {
      if (!existsDir(dir)) throw new Error('Not a directory');
      if (pathInput) pathInput.value = dir;

      const entries = readDir(dir);
      entries.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      fileList.innerHTML = '';

      for (const entry of entries) {
        const full = join(dir, entry.name);
        const item = document.createElement('div');
        item.className = `file-item ${currentView}`;

        item.addEventListener('dblclick', () => {
          if (entry.isDir) navigateTo(full);
        });

        const img = document.createElement('img');
        img.alt = entry.isDir ? 'folder' : 'file';
        try {
          const dataUrl = await window.api.getFileIcon(full);
          if (dataUrl) img.src = dataUrl;
        } catch { /* leave unset */ }

        const label = document.createElement('div');
        label.className = 'file-name';
        label.textContent = entry.name;

        item.appendChild(img);
        item.appendChild(label);
        fileList.appendChild(item);
      }
    } catch (err) {
      console.error('loadFiles error:', err);
      fileList.innerHTML = `<div class="error">Unable to open: ${dir}</div>`;
    }
  }

  function navigateTo(dir) {
    loadFiles(dir);
  }

  if (pathInput) {
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const p = pathInput.value.trim();
        if (p) navigateTo(p);
      }
    });
  }

  renderFavorites();
  navigateTo(homeDir);
});
