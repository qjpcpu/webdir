(() => {
  document.querySelector('#history-back')?.addEventListener('click', () => history.back());

  const breadcrumbs = document.querySelector('.file-breadcrumbs');
  if (breadcrumbs) {
    const links = Array.from(breadcrumbs.querySelectorAll('a'));
    links.forEach(link => { link.title = link.textContent; });
    const middle = links.slice(1, -1);
    const overflow = document.createElement('span');
    overflow.className = 'breadcrumb-overflow';
    overflow.hidden = true;
    overflow.innerHTML = '<span aria-hidden="true">/</span><details><summary aria-label="展开中间路径" title="展开中间路径">…</summary><div class="breadcrumb-menu"></div></details>';
    const menu = overflow.querySelector('.breadcrumb-menu');
    middle.forEach(link => menu.append(link.cloneNode(true)));
    const separators = middle.map(link => link.previousElementSibling);
    links[0].after(overflow);
    const details = overflow.querySelector('details');
    const fitBreadcrumbs = () => {
      details.open = false;
      overflow.hidden = true;
      middle.forEach((link, index) => { link.hidden = separators[index].hidden = false; });
      breadcrumbs.classList.add('measuring');
      const collapsed = middle.length > 0 && breadcrumbs.scrollWidth > breadcrumbs.clientWidth;
      middle.forEach((link, index) => { link.hidden = separators[index].hidden = collapsed; });
      overflow.hidden = !collapsed;
      breadcrumbs.classList.remove('measuring');
    };
    new ResizeObserver(fitBreadcrumbs).observe(breadcrumbs);
    fitBreadcrumbs();
    document.addEventListener('click', event => {
      if (!overflow.contains(event.target)) details.open = false;
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) {
        details.open = false;
        details.querySelector('summary').focus();
      }
    });
  }

  const pathSearch = document.querySelector('.path-search');
  if (pathSearch) {
    const toggle = pathSearch.querySelector('#path-search-toggle');
    const panel = pathSearch.querySelector('#path-search-panel');
    const input = pathSearch.querySelector('#path-search-input');
    const status = pathSearch.querySelector('#path-search-status');
    const results = pathSearch.querySelector('#path-search-results');
    const backdrop = document.createElement('div');
    backdrop.className = 'path-search-backdrop';
    backdrop.hidden = true;
    document.body.append(backdrop, panel);
    let timer;
    let requestId = 0;
    let selected = -1;
    const links = () => Array.from(results.querySelectorAll('.path-search-result'));
    const select = index => {
      const items = links();
      selected = items.length && index >= 0 ? Math.min(index, items.length - 1) : -1;
      items.forEach((item, itemIndex) => item.setAttribute('aria-selected', String(itemIndex === selected)));
      items[selected]?.scrollIntoView({block: 'nearest'});
    };
    const open = () => {
      clearTimeout(timer);
      requestId++;
      input.value = '';
      results.replaceChildren();
      status.textContent = '输入文件、文件夹名或路径开始搜索';
      backdrop.hidden = false;
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      input.focus();
    };
    const close = () => {
      backdrop.hidden = true;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      select(-1);
    };
    const render = items => {
      results.replaceChildren();
      selected = -1;
      status.textContent = items.length ? `${items.length} 个匹配结果` : '没有找到匹配的文件或文件夹';
      items.forEach(result => {
        const link = document.createElement('a');
        link.className = 'path-search-result';
        link.href = result.open_href;
        link.target = '_blank';
        link.role = 'option';
        link.setAttribute('aria-selected', 'false');
        const icon = document.createElement('span');
        icon.className = 'path-search-icon';
        if (result.is_dir) {
          icon.textContent = '目录';
        } else if (result.thumbnail_href) {
          const thumbnail = document.createElement('img');
          thumbnail.src = result.thumbnail_href;
          thumbnail.alt = '';
          thumbnail.loading = 'lazy';
          thumbnail.decoding = 'async';
          thumbnail.addEventListener('error', () => {
            thumbnail.remove();
            icon.textContent = 'IMG';
          });
          icon.append(thumbnail);
        } else {
          icon.textContent = result.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
        }
        const copy = document.createElement('span');
        copy.className = 'path-search-copy';
        const name = document.createElement('span');
        name.className = 'path-search-name';
        name.textContent = result.name;
        const path = document.createElement('span');
        path.className = 'path-search-path';
        path.textContent = `/${result.directory}`;
        copy.append(name, path);
        link.append(icon, copy);
        results.append(link);
      });
    };
    const search = async () => {
      const query = input.value.trim();
      const currentRequest = ++requestId;
      if (!query) {
        results.replaceChildren();
        status.textContent = '输入文件、文件夹名或路径开始搜索';
        return;
      }
      status.textContent = query.includes('/') ? '正在按路径搜索…' : '正在从根目录搜索…';
      try {
        const url = new URL(location.pathname, location.origin);
        url.searchParams.set('mode', 'file-search');
        url.searchParams.set('scope', 'root');
        url.searchParams.set('q', query);
        const response = await fetch(url);
        if (!response.ok) {
          const message = response.headers.get('content-type')?.startsWith('text/plain')
            ? (await response.text()).trim() : '';
          throw new Error(message || `搜索失败（HTTP ${response.status}）`);
        }
        const payload = await response.json();
        if (currentRequest !== requestId) return;
        if (payload.scope === 'directory') {
          close();
          return;
        }
        render(payload.results);
      } catch (error) {
        if (currentRequest !== requestId) return;
        results.replaceChildren();
        status.textContent = error.message;
      }
    };
    toggle.addEventListener('click', () => panel.hidden ? open() : close());
    input.addEventListener('input', () => {
      requestId++;
      clearTimeout(timer);
      timer = setTimeout(search, 220);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        select(selected < 0 ? (delta > 0 ? 0 : links().length - 1) : selected + delta);
      } else if (event.key === 'Enter' && selected >= 0) {
        event.preventDefault();
        links()[selected]?.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
        toggle.focus();
      }
    });
    document.addEventListener('click', event => {
      if (!pathSearch.contains(event.target) && !panel.contains(event.target)) close();
    });
  }

  let pendingCopy = null;
  let keyTimer;
  let toastTimer;
  let toast;

  const reset = () => {
    clearTimeout(keyTimer);
    pendingCopy = null;
  };

  const notify = message => {
    if (!toast) {
      toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.id = 'file-path-toast';
      toast.style.cssText = 'position:fixed;z-index:100;right:1rem;bottom:1rem;max-width:calc(100vw - 2rem);padding:.7rem .9rem;border:1px solid var(--line,#dfe3ee);border-radius:.55rem;color:var(--ink,#202333);background:var(--surface,#fff);box-shadow:0 10px 35px rgba(0,0,0,.16);font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere;pointer-events:none';
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };

  const copyText = (text, message) => {
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = Array.from({length: selection.rangeCount}, (_, index) => selection.getRangeAt(index).cloneRange());
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      field.remove();
      focused?.focus({preventScroll: true});
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
    notify(copied ? message : '复制失败，请检查浏览器剪贴板权限');
  };
  const copyName = path => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    copyText(name, `复制文件名 ${name}`);
  };

  const openReviewFile = document.querySelector('#open-review-file');
  if (openReviewFile) openReviewFile.href = `${location.pathname}.review.json`;
  const copyReviewFile = document.querySelector('#copy-review-path');
  if (copyReviewFile) {
    copyReviewFile.addEventListener('click', () => {
      copyName(`${document.body.dataset.filePath}.review.json`);
    });
  }

  document.addEventListener('keydown', event => {
    if (document.querySelector('#editor:not([hidden])')) {
      reset();
      return;
    }
    const target = event.target;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.repeat ||
        target.closest('input, textarea, select') || target.isContentEditable || document.querySelector('dialog[open]')) {
      reset();
      return;
    }
    if (event.key !== 'y') {
      reset();
      return;
    }
    const lightbox = document.querySelector('#image-lightbox:not([hidden])');
    const path = lightbox ? lightbox.dataset.filePath : document.body.dataset.filePath;
    const gallery = document.querySelector('.listing.gallery');
    const filter = document.querySelector('#image-filter')?.value;
    const copyGallery = !lightbox && gallery && filter && filter !== 'all';
    const names = copyGallery ? (window.webdirDirectory?.visibleImages() || []).map(entry => entry.name) : [];
    const key = copyGallery ? JSON.stringify([filter, names]) : path;
    if (!key) {
      reset();
      return;
    }
    event.preventDefault();
    if (pendingCopy === key) {
      reset();
      if (copyGallery) {
        if (names.length) copyText(names.join(','), `已复制 ${names.length} 个文件名`);
        else notify('没有可复制的图片');
      } else copyName(path);
    } else {
      reset();
      pendingCopy = key;
      keyTimer = setTimeout(reset, 500);
    }
  });
  window.addEventListener('blur', reset);
  document.addEventListener('gallery-filter-change', reset);
  document.querySelector('#gallery-toggle')?.addEventListener('click', reset);
})();
