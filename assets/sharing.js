(() => {
  const style = document.createElement('style');
  style.textContent = `
    .file-open { display:contents; color:inherit; text-decoration:none; }
    .share-button { flex:0 0 auto; padding:.45rem .65rem; border:1px solid var(--line); border-radius:.45rem; color:var(--muted); background:var(--surface); font:600 .72rem/1.3 system-ui; cursor:pointer; }
    .share-button:hover { color:var(--accent); border-color:var(--accent); }
    .share-icon { display:inline-flex; align-items:center; justify-content:center; width:2rem; height:2rem; padding:.35rem; }
    .share-icon svg { width:1.15rem; height:1.15rem; }
    .entry-actions { display:flex; align-items:center; justify-content:flex-end; gap:.25rem; grid-column:5; grid-row:1; }
    .entry-actions .folder-favourite-toggle { position:static; width:2rem; height:2rem; }
    .listing:not(.gallery) .entry { grid-template-columns:2.55rem minmax(0,1fr) 5rem 6rem 4.25rem; }
    .listing:not(.gallery) .entry .arrow { display:none; }
    .gallery .entry { position:relative; }
    .gallery .entry-actions { position:absolute; z-index:3; top:.5rem; right:.5rem; }
    .gallery .entry.image .entry-actions { display:none; }
    main > header h1 { display:flex; align-items:center; gap:.65rem; }
    @media (max-width:650px) {
      .listing:not(.gallery) .entry { grid-template-columns:2.4rem minmax(0,1fr) auto 4.25rem; gap:.55rem; }
      .listing:not(.gallery) .entry-actions { grid-column:4; }
    }
    .share-dialog { box-sizing:border-box; width:min(30rem,calc(100vw - 2rem)); padding:1.5rem; border:1px solid var(--line); border-radius:.85rem; color:var(--ink); background:var(--surface); font:14px/1.6 system-ui; }
    .share-dialog::backdrop { background:rgba(0,0,0,.4); }
    .share-dialog h2 { margin:0 0 .7rem; font-size:1.2rem; }
    .share-dialog p { overflow-wrap:anywhere; }
    .share-dialog input { box-sizing:border-box; width:100%; padding:.65rem; border:1px solid var(--line); border-radius:.4rem; color:var(--ink); background:var(--paper); font:inherit; }
    .share-dialog footer { display:flex; justify-content:flex-end; gap:.6rem; margin-top:1rem; }
  `;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'share-title');
  dialog.innerHTML = '<h2 id="share-title">分享链接</h2><p class="share-description"></p><label for="share-url">链接</label><input id="share-url" readonly><p class="share-status" role="status"></p><footer><button type="button" class="share-button" data-share-close>关闭</button><button type="button" class="share-button" data-share-copy disabled>复制链接</button></footer>';
  document.body.append(dialog);
  const field = dialog.querySelector('input');
  const status = dialog.querySelector('.share-status');
  const copy = dialog.querySelector('[data-share-copy]');
  dialog.querySelector('[data-share-close]').addEventListener('click', () => dialog.close());
  copy.addEventListener('click', () => {
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    status.textContent = copied ? '链接已复制' : '请选中上方链接手动复制';
  });
  let generation = 0;
  const openShare = async (path, directory) => {
    const current = ++generation;
    const target = new URL(path, location.href);
    const scope = directory ? target.pathname : target.pathname.slice(0, target.pathname.lastIndexOf('/') + 1);
    dialog.querySelector('.share-description').textContent = `${directory ? '分享此目录' : '包含所在目录'}及全部子目录：${decodeURIComponent(scope)}。接收者可浏览、编辑、评论及整理图片。链接长期有效。`;
    field.value = '';
    copy.disabled = true;
    status.textContent = '正在生成链接…';
    dialog.showModal();
    try {
      target.search = '?mode=share';
      const response = await fetch(target, {method:'POST'});
      if (!response.ok) throw new Error('无法生成分享链接，请使用主访问令牌登录后重试。');
      const result = await response.json();
      if (current !== generation) return;
      field.value = new URL(result.url, location.origin).href;
      copy.disabled = false;
      status.textContent = '链接已生成';
      copy.focus();
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    }
  };
  const button = (container, path, directory) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'share-button share-icon';
    element.setAttribute('aria-label', '复制分享链接');
    element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 4 7 6-7 6v-4c-5 0-8 2-11 6 1-7 4-10 11-10Z"/></svg>';
    element.title = directory ? '分享此目录及全部子目录' : '包含所在目录及全部子目录';
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openShare(path, directory);
    });
    container.append(element);
  };
  const listing = document.querySelector('.listing');
  if (listing) {
    button(document.querySelector('main > header h1'), location.pathname, true);
    listing.querySelectorAll('.entry').forEach(entry => {
      const link = entry.querySelector('.file-open, .folder-open');
      if (link) {
        const actions = document.createElement('div');
        actions.className = 'entry-actions';
        const favourite = entry.querySelector('.folder-favourite-toggle');
        if (favourite) actions.append(favourite);
        button(actions, link.href, entry.classList.contains('folder'));
        entry.append(actions);
      }
    });
  } else {
    const toolbar = document.querySelector('.top-actions') || document.querySelector('body > header');
    if (toolbar) button(toolbar, location.pathname, false);
  }
})();
