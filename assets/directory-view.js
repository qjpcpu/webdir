(() => {
  const listing = document.querySelector('.listing');
  listing.classList.toggle('gallery', document.body.classList.contains('gallery-mode'));
  const galleryToggle = document.querySelector('#gallery-toggle');
  document.querySelector('#select-images').hidden = !listing.classList.contains('gallery');
  if (listing.classList.contains('gallery')) {
    galleryToggle.setAttribute('aria-pressed', 'true');
    galleryToggle.innerHTML = '<span aria-hidden="true">☷</span> 列表';
  }
  const loading = document.querySelector('#directory-loading');
  const error = document.querySelector('#directory-load-error');
  const controls = [...document.querySelectorAll('.directory-browser-tools input, .directory-browser-tools select, #gallery-toggle, #gallery-organise button, #image-filter')];
  controls.forEach(control => { control.disabled = true; });
  window.directoryData = new Promise(resolve => {
    const load = async () => {
      loading.hidden = false;
      error.hidden = true;
      listing.setAttribute('aria-busy', 'true');
      try {
        const url = new URL(location.href);
        url.search = '?mode=directory-entries';
        const response = await fetch(url);
        if (!response.ok) throw new Error('目录加载失败，请重试。');
        const entries = await response.json();
        loading.hidden = true;
        listing.setAttribute('aria-busy', 'false');
        controls.forEach(control => { control.disabled = false; });
        resolve(entries);
      } catch (_) {
        loading.hidden = true;
        error.hidden = false;
        listing.setAttribute('aria-busy', 'false');
      }
    };
    document.querySelector('#directory-retry').addEventListener('click', load);
    load();
  });

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-.45 0-.85-.18-1.2-.5l-6.7-6.2C1.35 11.75 1.2 7.75 3.7 5.2 6.05 2.8 10 2.85 12 5.45c2-2.6 5.95-2.65 8.3-.25 2.5 2.55 2.35 6.55-.4 9.1l-6.7 6.2c-.35.32-.75.5-1.2.5Z"></path></svg>';

  window.DirectoryView = class {
    constructor(entries) {
      this.entries = entries;
      this.nodes = new Map();
      this.positions = [];
      this.byPath = new Map(entries.map(entry => [entry.filePath, entry]));
      this.frame = null;
      this.dirty = true;
      this.onMount = () => {};
      this.onUnmount = () => {};
      this.onRefresh = () => {};
      this.width = listing.clientWidth;
      addEventListener('scroll', () => this.schedule(), {passive: true});
      addEventListener('resize', () => this.schedule());
      new ResizeObserver(() => {
        if (listing.clientWidth === this.width) return;
        const top = listing.getBoundingClientRect().top;
        const anchor = this.positions.find(position => position.y + position.height + top > 0);
        this.resizeAnchor = anchor ? {entry: anchor.entry, offset: top + anchor.y, scroll: scrollY} : null;
        this.width = listing.clientWidth;
        this.schedule(true);
      }).observe(listing);
      listing.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const node = event.target.closest('.entry');
        const entry = this.fromNode(node);
        if (!entry) return;
        const controls = [...node.querySelectorAll('a[href],button:not(:disabled)')];
        if (node.matches('a[href]')) controls.unshift(node);
        if (event.target !== controls[event.shiftKey ? 0 : controls.length - 1]) return;
        const index = this.positions.findIndex(position => position.entry === entry);
        const next = this.positions[index + (event.shiftKey ? -1 : 1)];
        if (!next) return;
        event.preventDefault();
        this.focus(next.entry, false, event.shiftKey);
      });
    }

    fromNode(node) { return node ? this.byPath.get(node.dataset.filePath) : null; }
    nodeFor(entry) { return this.nodes.get(entry?.filePath); }
    visibleImages() { return this.entries.filter(entry => entry.isImage && !entry.hidden); }
    schedule(layout = false) {
      this.dirty ||= layout;
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    }
    refresh(entry) {
      const node = this.nodeFor(entry);
      if (!node) return;
      node.dataset.favourite = entry.favourite;
      node.dataset.imageTag = entry.imageTag;
      const link = node.querySelector('.file-open, .folder-open') || node;
      link.href = entry.isImage && listing.classList.contains('gallery') ? entry.galleryHref : entry.listHref;
      const mark = node.querySelector('.favourite-mark');
      if (mark) mark.hidden = entry.favourite !== 'true';
      const tag = node.querySelector('.image-tag');
      if (tag) {
        tag.hidden = !entry.imageTag;
        tag.textContent = entry.imageTag;
        tag.dataset.tag = entry.imageTag;
        tag.title = `标记${entry.imageTag}`;
      }
      this.onRefresh(node, entry);
    }
    remove(entry) {
      this.entries.splice(this.entries.indexOf(entry), 1);
      this.byPath.delete(entry.filePath);
      this.schedule(true);
    }
    focus(entry, preventScroll = false, last = false) {
      if (!entry || entry.hidden || !this.byPath.has(entry.filePath)) return;
      this.render();
      const position = this.positions.find(position => position.entry === entry);
      if (!position) return;
      const y = listing.getBoundingClientRect().top + position.y;
      if (!preventScroll && (y < 0 || y + position.height > innerHeight)) scrollBy(0, y - (innerHeight - position.height) / 2);
      this.render(entry);
      const node = this.nodeFor(entry);
      const controls = [...node.querySelectorAll('a[href],button:not(:disabled)')];
      if (node.matches('a[href]')) controls.unshift(node);
      controls[last ? controls.length - 1 : 0]?.focus({preventScroll: true});
    }
    create(entry) {
      const sharing = document.body.dataset.canShare === 'true';
      const node = document.createElement(entry.isDir || sharing ? 'div' : 'a');
      node.className = `entry ${entry.isDir ? 'folder' : 'file'}${entry.isImage ? ' image' : ''}${entry.vector ? ' vector' : ''}${entry.isVideo ? ' video' : ''}`;
      Object.assign(node.dataset, {filePath: entry.filePath, modified: entry.modified});
      if (entry.isImage) Object.assign(node.dataset, {previewSrc: entry.previewSrc, originalSrc: entry.originalSrc, listHref: entry.listHref, galleryHref: entry.galleryHref, fileSize: entry.fileSize});
      let glyph = '';
      if (entry.listSrc) glyph = `<img data-list-src="${escape(entry.listSrc)}" data-gallery-src="${escape(entry.gallerySrc)}" alt="" decoding="async" draggable="false">`;
      else if (entry.isVideo) glyph = '<svg viewBox="0 0 24 18"><rect x="1" y="1" width="22" height="16" rx="3"></rect><path d="m10 5.5 6 3.5-6 3.5Z"></path></svg>';
      if (entry.isImage) glyph += `<span class="favourite-mark" title="已点赞" hidden>${heart}</span><span class="image-tag" hidden></span>`;
      const content = `<span class="glyph" aria-hidden="true">${glyph}</span><span class="entry-name">${escape(entry.name)}</span><span class="kind">${escape(entry.kind)}</span><span class="detail">${escape(entry.fileSize)}</span><span class="arrow" aria-hidden="true">→</span>`;
      node.innerHTML = node.tagName === 'A' ? content : `<a class="${entry.isDir ? 'folder-open' : 'file-open'}">${content}</a>`;
      if (entry.isDir) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'folder-favourite-toggle';
        button.dataset.directoryFavouriteToggle = entry.listHref;
        button.setAttribute('aria-pressed', String(entry.directoryFavourite));
        button.textContent = entry.directoryFavourite ? '★' : '☆';
        button.title = entry.directoryFavourite ? '移出收藏夹' : '添加到收藏夹';
        button.setAttribute('aria-label', `${button.title}：${entry.name}`);
        node.append(button);
      }
      if (entry.isImage) {
        const indicator = document.createElement('span');
        indicator.className = 'image-selection-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        indicator.textContent = '✓';
        node.append(indicator);
      }
      const image = node.querySelector('.glyph img');
      image?.addEventListener('error', () => { image.hidden = true; image.closest('.glyph').classList.add('thumbnail-error'); });
      return node;
    }
    layout() {
      const restoreAnchor = this.resizeAnchor && Math.abs(scrollY - this.resizeAnchor.scroll) < 1;
      const gallery = listing.classList.contains('gallery');
      const style = getComputedStyle(listing);
      const padding = parseFloat(style.paddingLeft) || 0;
      const gap = gallery ? parseFloat(style.columnGap) : 0;
      const columns = gallery ? style.gridTemplateColumns.split(' ').length : 1;
      const width = (listing.clientWidth - padding * 2 - gap * (columns - 1)) / columns;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cardHeight = parseFloat(style.getPropertyValue('--directory-card-height')) * rem;
      const visible = this.entries.filter(entry => !entry.hidden);
      const groups = gallery ? [visible.filter(e => e.isDir), visible.filter(e => e.isImage), visible.filter(e => !e.isDir && !e.isImage)] : [visible];
      const heading = listing.querySelector('.gallery-other-heading');
      heading.hidden = true;
      let y = padding;
      this.positions = [];
      groups.forEach((entries, group) => {
        if (!entries.length) return;
        if (gallery && group === 2) {
          heading.hidden = false;
          Object.assign(heading.style, {top: `${y}px`, left: `${padding}px`, height: '64px'});
          y += 64;
        }
        const height = gallery ? (group === 1 ? width : cardHeight) : 4.25 * rem;
        entries.forEach((entry, index) => this.positions.push({entry, x: padding + (index % columns) * (width + gap), y: y + Math.floor(index / columns) * (height + gap), width, height}));
        y += Math.ceil(entries.length / columns) * (height + gap);
      });
      listing.classList.toggle('virtual-directory', visible.length > 0);
      listing.style.height = visible.length ? `${y + padding - gap}px` : '';
      this.dirty = false;
      if (this.resizeAnchor) {
        const {entry, offset} = this.resizeAnchor;
        this.resizeAnchor = null;
        const next = this.positions.find(position => position.entry === entry);
        if (restoreAnchor && next) scrollTo(scrollX, listing.getBoundingClientRect().top + scrollY + next.y - offset);
      }
    }
    render(focusEntry) {
      if (this.dirty) this.layout();
      const top = listing.getBoundingClientRect().top;
      const minimum = -top - innerHeight;
      const maximum = -top + innerHeight * 2;
      // Positions are ordered by row; find the first overlapping row without visiting every file.
      let low = 0, high = this.positions.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const position = this.positions[middle];
        if (position.y + position.height < minimum) low = middle + 1;
        else high = middle;
      }
      const wanted = new Map();
      for (let index = low; index < this.positions.length; index++) {
        const position = this.positions[index];
        if (position.y > maximum) break;
        wanted.set(position.entry.filePath, position);
      }
      const focused = focusEntry || this.fromNode(document.activeElement?.closest('.entry'));
      if (focused) {
        const position = this.positions.find(p => p.entry === focused);
        if (position) wanted.set(focused.filePath, position);
      }
      for (const [path, node] of this.nodes) {
        if (wanted.has(path)) continue;
        this.onUnmount(node);
        node.remove();
        this.nodes.delete(path);
      }
      const fragment = document.createDocumentFragment();
      const mounted = [];
      for (const {entry, x, y, width, height} of wanted.values()) {
        let node = this.nodeFor(entry);
        if (!node) {
          node = this.create(entry);
          this.nodes.set(entry.filePath, node);
          fragment.append(node);
          mounted.push([node, entry]);
        }
        Object.assign(node.style, {top: `${y}px`, left: `${x}px`, width: `${width}px`, height: `${height}px`});
        this.refresh(entry);
      }
      listing.append(fragment);
      // Keep DOM traversal in visual order after sorting and upward scrolling.
      const ordered = [...wanted.values()].sort((a, b) => a.y - b.y || a.x - b.x);
      let previous = listing.querySelector('#directory-empty');
      for (const {entry} of ordered) {
        const node = this.nodeFor(entry);
        if (previous.nextSibling !== node) previous.after(node);
        previous = node;
      }
      for (const [node, entry] of mounted) {
        this.onMount(node, entry);
        document.dispatchEvent(new CustomEvent('directory-entry-mounted', {detail: {node, entry}}));
      }
    }
  };
})();
