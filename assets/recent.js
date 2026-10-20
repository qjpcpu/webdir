(() => {
  const listing = document.querySelector('.listing');
  const search = document.querySelector('#recent-search');
  const more = document.querySelector('#recent-more');
  const summary = document.querySelector('.summary');
  const status = document.querySelector('#recent-status');
  let cursor = more.dataset.cursor || null;
  let query = search.value.trim();
  let loading = false;
  let failed = false;
  let retryReset = false;
  let generation = 0;
  let controller;
  let timer;

  const formatTimes = () => {
    listing.querySelectorAll('[data-visited-at]').forEach(element => {
      const date = new Date(Number(element.dataset.visitedAt));
      element.dateTime = date.toISOString();
      element.textContent = date.toLocaleString();
    });
  };
  const update = () => {
    const count = listing.querySelectorAll('.entry').length;
    summary.textContent = `已显示 ${count} 个文件 · 按访问时间倒序`;
    more.hidden = !cursor;
    more.textContent = '加载更多';
    status.textContent = count && !cursor ? '已显示全部记录' : '';
  };
  const render = entries => {
    const fragment = document.createDocumentFragment();
    entries.forEach(entry => {
      const link = document.createElement('a');
      link.className = 'entry';
      link.href = entry.href;
      const icon = document.createElement('span');
      icon.className = 'glyph';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '↗';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name;
      const path = document.createElement('small');
      path.textContent = entry.path;
      name.append(path);
      const time = document.createElement('time');
      time.className = 'detail';
      time.dataset.visitedAt = entry.visited_at;
      link.append(icon, name, time);
      fragment.append(link);
    });
    listing.append(fragment);
    if (!listing.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.setAttribute('role', 'status');
      const message = document.createElement('p');
      message.textContent = query ? '没有匹配的访问记录' : '还没有最近访问的文件';
      empty.append(message);
      listing.append(empty);
    }
    formatTimes();
  };

  const load = async (reset = false) => {
    if (loading || (!reset && !cursor)) return;
    const request = ++generation;
    controller = new AbortController();
    loading = true;
    failed = false;
    retryReset = reset;
    more.disabled = true;
    listing.setAttribute('aria-busy', 'true');
    status.textContent = reset ? '正在搜索…' : '正在加载…';
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('mode', 'recent-entries');
    if (query) url.searchParams.set('q', query);
    if (!reset && cursor) url.searchParams.set('cursor', cursor);
    try {
      const response = await fetch(url, {signal: controller.signal, cache: 'no-store'});
      if (!response.ok) throw new Error('加载失败，请重试。');
      const page = await response.json();
      if (request !== generation) return;
      if (reset) listing.replaceChildren();
      render(page.entries);
      cursor = page.next_cursor;
      update();
    } catch (error) {
      if (request !== generation || error.name === 'AbortError') return;
      failed = true;
      status.textContent = '加载失败，请重试。';
      more.hidden = false;
      more.textContent = '重试';
    } finally {
      if (request === generation) {
        loading = false;
        more.disabled = false;
        listing.setAttribute('aria-busy', 'false');
      }
    }
  };

  search.addEventListener('input', () => {
    clearTimeout(timer);
    generation++;
    controller?.abort();
    loading = false;
    failed = false;
    query = search.value.trim();
    cursor = null;
    more.hidden = true;
    status.textContent = '正在搜索…';
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
    timer = setTimeout(() => load(true), 180);
  });
  more.addEventListener('click', () => load(failed && retryReset));
  new IntersectionObserver(entries => {
    if (!failed && entries.some(entry => entry.isIntersecting)) load();
  }).observe(more);
  formatTimes();
  update();
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
})();
