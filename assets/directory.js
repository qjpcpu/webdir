(async () => {
const directoryEntries = await window.directoryData;
history.scrollRestoration = 'manual';
window.addEventListener('beforeunload', () => {
  history.replaceState({...history.state, scrollX, scrollY}, '');
});

const fileSearchInput = document.querySelector('#file-search-input');
const directoryNotice = document.querySelector('#directory-notice');
const directoryFavouriteToggle = document.querySelector('#directory-favourite-toggle');
const favouritePathname = path => new URL(path, location.origin).pathname;
const favouriteLabel = path => {
  const parts = favouritePathname(path).split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts.join('/') : 'root';
};
const createDirectoryFavouriteItem = path => {
  const item = document.createElement('span');
  item.className = 'directory-favourite';
  item.dataset.directoryFavouritePath = favouritePathname(path);
  item.draggable = true;
  const link = document.createElement('a');
  link.href = path;
  const parts = favouritePathname(path).split('/').filter(Boolean).map(decodeURIComponent);
  const label = parts.length ? parts.join('/') : 'root';
  link.title = label;
  if (parts.length > 1) {
    const prefix = document.createElement('span');
    prefix.className = 'directory-favourite-prefix';
    prefix.textContent = parts.slice(0, -1).join('/');
    const separator = document.createElement('span');
    separator.className = 'directory-favourite-separator';
    separator.textContent = '/';
    const leaf = document.createElement('span');
    leaf.className = 'directory-favourite-leaf';
    leaf.textContent = parts.at(-1);
    link.append(prefix, separator, leaf);
  } else {
    link.textContent = label;
  }
  if (favouritePathname(path) === location.pathname) link.setAttribute('aria-current', 'page');
  const drag = document.createElement('button');
  drag.className = 'directory-favourite-drag';
  drag.type = 'button';
  drag.setAttribute('aria-label', `拖动排序：${label}`);
  drag.title = '拖动排序';
  drag.textContent = '⠿';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.directoryFavouriteRemove = path;
  remove.setAttribute('aria-label', `移出收藏夹：${label}`);
  remove.title = '移出收藏夹';
  remove.textContent = '×';
  item.append(drag, link, remove);
  return item;
};
const ensureDirectoryFavourites = () => {
  let nav = document.querySelector('.directory-favourites');
  if (nav) return nav;
  nav = document.createElement('nav');
  nav.className = 'directory-favourites';
  nav.setAttribute('aria-label', '收藏目录');
  nav.innerHTML = '<span class="directory-favourites-label">收藏夹</span><div class="directory-favourites-list"></div>';
  document.querySelector('.breadcrumbs').insertAdjacentElement('afterend', nav);
  return nav;
};
const ensureDirectoryFavouritesMore = nav => {
  let more = nav.querySelector('.directory-favourites-more');
  if (more) return more.querySelector('.directory-favourites-menu');
  more = document.createElement('details');
  more.className = 'directory-favourites-more';
  more.innerHTML = '<summary aria-label="展开更多收藏目录"><span>更多</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6"/></svg></summary><div class="directory-favourites-menu"></div>';
  nav.append(more);
  return more.querySelector('.directory-favourites-menu');
};
const directoryFavouriteItems = () => Array.from(
  document.querySelectorAll('.directory-favourites-list .directory-favourite, .directory-favourites-menu .directory-favourite')
);
const directoryFavouriteVisibleLimit = () => window.matchMedia('(max-width:650px)').matches ? 1 : 3;
const renderDirectoryFavouriteOrder = items => {
  const nav = document.querySelector('.directory-favourites');
  if (!nav) return;
  const visibleLimit = directoryFavouriteVisibleLimit();
  nav.querySelector('.directory-favourites-list').replaceChildren(...items.slice(0, visibleLimit));
  if (items.length > visibleLimit) {
    ensureDirectoryFavouritesMore(nav).replaceChildren(...items.slice(visibleLimit));
  } else {
    nav.querySelector('.directory-favourites-more')?.remove();
  }
};
renderDirectoryFavouriteOrder(directoryFavouriteItems());
window.matchMedia('(max-width:650px)').addEventListener('change', () => {
  renderDirectoryFavouriteOrder(directoryFavouriteItems());
});
const moveDirectoryFavourite = (dragged, target) => {
  const items = directoryFavouriteItems();
  const from = items.indexOf(dragged);
  const to = items.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  items.splice(from, 1);
  items.splice(to, 0, dragged);
  renderDirectoryFavouriteOrder(items);
};
const saveDirectoryFavouriteOrder = async previous => {
  try {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('mode', 'directory-favourite-order');
    const paths = directoryFavouriteItems().map(item => item.dataset.directoryFavouritePath);
    const response = await fetch(url, {method: 'POST', body: JSON.stringify(paths)});
    if (!response.ok) throw new Error('保存收藏夹顺序失败，请重试。');
  } catch (error) {
    renderDirectoryFavouriteOrder(previous);
    directoryNotice.textContent = error.message;
    directoryNotice.hidden = false;
  }
};
let draggedDirectoryFavourite = null;
let previousDirectoryFavouriteOrder = [];
document.addEventListener('dragstart', event => {
  const item = event.target.closest?.('.directory-favourite');
  if (!item) return;
  if (item.querySelector('.directory-favourite-name-input')) {
    event.preventDefault();
    return;
  }
  draggedDirectoryFavourite = item;
  previousDirectoryFavouriteOrder = directoryFavouriteItems();
  draggedDirectoryFavourite.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedDirectoryFavourite.dataset.directoryFavouritePath);
});
document.addEventListener('dragover', event => {
  if (!draggedDirectoryFavourite) return;
  const target = event.target.closest?.('.directory-favourite');
  if (!target || target === draggedDirectoryFavourite) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  moveDirectoryFavourite(draggedDirectoryFavourite, target);
});
document.addEventListener('drop', event => {
  if (!draggedDirectoryFavourite || !event.target.closest?.('.directory-favourites')) return;
  event.preventDefault();
});
document.addEventListener('dragend', () => {
  if (!draggedDirectoryFavourite) return;
  draggedDirectoryFavourite.classList.remove('dragging');
  const changed = directoryFavouriteItems().some(
    (item, index) => item !== previousDirectoryFavouriteOrder[index]
  );
  if (changed) saveDirectoryFavouriteOrder(previousDirectoryFavouriteOrder);
  draggedDirectoryFavourite = null;
});
let touchDirectoryFavouriteDrag = null;
document.addEventListener('pointerdown', event => {
  const handle = event.target.closest?.('.directory-favourite-drag');
  if (!handle || event.pointerType === 'mouse') return;
  touchDirectoryFavouriteDrag = {
    handle,
    item: handle.closest('.directory-favourite'),
    previous: directoryFavouriteItems(),
    x: event.clientX,
    y: event.clientY,
    moved: false
  };
  handle.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  const drag = touchDirectoryFavouriteDrag;
  if (!drag) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  event.preventDefault();
  drag.moved = true;
  drag.item.classList.add('dragging');
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.directory-favourite');
  if (target && target !== drag.item) moveDirectoryFavourite(drag.item, target);
});
const finishTouchDirectoryFavouriteDrag = event => {
  const drag = touchDirectoryFavouriteDrag;
  if (!drag) return;
  drag.item.classList.remove('dragging');
  if (event.type === 'pointerup' && drag.moved) saveDirectoryFavouriteOrder(drag.previous);
  else if (drag.moved) renderDirectoryFavouriteOrder(drag.previous);
  touchDirectoryFavouriteDrag = null;
};
document.addEventListener('pointerup', finishTouchDirectoryFavouriteDrag);
document.addEventListener('pointercancel', finishTouchDirectoryFavouriteDrag);
let directoryFavouriteNavigationTimer = null;
document.addEventListener('click', event => {
  const link = event.target.closest?.('.directory-favourite a');
  if (!link) return;
  if (link.classList.contains('editing')) {
    event.preventDefault();
    return;
  }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.detail === 0) return;
  event.preventDefault();
  clearTimeout(directoryFavouriteNavigationTimer);
  if (event.detail === 1) {
    directoryFavouriteNavigationTimer = setTimeout(() => location.assign(link.href), 260);
  }
});
const renameDirectoryFavourite = item => {
  const link = item.querySelector('a');
  if (link.classList.contains('editing')) return;
  clearTimeout(directoryFavouriteNavigationTimer);
  const original = link.innerHTML;
  const originalLabel = link.textContent;
  const input = document.createElement('input');
  input.className = 'directory-favourite-name-input';
  input.type = 'text';
  input.draggable = false;
  input.value = originalLabel;
  input.setAttribute('aria-label', `修改收藏名称：${originalLabel}`);
  link.classList.add('editing');
  link.draggable = false;
  item.draggable = false;
  link.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    const label = input.value.trim();
    link.classList.remove('editing');
    link.draggable = true;
    item.draggable = true;
    if (!save || !label) {
      link.innerHTML = original;
      return;
    }
    link.textContent = label;
    link.title = label;
    item.querySelector('.directory-favourite-drag').setAttribute('aria-label', `拖动排序：${label}`);
    item.querySelector('[data-directory-favourite-remove]').setAttribute('aria-label', `移出收藏夹：${label}`);
    try {
      const url = new URL(item.dataset.directoryFavouritePath, location.origin);
      url.searchParams.set('mode', 'directory-favourite-label');
      const response = await fetch(url, {method: 'POST', body: JSON.stringify(label)});
      if (!response.ok) throw new Error('保存收藏名称失败，请重试。');
    } catch (error) {
      link.innerHTML = original;
      link.title = originalLabel;
      directoryNotice.textContent = error.message;
      directoryNotice.hidden = false;
    }
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
};
document.addEventListener('dblclick', event => {
  const item = event.target.closest?.('.directory-favourite');
  if (!item || event.target.closest('button')) return;
  event.preventDefault();
  renameDirectoryFavourite(item);
});
const setDirectoryFavouriteState = (path, favourite) => {
  const pathname = favouritePathname(path);
  const record = directoryEntries.find(entry => entry.listHref === pathname);
  if (record) record.directoryFavourite = favourite;
  document.querySelectorAll('[data-directory-favourite-toggle]').forEach(button => {
    if (favouritePathname(button.dataset.directoryFavouriteToggle) !== pathname) return;
    button.setAttribute('aria-pressed', String(favourite));
    button.textContent = favourite ? '★' : '☆';
    const label = button.closest('.entry').querySelector('.entry-name').textContent;
    button.title = favourite ? '移出收藏夹' : '添加到收藏夹';
    button.setAttribute('aria-label', `${button.title}：${label}`);
  });
  if (pathname === location.pathname && directoryFavouriteToggle) {
    directoryFavouriteToggle.setAttribute('aria-pressed', String(favourite));
    directoryFavouriteToggle.textContent = favourite ? '移出收藏夹' : '添加到收藏夹';
  }
  const existing = Array.from(document.querySelectorAll('[data-directory-favourite-remove]'))
    .filter(button => favouritePathname(button.dataset.directoryFavouriteRemove) === pathname)
    .map(button => button.closest('.directory-favourite'));
  if (favourite && !existing.length) {
    const nav = ensureDirectoryFavourites();
    const list = nav.querySelector('.directory-favourites-list');
    if (list.children.length < directoryFavouriteVisibleLimit()) list.append(createDirectoryFavouriteItem(path));
    else ensureDirectoryFavouritesMore(nav).append(createDirectoryFavouriteItem(path));
  } else if (!favourite && existing.length) {
    const nav = existing[0].closest('.directory-favourites');
    const removedFromList = existing.some(item => item.closest('.directory-favourites-list'));
    existing.forEach(item => item.remove());
    const menu = nav.querySelector('.directory-favourites-menu');
    if (removedFromList && menu?.firstElementChild) {
      nav.querySelector('.directory-favourites-list').append(menu.firstElementChild);
    }
    if (menu && !menu.children.length) nav.querySelector('.directory-favourites-more').remove();
    if (!nav.querySelector('[data-directory-favourite-remove]')) nav.remove();
  }
};
const updateDirectoryFavourite = async (path, method, button) => {
  button.disabled = true;
  try {
    const url = new URL(path, location.origin);
    url.searchParams.set('mode', 'directory-favourite');
    const response = await fetch(url, {method});
    if (!response.ok) throw new Error('保存目录收藏失败，请重试。');
    setDirectoryFavouriteState(path, method === 'PUT');
    button.disabled = false;
  } catch (error) {
    directoryNotice.textContent = error.message;
    directoryNotice.hidden = false;
    button.disabled = false;
  }
};
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button === directoryFavouriteToggle) {
    updateDirectoryFavourite(
      location.pathname,
      directoryFavouriteToggle.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT',
      button
    );
  } else if (button.matches('[data-directory-favourite-toggle]')) {
    updateDirectoryFavourite(
      button.dataset.directoryFavouriteToggle,
      button.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT',
      button
    );
  } else if (button.matches('[data-directory-favourite-remove]')) {
    updateDirectoryFavourite(button.dataset.directoryFavouriteRemove, 'DELETE', button);
  }
});
if (history.state?.moveNotice) {
  directoryNotice.textContent = history.state.moveNotice;
  directoryNotice.hidden = false;
  const {moveNotice, ...state} = history.state;
  history.replaceState(state, '');
}

const listing = document.querySelector('.listing');
const galleryAvailable = directoryEntries.some(entry => entry.isImage) || new URLSearchParams(location.search).get('view') === 'gallery';
const directoryViewModel = new DirectoryView(directoryEntries);
window.webdirDirectory = directoryViewModel;
const directorySort = document.querySelector('#directory-sort');
const directoryEmpty = document.querySelector('#directory-empty');
const imageFilter = document.querySelector('#image-filter');
const IMAGE_FILTER_KEY = `webdir-image-filter:${location.pathname}`;
const filterLabels = {all: '全部', favourite: '喜欢', tag1: '标记1', tag2: '标记2', tag3: '标记3', tag4: '标记4', tag5: '标记5'};
let selectedImageFilter = galleryAvailable ? localStorage.getItem(IMAGE_FILTER_KEY) || 'all' : 'all';
if (!filterLabels[selectedImageFilter]) selectedImageFilter = 'all';
const refreshImageFilters = () => {
  if (!imageFilter) return;
  const entries = directoryEntries.filter(entry => entry.isImage);
  const available = new Set(['all', selectedImageFilter]);
  entries.forEach(entry => {
    if (entry.favourite === 'true') available.add('favourite');
    if (entry.imageTag) available.add(`tag${entry.imageTag}`);
  });
  imageFilter.replaceChildren(...Object.entries(filterLabels)
    .filter(([value]) => available.has(value))
    .map(([value, label]) => new Option(label, value)));
  imageFilter.value = selectedImageFilter;
};
refreshImageFilters();
if (typeof history.state?.fileSearch === 'string') {
  fileSearchInput.value = history.state.fileSearch;
}
if (galleryAvailable) {
  const option = document.createElement('option');
  option.value = 'similarity';
  option.textContent = '按图片相似度';
  directorySort.append(option);
}
const DIRECTORY_SORT_KEY = 'webdir-directory-sort';
const savedDirectorySort = localStorage.getItem(DIRECTORY_SORT_KEY);
if (savedDirectorySort && Array.from(directorySort.options).some(option => option.value === savedDirectorySort)) {
  directorySort.value = savedDirectorySort;
}
const sortableEntries = directoryEntries;
const entryName = entry => entry.name;
const nameCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
const exactNameCollator = new Intl.Collator();
const compareEntryNames = (left, right) => nameCollator.compare(left.name, right.name) || exactNameCollator.compare(left.name, right.name);
let similarityOrderRequest = null;
const loadSimilarityOrder = async () => {
  if (!similarityOrderRequest) {
    const url = new URL(location.href);
    url.search = '?mode=similarity-order';
    similarityOrderRequest = fetch(url).then(async response => {
      if (!response.ok) throw new Error((await response.text()).trim() || '无法计算图片相似度');
      return response.json();
    });
  }
  return similarityOrderRequest;
};
const sortDirectory = async () => {
  const entries = sortableEntries;
  if (directorySort.value === 'modified') {
    entries.sort((left, right) => Number(right.modified) - Number(left.modified) || compareEntryNames(left, right));
  } else if (directorySort.value === 'name') {
    entries.sort(compareEntryNames);
  } else if (directorySort.value === 'similarity') {
    try {
      const order = await loadSimilarityOrder();
      if (directorySort.value !== 'similarity') return;
      const ranks = new Map(order.map((name, index) => [name, index]));
      const category = entry => entry.isDir ? 0 : entry.isImage ? 1 : 2;
      entries.sort((left, right) => {
        const categoryOrder = category(left) - category(right);
        if (categoryOrder) return categoryOrder;
        if (category(left) === 1) return ranks.get(entryName(left)) - ranks.get(entryName(right));
        return compareEntryNames(left, right);
      });
    } catch (error) {
      directoryNotice.textContent = error.message;
      directoryNotice.hidden = false;
      return;
    }
  }
  directoryViewModel.schedule(true);
};
const filterDirectory = () => {
  const query = fileSearchInput.value.trim().toLowerCase();
  const markedOnly = !!imageFilter && selectedImageFilter !== 'all';
  let directoryCount = 0;
  let fileCount = 0;
  directoryEntries.forEach(entry => {
    const matchesName = entry.name.toLowerCase().includes(query);
    const matchesMark = !markedOnly || (selectedImageFilter === 'favourite'
      ? entry.favourite === 'true' : `tag${entry.imageTag}` === selectedImageFilter);
    entry.hidden = !matchesName || !matchesMark;
    if (entry.hidden) return;
    if (entry.isDir) directoryCount++;
    else fileCount++;
  });
  for (const node of directoryViewModel.nodes.values()) node.hidden = directoryViewModel.fromNode(node)?.hidden ?? true;
  document.querySelector('.summary').textContent = `${directoryCount} 个目录 · ${fileCount} 个文件`;
  directoryEmpty.hidden = directoryCount + fileCount > 0;
  const otherHeading = listing.querySelector('.gallery-other-heading');
  if (otherHeading) otherHeading.hidden = !directoryEntries.some(entry => !entry.isDir && !entry.isImage && !entry.hidden);
  directoryEmpty.querySelector('p').textContent = markedOnly
    ? '没有符合筛选条件的图片'
    : query ? '没有匹配的文件或目录' : '这个目录是空的';
  directoryViewModel.schedule(true);
  document.dispatchEvent(new Event('gallery-filter-change'));
};
fileSearchInput.addEventListener('input', () => {
  history.replaceState({...history.state, fileSearch: fileSearchInput.value}, '');
  filterDirectory();
});
directorySort.addEventListener('change', () => {
  localStorage.setItem(DIRECTORY_SORT_KEY, directorySort.value);
  sortDirectory();
});
if (directorySort.value === 'similarity') directoryEntries.sort(compareEntryNames);
sortDirectory();
filterDirectory();

const scrollJumps = document.querySelector('#scroll-jumps');
const scrollToTop = scrollJumps.querySelector('#scroll-to-top');
const scrollToBottom = scrollJumps.querySelector('#scroll-to-bottom');
let scrollJumpFrame = null;
let scrollJumpHideTimer = null;
let scrollJumpsVisible = false;
const updateScrollJumps = () => {
  scrollJumpFrame = null;
  const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  scrollJumps.hidden = maximum < 48 || !scrollJumpsVisible;
  scrollToTop.disabled = scrollY <= 4;
  scrollToBottom.disabled = scrollY >= maximum - 4;
};
const scheduleScrollJumpUpdate = () => {
  if (scrollJumpFrame !== null) return;
  scrollJumpFrame = requestAnimationFrame(updateScrollJumps);
};
const revealScrollJumps = () => {
  scrollJumpsVisible = true;
  clearTimeout(scrollJumpHideTimer);
  scheduleScrollJumpUpdate();
  scrollJumpHideTimer = setTimeout(() => {
    scrollJumpsVisible = false;
    scheduleScrollJumpUpdate();
  }, 900);
};
const jumpScroll = top => window.scrollTo({
  top,
  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
});
scrollToTop.addEventListener('click', () => jumpScroll(0));
scrollToBottom.addEventListener('click', () => jumpScroll(document.documentElement.scrollHeight));
addEventListener('scroll', revealScrollJumps, {passive: true});
addEventListener('resize', scheduleScrollJumpUpdate);
new ResizeObserver(scheduleScrollJumpUpdate).observe(document.body);
updateScrollJumps();

const galleryToggle = document.querySelector('#gallery-toggle');
galleryToggle.hidden = !galleryAvailable;
document.querySelector('#gallery-organise').hidden = !galleryAvailable;
if (galleryToggle) {
  const DIRECTORY_VIEW_KEY = `webdir-directory-view:${location.pathname}`;
  const organise = document.querySelector('#gallery-organise');
  const moveImagesButton = organise.querySelector('#move-images');
  const selectImagesButton = organise.querySelector('#select-images');
  const selectionCount = organise.querySelector('#image-selection-count');
  const selectAllImagesButton = organise.querySelector('#select-all-images');
  const clearSelectionButton = organise.querySelector('#clear-image-selection');
  let selectingImages = false;
  const selectedImages = new Set();
  const lightbox = document.querySelector('#image-lightbox');
  const lightboxImage = lightbox.querySelector('.lightbox-image');
  const lightboxStage = lightbox.querySelector('.lightbox-stage');
  const lightboxBackdrop = document.createElement('div');
  lightboxBackdrop.className = 'carousel-backdrop';
  lightboxBackdrop.setAttribute('aria-hidden', 'true');
  lightboxStage.prepend(lightboxBackdrop);
  const lightboxPlaceholder = document.createElement('img');
  lightboxPlaceholder.className = 'lightbox-placeholder';
  lightboxPlaceholder.alt = '';
  lightboxPlaceholder.setAttribute('aria-hidden', 'true');
  lightboxPlaceholder.draggable = false;
  lightboxStage.insertBefore(lightboxPlaceholder, lightboxStage.querySelector('.lightbox-image'));
  const imageLoading = document.createElement('div');
  imageLoading.className = 'image-loading';
  imageLoading.hidden = true;
  imageLoading.innerHTML = '<i aria-hidden="true"></i><span>正在载入清晰图片…</span>';
  lightboxStage.append(imageLoading);
  const imageLoadError = document.createElement('div');
  imageLoadError.className = 'image-load-error';
  imageLoadError.hidden = true;
  imageLoadError.innerHTML = '<strong>图片加载失败</strong><button type="button">重新加载</button>';
  lightboxStage.append(imageLoadError);
  const heartParticles = document.createElement('div');
  heartParticles.className = 'heart-particles';
  heartParticles.setAttribute('aria-hidden', 'true');
  lightbox.append(heartParticles);
  for (let index = 0; index < 12; index++) {
    const particle = document.createElement('span');
    particle.hidden = true;
    particle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
    heartParticles.append(particle);
  }
  const lightboxPosition = lightbox.querySelector('#lightbox-position');
  const lightboxFilmstrip = lightbox.querySelector('#lightbox-filmstrip');
  const lightboxCaption = lightbox.querySelector('.lightbox-name');
  const favouriteToggle = lightbox.querySelector('#favourite-toggle');
  const favouriteBurst = lightbox.querySelector('#favourite-burst');
  const favouriteError = lightbox.querySelector('#favourite-error');
  const imageTagError = lightbox.querySelector('#image-tag-error');
  const previewPrevious = lightbox.querySelector('#preview-previous');
  const previewNext = lightbox.querySelector('#preview-next');
  const carouselToggle = lightbox.querySelector('#carousel-toggle');
  const lightboxClose = lightbox.querySelector('.lightbox-close');
  const carouselHud = document.createElement('div');
  carouselHud.className = 'carousel-hud';
  carouselHud.innerHTML = '<span class="carousel-notice" hidden></span><button type="button" data-carousel-pause>暂停</button><button type="button" data-carousel-exit>退出轮播</button>';
  lightbox.append(carouselHud);
  const viewerControls = lightbox.querySelector('.lightbox-controls');
  const svgIcon = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const strokePath = path => `<path d="${path}"></path>`;
  const commentToggle = document.createElement('button');
  commentToggle.type = 'button';
  commentToggle.className = 'comment-toggle';
  commentToggle.title = '图片评论 (c)';
  commentToggle.setAttribute('aria-label', commentToggle.title);
  commentToggle.setAttribute('aria-expanded', 'false');
  commentToggle.innerHTML = `${svgIcon(strokePath('M6.5 5.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z') + strokePath('M8 9.5h8M8 12.5h5'))}<b hidden>0</b>`;
  viewerControls.insertBefore(commentToggle, viewerControls.querySelector('#carousel-toggle'));
  const moreToggle = document.createElement('button');
  moreToggle.type = 'button';
  moreToggle.className = 'viewer-more-toggle';
  moreToggle.title = '更多工具';
  moreToggle.setAttribute('aria-label', moreToggle.title);
  moreToggle.setAttribute('aria-expanded', 'false');
  moreToggle.innerHTML = svgIcon(strokePath('m7 9.5 5 5 5-5'));
  viewerControls.append(moreToggle);
  const viewerExtras = document.createElement('div');
  viewerExtras.className = 'viewer-extras';
  viewerExtras.hidden = true;
  viewerControls.after(viewerExtras);
  const viewerTools = document.createElement('span');
  viewerTools.className = 'viewer-tools';
  viewerTools.innerHTML = `<button type="button" data-zoom="out" aria-label="缩小">${svgIcon(strokePath('M6 12h12'))}</button><button type="button" data-view="fit" aria-label="适应窗口">适屏</button><button type="button" data-view="fill" aria-label="填满窗口">填满</button><button type="button" data-view="actual" aria-label="原始尺寸">1:1</button><button type="button" data-zoom="in" aria-label="放大">${svgIcon(strokePath('M12 6v12M6 12h12'))}</button><button type="button" data-info aria-expanded="false" aria-label="图片信息">${svgIcon(strokePath('M12 11v5M12 8h.01') + '<circle cx="12" cy="12" r="9"></circle>')}</button>`;
  const shortcutHelpToggle = document.createElement('button');
  shortcutHelpToggle.type = 'button';
  shortcutHelpToggle.className = 'shortcut-help-toggle';
  shortcutHelpToggle.innerHTML = svgIcon(strokePath('M9.7 9a2.5 2.5 0 1 1 3.9 2.1c-1 .7-1.6 1.2-1.6 2.4M12 17h.01') + '<circle cx="12" cy="12" r="9"></circle>');
  shortcutHelpToggle.title = '查看快捷键';
  shortcutHelpToggle.setAttribute('aria-label', shortcutHelpToggle.title);
  viewerExtras.append(viewerTools, shortcutHelpToggle);
  const imageInfo = document.createElement('aside');
  imageInfo.className = 'image-info';
  imageInfo.hidden = true;
  const shortcutHelp = document.createElement('aside');
  shortcutHelp.className = 'shortcut-help';
  shortcutHelp.hidden = true;
  shortcutHelp.innerHTML = '<span>← / J 上一张 · → / K 下一张</span><span>F 点赞 · C 评论 · 粘贴文本追加评论 · 1–5 数字标记 · Ctrl K 直接删除</span><span>P 轮播 · 空格暂停</span><span>Esc 退出</span>';
  const figure = lightbox.querySelector('figure');
  figure.append(imageInfo, shortcutHelp);
  previewPrevious.innerHTML = svgIcon(strokePath('m15 6-6 6 6 6'));
  previewNext.innerHTML = svgIcon(strokePath('m9 6 6 6-6 6'));
  favouriteToggle.innerHTML = svgIcon(strokePath('M12 20.2 4.8 13a4.7 4.7 0 0 1 6.7-6.6l.5.5.5-.5a4.7 4.7 0 0 1 6.7 6.6L12 20.2Z') + strokePath('m17.2 4.2.45-1.3.45 1.3 1.3.45-1.3.45-.45 1.3-.45-1.3-1.3-.45 1.3-.45Z'));
  carouselToggle.innerHTML = svgIcon('<path class="icon-fill" d="m9 7 8 5-8 5Z"></path>' + strokePath('M5 5v14'));
  lightboxClose.innerHTML = svgIcon(strokePath('m6 6 12 12M18 6 6 18'));
  const lightboxState = document.createElement('div');
  lightboxState.className = 'lightbox-state';
  lightboxState.setAttribute('role', 'status');
  lightboxState.innerHTML = `<span class="lightbox-favourite-state">${svgIcon('<path d="M12 21c-.45 0-.85-.18-1.2-.5l-6.7-6.2C1.35 11.75 1.2 7.75 3.7 5.2 6.05 2.8 10 2.85 12 5.45c2-2.6 5.95-2.65 8.3-.25 2.5 2.55 2.35 6.55-.4 9.1l-6.7 6.2c-.35.32-.75.5-1.2.5Z"></path>')}</span><span class="lightbox-tag-state" hidden></span>`;
  lightboxStage.append(lightboxState);
  const commentsDrawer = document.createElement('aside');
  commentsDrawer.className = 'gallery-comments';
  commentsDrawer.hidden = true;
  commentsDrawer.setAttribute('aria-label', '图片评论');
  commentsDrawer.innerHTML = '<header><div><span>IMAGE NOTES</span><strong>图片评论</strong></div><button type="button" data-comments-close aria-label="关闭评论区"></button></header><div class="gallery-comments-image"><img alt=""><div><strong></strong><span></span></div><button type="button" data-comment-delete-all hidden>删除所有评论</button></div><div class="gallery-comment-list" role="feed"></div><div class="gallery-comment-empty"><strong>还没有评论</strong><span>记录构图、色彩或需要 AI 调整的细节。</span></div><form class="gallery-comment-composer"><div class="gallery-comment-identity" hidden><span>评论人 <strong></strong></span><button type="button" data-comment-change-author>更换</button></div><label data-comment-author>评论人<input name="author" autocomplete="name" placeholder="你的名字" required></label><label>评论内容<textarea name="body" rows="4" placeholder="例如：压低背景高光，让人物更突出…" required></textarea></label><p class="gallery-comment-hint">Enter 提交 · ⌘ Enter 换行</p><p class="gallery-comment-error" role="status" hidden></p><div><button type="button" data-comment-cancel hidden>取消编辑</button><button type="submit" class="comment-submit">添加评论</button></div></form><footer><a target="_blank">打开共享评论文件</a><span>gallery-comments.json</span></footer>';
  commentsDrawer.querySelector('[data-comments-close]').innerHTML = svgIcon(strokePath('m7 7 10 10M17 7 7 17'));
  lightbox.append(commentsDrawer);
  const galleryToast = document.createElement('div');
  galleryToast.className = 'gallery-toast';
  galleryToast.setAttribute('role', 'status');
  galleryToast.hidden = true;
  lightbox.append(galleryToast);
  const deleteDialog = document.querySelector('#delete-dialog');
  const deleteName = deleteDialog.querySelector('#delete-name');
  const deleteError = deleteDialog.querySelector('#delete-error');
  const deleteCancel = deleteDialog.querySelector('#delete-cancel');
  const deleteConfirm = deleteDialog.querySelector('#delete-confirm');
  const deleteImagesButton = document.querySelector('#delete-images');
  const clearImageMarksButton = document.querySelector('#clear-image-marks');
  const batchDeleteDialog = document.querySelector('#batch-delete-dialog');
  const batchDeleteError = batchDeleteDialog.querySelector('#batch-delete-error');
  const batchDeleteCancel = batchDeleteDialog.querySelector('#batch-delete-cancel');
  const batchDeleteConfirm = batchDeleteDialog.querySelector('#batch-delete-confirm');
  const mobileTouch = matchMedia('(hover: none) and (pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const REVIEW_IDENTITY_KEY = 'webdir-review-identity';
  const imageModel = () => directoryEntries.filter(entry => entry.isImage);
  const visibleImages = () => imageModel().filter(entry => !entry.hidden);
  const batchImages = () => visibleImages().filter(entry => !selectingImages || selectedImages.has(entry));
  let previewTrigger = null;
  let deleting = false;
  let liking = 0;
  let marking = 0;
  let moving = false;
  let lastImageTap = null;
  let adjacentPreloads = [];
  let carouselTimer = null;
  let previewRequest = 0;
  let loadingTimer = null;
  let chromeTimer = null;
  let mouseInChromeZone = false;
  let carouselPaused = false;
  let carouselQueue = [];
  let lastCarouselEffect = null;
  let zoom = {scale: 1, x: 0, y: 0, mode: 'fit', originalLoaded: false};
  let pointerGesture = null;
  let galleryComments = {version: 1, instructions: [], comments: []};
  let galleryCommentsLoaded = false;
  let galleryCommentsLoading = false;
  let editingCommentId = null;
  let deleteAllCommentsTimer = null;
  const pendingFavourites = new WeakSet();
  const pendingImageTags = new WeakSet();
  const galleryCommentList = commentsDrawer.querySelector('.gallery-comment-list');
  const galleryCommentEmpty = commentsDrawer.querySelector('.gallery-comment-empty');
  const galleryCommentComposer = commentsDrawer.querySelector('.gallery-comment-composer');
  const galleryCommentAuthor = galleryCommentComposer.elements.author;
  const galleryCommentAuthorLabel = galleryCommentComposer.querySelector('[data-comment-author]');
  const galleryCommentIdentity = galleryCommentComposer.querySelector('.gallery-comment-identity');
  const galleryCommentBody = galleryCommentComposer.elements.body;
  const galleryCommentError = commentsDrawer.querySelector('.gallery-comment-error');
  const galleryCommentSubmit = commentsDrawer.querySelector('.comment-submit');
  const galleryCommentCancel = commentsDrawer.querySelector('[data-comment-cancel]');
  const galleryCommentDeleteAll = commentsDrawer.querySelector('[data-comment-delete-all]');
  const commentCount = commentToggle.querySelector('b');
  const showGalleryToast = message => {
    galleryToast.textContent = message;
    galleryToast.hidden = false;
    clearTimeout(showGalleryToast.timer);
    showGalleryToast.timer = setTimeout(() => { galleryToast.hidden = true; }, 2200);
  };
  const scrollToLatestGalleryComment = (smooth = true) => requestAnimationFrame(() => {
    galleryCommentList.scrollTo({
      top: galleryCommentList.scrollHeight,
      behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto'
    });
  });
  const syncGalleryCommentIdentity = () => {
    const author = localStorage.getItem(REVIEW_IDENTITY_KEY)?.trim() || '';
    galleryCommentAuthor.value = author;
    galleryCommentAuthorLabel.hidden = Boolean(author);
    galleryCommentIdentity.hidden = !author;
    galleryCommentIdentity.querySelector('strong').textContent = author;
  };
  syncGalleryCommentIdentity();

  const updateLightboxState = () => {
    const liked = previewTrigger?.favourite === 'true';
    const tag = previewTrigger?.imageTag || '';
    lightboxState.querySelector('.lightbox-favourite-state').classList.toggle('liked', liked);
    const badge = lightboxState.querySelector('.lightbox-tag-state');
    badge.hidden = !tag;
    badge.textContent = tag;
    badge.dataset.tag = tag;
    lightboxState.setAttribute('aria-label', `${liked ? '已点赞' : '未点赞'}${tag ? `，标记${tag}` : ''}`);
  };

  const updateFavouriteButton = () => {
    const liked = previewTrigger?.favourite === 'true';
    favouriteToggle.setAttribute('aria-pressed', String(liked));
    favouriteToggle.title = liked ? '取消点赞 (f)' : '点赞 (f)';
    favouriteToggle.setAttribute('aria-label', favouriteToggle.title);
    updateLightboxState();
  };

  const updateImageControls = () => {
    for (const entry of selectedImages) {
      if (!directoryViewModel.byPath.has(entry.filePath) || entry.hidden) selectedImages.delete(entry);
    }
    directoryViewModel.onRefresh = (node, entry) => {
      const selected = selectedImages.has(entry);
      node.classList.toggle('image-selected', selected);
      const link = node.querySelector('.file-open') || node;
      if (selectingImages && entry.isImage) {
        link.setAttribute('role', 'checkbox');
        link.setAttribute('aria-checked', String(selected));
      } else {
        link.removeAttribute('role');
        link.removeAttribute('aria-checked');
      }
    };
    for (const node of directoryViewModel.nodes.values()) directoryViewModel.refresh(directoryViewModel.fromNode(node));
    selectionCount.textContent = `已选 ${selectedImages.size} 张`;
    selectAllImagesButton.disabled = moving || visibleImages().length === selectedImages.size;
    clearSelectionButton.disabled = moving || selectedImages.size === 0;
    selectImagesButton.disabled = moving;
    const count = batchImages().length;
    for (const button of [moveImagesButton, deleteImagesButton, clearImageMarksButton]) {
      button.disabled = count === 0 || moving || liking > 0 || marking > 0 || deleting;
    }
    updateLightboxState();
  };
  const setImageSelection = (enabled, updateHistory = true) => {
    if (updateHistory && mobileTouch.matches) {
      if (enabled && !history.state?.gallerySelection) {
        history.pushState({...history.state, gallerySelection: true}, '');
      } else if (!enabled && history.state?.gallerySelection) {
        history.back();
        return;
      }
    }
    selectingImages = enabled;
    selectedImages.clear();
    listing.classList.toggle('selecting-images', enabled);
    selectImagesButton.hidden = enabled || !listing.classList.contains('gallery');
    for (const control of [selectionCount, selectAllImagesButton, clearSelectionButton]) control.hidden = !enabled;
    updateImageControls();
  };
  const toggleImageSelection = entry => {
    if (moving) return;
    if (selectedImages.has(entry)) selectedImages.delete(entry);
    else selectedImages.add(entry);
    updateImageControls();
  };
  selectImagesButton.addEventListener('click', () => setImageSelection(true));
  selectAllImagesButton.addEventListener('click', () => {
    visibleImages().forEach(entry => selectedImages.add(entry));
    updateImageControls();
  });
  clearSelectionButton.addEventListener('click', () => {
    selectedImages.clear();
    updateImageControls();
  });
  document.addEventListener('gallery-filter-change', updateImageControls);

  const updatePreviewButtons = () => {
    const entries = visibleImages();
    const index = entries.indexOf(previewTrigger);
    previewPrevious.disabled = index <= 0;
    previewNext.disabled = index < 0 || index >= entries.length - 1;
    carouselToggle.disabled = entries.length < 2;
    lightboxPosition.textContent = index < 0 ? '' : `${index + 1} / ${entries.length}`;
    const name = previewTrigger?.name || '';
    lightboxPosition.setAttribute('aria-label', index < 0 ? '' : `${name}，第 ${index + 1} 张，共 ${entries.length} 张`);
  };

  const currentImageName = () => previewTrigger?.name || '';
  const commentsEndpoint = () => `${previewTrigger.listHref}?mode=gallery-comments`;
  const formatCommentTime = value => {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', {dateStyle: 'medium', timeStyle: 'short'});
  };
  const resetCommentComposer = () => {
    editingCommentId = null;
    galleryCommentBody.value = '';
    galleryCommentCancel.hidden = true;
    galleryCommentSubmit.textContent = '添加评论';
    galleryCommentError.hidden = true;
  };
  const renderGalleryComments = () => {
    if (!previewTrigger) return;
    const name = currentImageName();
    const comments = galleryComments.comments.filter(comment => comment.image === name);
    commentCount.textContent = String(comments.length);
    commentCount.hidden = comments.length === 0;
    commentsDrawer.querySelector('.gallery-comments-image img').src = currentThumbnailSource(previewTrigger);
    commentsDrawer.querySelector('.gallery-comments-image strong').textContent = name;
    commentsDrawer.querySelector('.gallery-comments-image span').textContent = `${comments.length} 条评论`;
    galleryCommentDeleteAll.hidden = comments.length === 0;
    galleryCommentDeleteAll.dataset.confirm = 'false';
    galleryCommentDeleteAll.textContent = '删除所有评论';
    commentsDrawer.querySelector('footer a').href = new URL('gallery-comments.json', location.href).href;
    galleryCommentList.replaceChildren();
    comments.forEach(comment => {
      const article = document.createElement('article');
      article.dataset.commentId = comment.id;
      const header = document.createElement('header');
      const author = document.createElement('strong');
      author.textContent = comment.author;
      const time = document.createElement('time');
      time.dateTime = comment.edited_at || comment.created_at;
      time.textContent = `${formatCommentTime(time.dateTime)}${comment.edited_at ? ' · 已编辑' : ''}`;
      header.append(author, time);
      const body = document.createElement('p');
      body.textContent = comment.body;
      const actions = document.createElement('div');
      actions.innerHTML = '<button type="button" data-comment-edit>编辑</button><button type="button" data-comment-delete>删除</button>';
      article.append(header, body, actions);
      galleryCommentList.append(article);
    });
    galleryCommentEmpty.hidden = comments.length !== 0 || galleryCommentsLoading;
  };
  const loadGalleryComments = async () => {
    if (!previewTrigger || galleryCommentsLoading || galleryCommentsLoaded) return;
    galleryCommentsLoading = true;
    galleryCommentEmpty.hidden = true;
    commentsDrawer.classList.add('loading');
    try {
      const response = await fetch(commentsEndpoint());
      if (!response.ok) throw new Error('评论加载失败，请重试。');
      galleryComments = await response.json();
      galleryCommentsLoaded = true;
      renderGalleryComments();
    } catch (error) {
      galleryCommentError.textContent = error.message;
      galleryCommentError.hidden = false;
    } finally {
      galleryCommentsLoading = false;
      commentsDrawer.classList.remove('loading');
      renderGalleryComments();
    }
  };
  const closeGalleryComments = () => {
    commentsDrawer.hidden = true;
    commentToggle.setAttribute('aria-expanded', 'false');
    resetCommentComposer();
    showChrome();
  };
  const openGalleryComments = () => {
    if (!previewTrigger) return;
    syncGalleryCommentIdentity();
    commentsDrawer.hidden = false;
    commentToggle.setAttribute('aria-expanded', 'true');
    renderGalleryComments();
    loadGalleryComments().then(() => {
      if (!commentsDrawer.hidden) scrollToLatestGalleryComment(false);
    });
    showChrome();
    const input = galleryCommentAuthorLabel.hidden ? galleryCommentBody : galleryCommentAuthor;
    input.focus({preventScroll: true});
  };
  const toggleGalleryComments = () => commentsDrawer.hidden ? openGalleryComments() : closeGalleryComments();
  const submitGalleryCommentAction = async action => {
    galleryCommentSubmit.disabled = true;
    galleryCommentDeleteAll.disabled = true;
    galleryCommentError.hidden = true;
    try {
      const response = await fetch(commentsEndpoint(), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(action)
      });
      if (!response.ok) throw new Error((await response.text()).trim() || '保存评论失败，请重试。');
      galleryComments = await response.json();
      galleryCommentsLoaded = true;
      resetCommentComposer();
      renderGalleryComments();
      if (action.type === 'add') scrollToLatestGalleryComment();
    } catch (error) {
      galleryCommentError.textContent = error.message;
      galleryCommentError.hidden = false;
    } finally {
      galleryCommentSubmit.disabled = false;
      galleryCommentDeleteAll.disabled = false;
    }
  };

  const appendPastedGalleryComment = async body => {
    const author = localStorage.getItem(REVIEW_IDENTITY_KEY)?.trim() || '';
    if (!author) {
      showGalleryToast('请先打开评论区设置评论人');
      return;
    }
    const entry = previewTrigger;
    try {
      const response = await fetch(commentsEndpoint(), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          type: 'add',
          comment: {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            image: currentImageName(),
            author,
            body,
            created_at: new Date().toISOString()
          }
        })
      });
      if (!response.ok) throw new Error((await response.text()).trim() || '追加评论失败，请重试。');
      if (previewTrigger === entry) {
        galleryComments = await response.json();
        galleryCommentsLoaded = true;
        renderGalleryComments();
      }
      showGalleryToast('已追加评论');
    } catch (error) {
      showGalleryToast(error.message);
    }
  };

  const renderFilmstrip = () => {
    const entries = visibleImages();
    const currentIndex = entries.indexOf(previewTrigger);
    lightboxFilmstrip.replaceChildren();
    for (let offset = -3; offset <= 3; offset++) {
      const slot = document.createElement('span');
      slot.className = 'filmstrip-slot';
      slot.dataset.distance = String(Math.abs(offset));
      const entry = entries[currentIndex + offset];
      if (entry) {
        const button = document.createElement('button');
        button.className = 'filmstrip-thumb';
        button.type = 'button';
        button.setAttribute('aria-current', String(offset === 0));
        const name = entry.name;
        button.setAttribute('aria-label', offset === 0 ? `当前图片：${name}` : `查看 ${name}`);
        const image = document.createElement('img');
        image.src = currentThumbnailSource(entry);
        image.alt = '';
        image.decoding = 'async';
        button.append(image);
        button.addEventListener('click', () => switchPreview(entry, Math.sign(offset)));
        slot.append(button);
      }
      lightboxFilmstrip.append(slot);
    }
  };

  const preloadAdjacentImages = () => {
    const entries = visibleImages();
    const index = entries.indexOf(previewTrigger);
    adjacentPreloads = [entries[index - 1], entries[index + 1]]
      .filter(Boolean)
      .map(entry => {
        const image = new Image();
        image.src = entry.previewSrc;
        return image;
      });
  };

  const currentThumbnailSource = entry => entry?.gallerySrc || entry?.listSrc || entry?.previewSrc || '';

  const updateImageInfo = () => {
    if (!previewTrigger) return;
    const name = previewTrigger.name;
    const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'IMAGE';
    const dimensions = lightboxImage.naturalWidth
      ? `${lightboxImage.naturalWidth} × ${lightboxImage.naturalHeight}`
      : '尺寸读取中';
    imageInfo.innerHTML = `<span>${extension}</span><span>${previewTrigger.fileSize}</span><span>${dimensions}</span><span>${Math.round(zoom.scale * 100)}%</span><a href="${previewTrigger.originalSrc}" target="_blank">打开原图</a>`;
  };

  const applyZoom = () => {
    lightboxImage.style.transform = `translate3d(calc(${zoom.x}px + var(--gesture-x,0px)),calc(${zoom.y}px + var(--gesture-y,0px)),0) scale(${zoom.scale})`;
    lightboxImage.classList.toggle('zoomed', zoom.scale > 1.01);
    updateImageInfo();
    updateLightboxStatePosition();
  };

  const loadOriginal = async () => {
    if (!previewTrigger) return false;
    if (zoom.originalLoaded || lightboxImage.src === new URL(previewTrigger.originalSrc, location.href).href) return true;
    const entry = previewTrigger;
    const request = ++previewRequest;
    const original = new Image();
    original.src = entry.originalSrc;
    try {
      await original.decode();
      if (previewTrigger !== entry || request !== previewRequest) return;
      lightboxImage.src = original.src;
      zoom.originalLoaded = true;
      updateImageInfo();
      return true;
    } catch (_) {
      return false;
    }
  };

  const setZoom = (scale, origin = null) => {
    const previous = zoom.scale;
    zoom.scale = Math.min(8, Math.max(1, scale));
    zoom.mode = zoom.scale === 1 ? 'fit' : 'custom';
    if (origin && previous > 0) {
      const rect = lightboxStage.getBoundingClientRect();
      const ox = origin.x - rect.left - rect.width / 2;
      const oy = origin.y - rect.top - rect.height / 2;
      const ratio = zoom.scale / previous;
      zoom.x = ox - (ox - zoom.x) * ratio;
      zoom.y = oy - (oy - zoom.y) * ratio;
    }
    if (zoom.scale === 1) zoom.x = zoom.y = 0;
    if (zoom.scale > 1.15) loadOriginal();
    applyZoom();
  };

  const fittedImageSize = () => {
    const stage = lightboxStage.getBoundingClientRect();
    const width = lightboxImage.naturalWidth;
    const height = lightboxImage.naturalHeight;
    if (!width || !height) return {width: stage.width, height: stage.height};
    const scale = Math.min(1, stage.width / width, stage.height / height);
    return {width: width * scale, height: height * scale};
  };

  const updateLightboxStatePosition = () => {
    const stage = lightboxStage.getBoundingClientRect();
    const fitted = fittedImageSize();
    const inset = 12;
    lightboxState.style.right = `${Math.max(inset, (stage.width - fitted.width * zoom.scale) / 2 - zoom.x + inset)}px`;
    lightboxState.style.bottom = `${Math.max(inset, (stage.height - fitted.height * zoom.scale) / 2 - zoom.y + inset)}px`;
  };
  addEventListener('resize', updateLightboxStatePosition);

  const setViewMode = async mode => {
    if (!previewTrigger) return;
    if (mode === 'fit') {
      zoom = {scale: 1, x: 0, y: 0, mode: 'fit', originalLoaded: zoom.originalLoaded};
      return applyZoom();
    }
    if (mode === 'actual') {
      if (!await loadOriginal()) return;
      const fitted = fittedImageSize();
      const scale = fitted.width
        ? Math.min(8, Math.max(1, lightboxImage.naturalWidth / fitted.width))
        : 1;
      zoom = {scale, x: 0, y: 0, mode: 'actual', originalLoaded: zoom.originalLoaded};
      return applyZoom();
    }
    const stage = lightboxStage.getBoundingClientRect();
    const fitted = fittedImageSize();
    if (!fitted.width || !fitted.height) return;
    const scale = Math.min(8, Math.max(stage.width / fitted.width, stage.height / fitted.height));
    zoom = {scale, x: 0, y: 0, mode: 'fill', originalLoaded: zoom.originalLoaded};
    applyZoom();
  };

  viewerTools.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.zoom === 'in') setZoom(zoom.scale * 1.25);
    else if (button.dataset.zoom === 'out') setZoom(zoom.scale / 1.25);
    else if (button.dataset.view) setViewMode(button.dataset.view);
    else if (button.hasAttribute('data-info')) {
      imageInfo.hidden = !imageInfo.hidden;
      button.setAttribute('aria-expanded', String(!imageInfo.hidden));
      updateImageInfo();
    }
  });
  shortcutHelpToggle.addEventListener('click', () => {
    shortcutHelp.hidden = !shortcutHelp.hidden;
    shortcutHelpToggle.setAttribute('aria-expanded', String(!shortcutHelp.hidden));
  });
  moreToggle.addEventListener('click', () => {
    viewerExtras.hidden = !viewerExtras.hidden;
    moreToggle.setAttribute('aria-expanded', String(!viewerExtras.hidden));
    moreToggle.classList.toggle('open', !viewerExtras.hidden);
    showChrome();
  });
  commentToggle.addEventListener('click', toggleGalleryComments);
  commentsDrawer.querySelector('[data-comments-close]').addEventListener('click', closeGalleryComments);
  galleryCommentCancel.addEventListener('click', resetCommentComposer);
  galleryCommentAuthor.addEventListener('change', () => {
    const author = galleryCommentAuthor.value.trim();
    if (author) localStorage.setItem(REVIEW_IDENTITY_KEY, author);
    syncGalleryCommentIdentity();
  });
  galleryCommentComposer.querySelector('[data-comment-change-author]').addEventListener('click', () => {
    galleryCommentIdentity.hidden = true;
    galleryCommentAuthorLabel.hidden = false;
    galleryCommentAuthor.focus();
    galleryCommentAuthor.select();
  });
  galleryCommentComposer.addEventListener('submit', event => {
    event.preventDefault();
    const author = galleryCommentAuthor.value.trim();
    const body = galleryCommentBody.value.trim();
    if (!author || !body || !previewTrigger) return;
    localStorage.setItem(REVIEW_IDENTITY_KEY, author);
    syncGalleryCommentIdentity();
    if (editingCommentId) {
      submitGalleryCommentAction({
        type: 'edit',
        comment_id: editingCommentId,
        body,
        edited_at: new Date().toISOString()
      });
      return;
    }
    submitGalleryCommentAction({
      type: 'add',
      comment: {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        image: currentImageName(),
        author,
        body,
        created_at: new Date().toISOString()
      }
    });
  });
  galleryCommentList.addEventListener('click', event => {
    const article = event.target.closest('article[data-comment-id]');
    if (!article) return;
    const comment = galleryComments.comments.find(item => item.id === article.dataset.commentId);
    if (!comment) return;
    if (event.target.closest('[data-comment-edit]')) {
      editingCommentId = comment.id;
      galleryCommentBody.value = comment.body;
      galleryCommentCancel.hidden = false;
      galleryCommentSubmit.textContent = '保存修改';
      galleryCommentBody.focus();
      return;
    }
    const deleteButton = event.target.closest('[data-comment-delete]');
    if (!deleteButton) return;
    if (deleteButton.dataset.confirm !== 'true') {
      deleteButton.dataset.confirm = 'true';
      deleteButton.textContent = '确认删除';
      setTimeout(() => {
        if (!deleteButton.isConnected) return;
        deleteButton.dataset.confirm = 'false';
        deleteButton.textContent = '删除';
      }, 2400);
      return;
    }
    submitGalleryCommentAction({type: 'delete', comment_id: comment.id});
  });
  galleryCommentDeleteAll.addEventListener('click', () => {
    if (galleryCommentDeleteAll.dataset.confirm !== 'true') {
      galleryCommentDeleteAll.dataset.confirm = 'true';
      galleryCommentDeleteAll.textContent = '确认全部删除';
      clearTimeout(deleteAllCommentsTimer);
      deleteAllCommentsTimer = setTimeout(() => {
        galleryCommentDeleteAll.dataset.confirm = 'false';
        galleryCommentDeleteAll.textContent = '删除所有评论';
      }, 2400);
      return;
    }
    clearTimeout(deleteAllCommentsTimer);
    submitGalleryCommentAction({type: 'delete-all'});
  });

  const canAutoHideChrome = () => imageInfo.hidden && shortcutHelp.hidden
    && commentsDrawer.hidden && viewerExtras.hidden && !mouseInChromeZone;
  const showChrome = (hold = false) => {
    lightbox.classList.remove('chrome-hidden');
    clearTimeout(chromeTimer);
    const carouselMode = lightbox.classList.contains('carousel-mode');
    if (carouselMode || (!hold && canAutoHideChrome())) {
      chromeTimer = setTimeout(() => lightbox.classList.add('chrome-hidden'), 2500);
    }
  };

  const animateFavouriteFeedback = (liked, origin = null) => {
    favouriteToggle.getAnimations().forEach(animation => animation.cancel());
    favouriteToggle.animate(reducedMotion.matches
      ? [{opacity: .65}, {opacity: 1}]
      : [
          {transform: 'translateY(0) scale(1)'},
          {transform: `translateY(${liked ? -6 : 2}px) scale(${liked ? 1.2 : .9})`, offset: .38},
          {transform: 'translateY(0) scale(1)'}
        ], {duration: reducedMotion.matches ? 160 : 420, easing: 'cubic-bezier(.16,1,.3,1)'});
    if (reducedMotion.matches) return;
    const particleRect = lightbox.getBoundingClientRect();
    const buttonRect = favouriteToggle.getBoundingClientRect();
    const startX = (origin?.x ?? (buttonRect.left + buttonRect.width / 2)) - particleRect.left;
    const startY = (origin?.y ?? (buttonRect.top + buttonRect.height / 2)) - particleRect.top;
    const count = liked ? 9 : 3;
    Array.from(heartParticles.children).forEach((particle, index) => {
      particle.getAnimations().forEach(animation => animation.cancel());
      particle.hidden = index >= count;
      if (particle.hidden) return;
      particle.style.left = `${startX}px`;
      particle.style.top = `${startY}px`;
      particle.classList.toggle('outline', !liked);
      const spread = liked ? 54 + (index % 3) * 18 : 20;
      const angle = liked ? (-150 + index * 18) * Math.PI / 180 : (-110 + index * 20) * Math.PI / 180;
      const x = Math.cos(angle) * spread;
      const y = Math.sin(angle) * spread - (liked ? 34 + (index % 2) * 18 : 4);
      const rotate = -28 + index * 11;
      const scale = liked ? .68 + (index % 4) * .13 : .7;
      const animation = particle.animate([
        {transform: 'translate3d(-50%,-50%,0) scale(.25) rotate(0)', opacity: 0},
        {transform: `translate3d(calc(-50% + ${x * .35}px),calc(-50% + ${y * .25}px),0) scale(${scale * 1.18}) rotate(${rotate * .4}deg)`, opacity: 1, offset: .28},
        {transform: `translate3d(calc(-50% + ${x}px),calc(-50% + ${y}px),0) scale(${scale}) rotate(${rotate}deg)`, opacity: 0}
      ], {duration: liked ? 570 + index * 34 : 360, delay: liked ? index * 24 : index * 35, easing: 'cubic-bezier(.16,1,.3,1)'});
      animation.finished.catch(() => {}).finally(() => { particle.hidden = true; });
    });
  };

  const toggleFavourite = async origin => {
    if (!previewTrigger || lightbox.hidden || deleting || moving || deleteDialog.open) return;
    const entry = previewTrigger;
    let saved = entry.favourite;
    const liked = entry.favourite !== 'true';
    favouriteError.hidden = true;
    entry.favourite = String(liked);
    directoryViewModel.refresh(entry);
    updateFavouriteButton();
    animateFavouriteFeedback(liked, origin);
    if (pendingFavourites.has(entry)) return;
    liking++;
    pendingFavourites.add(entry);
    updateImageControls();
    try {
      while (entry.favourite !== saved) {
        const desired = entry.favourite;
        try {
          const response = await fetch(`${entry.listHref}?mode=favourite`, {method: desired === 'true' ? 'PUT' : 'DELETE'});
          if (!response.ok) throw new Error('保存点赞状态失败，请重试。');
          saved = desired;
          refreshImageFilters();
        } catch (error) {
          if (entry.favourite !== desired) continue;
          entry.favourite = saved;
          directoryViewModel.refresh(entry);
          if (lightbox.hidden) filterDirectory();
          if (previewTrigger === entry) {
            favouriteError.textContent = error.message;
            favouriteError.hidden = false;
          }
        }
      }
    } finally {
      liking--;
      pendingFavourites.delete(entry);
      updateFavouriteButton();
      updateImageControls();
    }
  };
  favouriteToggle.addEventListener('click', toggleFavourite);

  const toggleImageTag = async number => {
    if (!previewTrigger || lightbox.hidden || deleting || moving || deleteDialog.open) return;
    const entry = previewTrigger;
    let saved = entry.imageTag;
    const previous = saved;
    const tag = previous === number ? '' : number;
    const setTag = value => {
      entry.imageTag = value;
      directoryViewModel.refresh(entry);
    };
    imageTagError.hidden = true;
    setTag(tag);
    updateImageControls();
    if (pendingImageTags.has(entry)) return;
    marking++;
    pendingImageTags.add(entry);
    updateImageControls();
    try {
      while (entry.imageTag !== saved) {
        const desired = entry.imageTag;
        try {
          const response = await fetch(`${entry.listHref}?mode=image-tag`, {
            method: desired ? 'PUT' : 'DELETE',
            headers: {'Content-Type': 'application/json'},
            ...(desired ? {body: JSON.stringify({tag: Number(desired)})} : {})
          });
          if (!response.ok) throw new Error('保存图片标记失败，请重试。');
          saved = desired;
          refreshImageFilters();
        } catch (error) {
          if (entry.imageTag !== desired) continue;
          setTag(saved);
          if (lightbox.hidden) filterDirectory();
          if (previewTrigger === entry) {
            imageTagError.textContent = error.message;
            imageTagError.hidden = false;
          }
        }
      }
    } finally {
      marking--;
      pendingImageTags.delete(entry);
      updateImageControls();
    }
  };
  previewPrevious.addEventListener('click', () => stepPreview(-1));
  previewNext.addEventListener('click', () => stepPreview(1));

  const moveDialog = document.createElement('dialog');
  moveDialog.className = 'delete-dialog move-dialog';
  moveDialog.innerHTML = '<form><h2>移动这些图片</h2><p class="move-description"></p><label>目标文件夹名<input name="directory" required autocomplete="off"></label><p>同名文件会自动重命名。</p><div class="delete-actions"><button type="button" data-move-cancel>取消</button><button type="submit" data-move-confirm>确认移动</button></div></form>';
  document.body.append(moveDialog);
  const clearMarksDialog = document.createElement('dialog');
  clearMarksDialog.className = 'delete-dialog';
  clearMarksDialog.id = 'clear-marks-dialog';
  clearMarksDialog.setAttribute('aria-labelledby', 'clear-marks-title');
  clearMarksDialog.setAttribute('aria-describedby', 'clear-marks-description');
  clearMarksDialog.innerHTML = '<h2 id="clear-marks-title">取消这些图片的标记？</h2><p id="clear-marks-description"></p><div class="delete-actions"><button type="button" id="clear-marks-cancel" autofocus>取消</button><button type="button" id="clear-marks-confirm">确认取消标记</button></div>';
  document.body.append(clearMarksDialog);
  let batchFiles = [];
  let batchFilter = 'all';
  const captureBatchFiles = () => batchImages().map(entryName);
  const batchScope = () => selectingImages ? '已选的' : '当前筛选的';
  const runBatch = async action => {
    if (!action.files.length || moving || liking || marking || deleting) return;
    moving = true;
    updateImageControls();
    const descriptions = {move: '移动', delete: '删除', 'clear-mark': '取消标记'};
    const description = descriptions[action.action];
    directoryNotice.textContent = `正在${description} ${action.files.length} 张图片…`;
    directoryNotice.hidden = false;
    try {
      const url = new URL(location.href);
      url.search = '?mode=batch-images';
      const response = await fetch(url, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(action)
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      let notice = `已${description} ${result.affected} 张图片`;
      if (result.directory_removed) notice += '，已删除空目录';
      if (result.errors.length) notice += `；未完成的操作：${result.errors.join('；')}`;
      if (result.directory_removed) {
        const parent = new URL('../', location.href);
        parent.search = '?view=gallery';
        history.replaceState({moveNotice: notice, previewImage: null}, '', parent);
      } else {
        history.replaceState({...history.state, moveNotice: notice, previewImage: null}, '');
      }
      location.reload();
    } catch (error) {
      moving = false;
      directoryNotice.textContent = error.message || `${description}失败，请重试。`;
      updateImageControls();
    }
  };
  moveImagesButton.addEventListener('click', () => {
    batchFiles = captureBatchFiles();
    if (!batchFiles.length || moving) return;
    moveDialog.querySelector('.move-description').textContent = `移动${batchScope()} ${batchFiles.length} 张图片`;
    moveDialog.querySelector('input').value = selectedImageFilter;
    moveDialog.showModal();
    moveDialog.querySelector('input').select();
  });
  moveDialog.querySelector('[data-move-cancel]').addEventListener('click', () => moveDialog.close());
  moveDialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const directory = moveDialog.querySelector('input').value;
    moveDialog.close();
    runBatch({action: 'move', files: batchFiles, directory});
  });
  imageFilter.addEventListener('change', () => {
    selectedImageFilter = imageFilter.value;
    localStorage.setItem(IMAGE_FILTER_KEY, selectedImageFilter);
    refreshImageFilters();
    filterDirectory();
    scheduleThumbnails();
  });
  deleteImagesButton.addEventListener('click', () => {
    batchFiles = captureBatchFiles();
    if (!batchFiles.length || moving) return;
    batchDeleteError.hidden = true;
    batchDeleteDialog.querySelector('#batch-delete-description').textContent = `${batchScope()} ${batchFiles.length} 张图片将从磁盘中删除，此操作无法撤销。`;
    batchDeleteDialog.showModal();
  });
  batchDeleteCancel.addEventListener('click', () => batchDeleteDialog.close());
  batchDeleteConfirm.addEventListener('click', () => {
    batchDeleteDialog.close();
    runBatch({action: 'delete', files: batchFiles});
  });
  clearImageMarksButton.addEventListener('click', () => {
    batchFiles = captureBatchFiles();
    if (!batchFiles.length || moving) return;
    batchFilter = selectedImageFilter;
    const marks = batchFilter === 'all' ? '喜欢和数字标记' : batchFilter === 'favourite' ? '喜欢标记' : '数字标记';
    clearMarksDialog.querySelector('#clear-marks-description').textContent = `将取消${batchScope()} ${batchFiles.length} 张图片的${marks}，图片文件会保留。`;
    clearMarksDialog.showModal();
  });
  clearMarksDialog.querySelector('#clear-marks-cancel').addEventListener('click', () => clearMarksDialog.close());
  clearMarksDialog.querySelector('#clear-marks-confirm').addEventListener('click', () => {
    clearMarksDialog.close();
    runBatch({action: 'clear-mark', files: batchFiles, filter: batchFilter});
  });

  const visibleThumbnails = new Set();
  const loadingThumbnails = new Set();
  const loadedSources = new WeakMap();
  const thumbnailCleanups = new Map();
  let thumbnailFrame = null;

  const scheduleThumbnails = () => {
    if (thumbnailFrame !== null) return;
    thumbnailFrame = requestAnimationFrame(loadVisibleThumbnails);
  };

  const thumbnailObserver = new IntersectionObserver(entries => {
    entries.forEach(({target, isIntersecting}) => {
      if (isIntersecting) visibleThumbnails.add(target);
      else visibleThumbnails.delete(target);
    });
    scheduleThumbnails();
  }, {rootMargin: '100% 0px'});

  function loadVisibleThumbnails() {
    thumbnailFrame = null;
    const gallery = listing.classList.contains('gallery');
    const candidates = [];
    visibleThumbnails.forEach(image => {
      if (!image.isConnected) {
        visibleThumbnails.delete(image);
        thumbnailObserver.unobserve(image);
        return;
      }
      const source = gallery ? image.dataset.gallerySrc : image.dataset.listSrc;
      if (!source || loadingThumbnails.has(image) || loadedSources.get(image) === source) return;
      const rect = image.getBoundingClientRect();
      if (rect.bottom <= -innerHeight || rect.top >= innerHeight * 2 || rect.right <= 0 || rect.left >= innerWidth) return;
      candidates.push({image, source, distance: Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2)});
    });
    candidates.sort((left, right) => left.distance - right.distance);
    for (const {image, source} of candidates) {
      if (loadingThumbnails.size >= 4) break;
      loadingThumbnails.add(image);
      const cleanup = () => {
        image.removeEventListener('load', complete);
        image.removeEventListener('error', complete);
        loadingThumbnails.delete(image);
        thumbnailCleanups.delete(image);
      };
      const complete = event => {
        cleanup();
        if (event.type === 'load') loadedSources.set(image, source);
        else {
          visibleThumbnails.delete(image);
          thumbnailObserver.unobserve(image);
        }
        scheduleThumbnails();
      };
      thumbnailCleanups.set(image, cleanup);
      image.addEventListener('load', complete);
      image.addEventListener('error', complete);
      image.src = source;
    }
  }

  directoryViewModel.onMount = node => {
    const image = node.querySelector('img[data-list-src]');
    if (image) thumbnailObserver.observe(image);
  };
  directoryViewModel.onUnmount = node => {
    const image = node.querySelector('img[data-list-src]');
    if (!image) return;
    thumbnailObserver.unobserve(image);
    visibleThumbnails.delete(image);
    if (thumbnailCleanups.has(image)) {
      thumbnailCleanups.get(image)();
      image.removeAttribute('src');
      scheduleThumbnails();
    }
  };

  const carouselEffects = ['drift', 'lift', 'depth', 'soft-focus', 'curtain'];

  const clearCarouselTimer = () => {
    clearTimeout(carouselTimer);
    carouselTimer = null;
  };

  const scheduleCarousel = () => {
    clearCarouselTimer();
    if (!lightbox.classList.contains('carousel-mode') || carouselPaused || lightbox.hidden || document.hidden || deleteDialog.open) return;
    const entries = visibleImages();
    carouselQueue = carouselQueue.filter(entry => entries.includes(entry) && entry !== previewTrigger);
    if (!carouselQueue.length) carouselQueue = shuffle(entries.filter(entry => entry !== previewTrigger));
    if (carouselQueue[0]) {
      const next = new Image();
      next.src = carouselQueue[0].previewSrc;
      adjacentPreloads.push(next);
    }
    carouselTimer = setTimeout(advanceCarousel, 5000);
  };

  const shuffle = values => {
    for (let index = values.length - 1; index > 0; index--) {
      const next = Math.floor(Math.random() * (index + 1));
      [values[index], values[next]] = [values[next], values[index]];
    }
    return values;
  };

  const advanceCarousel = () => {
    const entries = visibleImages();
    if (entries.length < 2) return scheduleCarousel();
    const currentIndex = entries.indexOf(previewTrigger);
    carouselQueue = carouselQueue.filter(entry => entries.includes(entry) && entry !== previewTrigger);
    if (!carouselQueue.length) carouselQueue = shuffle(entries.filter(entry => entry !== previewTrigger));
    const nextEntry = carouselQueue.shift();
    const nextIndex = entries.indexOf(nextEntry);
    const choices = carouselEffects.filter(effect => effect !== lastCarouselEffect);
    const effect = choices[Math.floor(Math.random() * choices.length)];
    lastCarouselEffect = effect;
    switchPreview(nextEntry, nextIndex > currentIndex ? 1 : -1, effect);
  };

  const showDeleteDialog = () => {
    if (!previewTrigger || deleting || deleteDialog.open) return;
    clearCarouselTimer();
    deleteName.textContent = previewTrigger.name;
    deleteError.hidden = true;
    deleteDialog.showModal();
  };

  const stepPreview = (direction, gestureOffset = null) => {
    const entries = visibleImages();
    const nextEntry = entries[entries.indexOf(previewTrigger) + direction];
    if (!nextEntry) return false;
    switchPreview(nextEntry, direction, null, gestureOffset);
    return true;
  };

  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const enterFullscreen = element => {
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    return request ? Promise.resolve(request.call(element)) : Promise.reject(new Error('Fullscreen is unavailable'));
  };
  const exitFullscreen = () => {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    return exit ? Promise.resolve(exit.call(document)) : Promise.resolve();
  };

  const setGallery = (enabled, updateUrl = true) => {
    if (!enabled && history.state?.gallerySelection) {
      window.addEventListener('popstate', () => setGallery(false, updateUrl), {once: true});
      history.back();
      return;
    }
    localStorage.setItem(DIRECTORY_VIEW_KEY, enabled ? 'gallery' : 'list');
    listing.classList.toggle('gallery', enabled);
    document.body.classList.toggle('gallery-mode', enabled);
    selectImagesButton.hidden = !enabled || selectingImages;
    if (!enabled) setImageSelection(false);
    galleryToggle.setAttribute('aria-pressed', String(enabled));
    galleryToggle.innerHTML = enabled
      ? '<span aria-hidden="true">☷</span> 列表'
      : '<span aria-hidden="true">▦</span> Gallery';
    scheduleThumbnails();
    directoryViewModel.schedule(true);
    if (updateUrl) {
      const url = new URL(location.href);
      if (enabled) url.searchParams.set('view', 'gallery');
      else url.searchParams.delete('view');
      history.replaceState(history.state, '', url);
    }
  };

  const setCarousel = async enabled => {
    if (enabled && (lightbox.hidden || carouselToggle.disabled)) return;
    if (enabled && !commentsDrawer.hidden) closeGalleryComments();
    lightbox.classList.toggle('carousel-mode', enabled);
    carouselToggle.setAttribute('aria-pressed', String(enabled));
    carouselToggle.title = enabled ? '退出轮播 (p)' : '进入轮播 (p)';
    carouselToggle.setAttribute('aria-label', carouselToggle.title);
    if (enabled) {
      carouselPaused = false;
      carouselQueue = [];
      document.activeElement?.blur();
      try {
        if (!fullscreenElement()) await enterFullscreen(lightbox);
      } catch (_) {
        const notice = carouselHud.querySelector('.carousel-notice');
        notice.textContent = '已使用网页全屏';
        notice.hidden = false;
        setTimeout(() => { notice.hidden = true; }, 2600);
      }
      showChrome();
      scheduleCarousel();
    } else {
      clearCarouselTimer();
      if (fullscreenElement() === lightbox) exitFullscreen().catch(() => {});
      showChrome();
    }
  };

  carouselToggle.addEventListener('click', () => setCarousel(true));
  carouselHud.addEventListener('click', event => {
    if (event.target.closest('[data-carousel-exit]')) setCarousel(false);
    const pause = event.target.closest('[data-carousel-pause]');
    if (pause) {
      carouselPaused = !carouselPaused;
      pause.textContent = carouselPaused ? '继续' : '暂停';
      if (carouselPaused) clearCarouselTimer(); else scheduleCarousel();
      showChrome();
    }
  });
  const handleFullscreenChange = () => {
    if (!fullscreenElement() && lightbox.classList.contains('carousel-mode')) {
      lightbox.classList.remove('carousel-mode');
      carouselToggle.setAttribute('aria-pressed', 'false');
      carouselToggle.title = '进入轮播 (p)';
      carouselToggle.setAttribute('aria-label', carouselToggle.title);
      carouselPaused = false;
      clearCarouselTimer();
    }
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  const closeLightbox = () => {
    if (lightbox.hidden || deleting) return;
    if (history.state?.galleryPreview) {
      history.back();
      return;
    }
    clearTimeout(chromeTimer);
    mouseInChromeZone = false;
    setCarousel(false);
    if (deleteDialog.open) deleteDialog.close();
    lightboxStage.getAnimations({subtree: true}).forEach(animation => animation.cancel());
    lightboxStage.querySelectorAll('.preview-outgoing,.backdrop-outgoing').forEach(layer => layer.remove());
    lightbox.hidden = true;
    commentsDrawer.hidden = true;
    commentToggle.setAttribute('aria-expanded', 'false');
    viewerExtras.hidden = true;
    moreToggle.setAttribute('aria-expanded', 'false');
    moreToggle.classList.remove('open');
    previewRequest++;
    clearTimeout(loadingTimer);
    clearTimeout(chromeTimer);
    lightboxImage.removeAttribute('src');
    lightboxPlaceholder.removeAttribute('src');
    lightboxBackdrop.style.backgroundImage = '';
    adjacentPreloads = [];
    document.body.classList.remove('lightbox-open');
    document.querySelector('main').inert = false;
    scrollJumps.inert = false;
    filterDirectory();
    scheduleThumbnails();
    if (previewTrigger && !previewTrigger.hidden) directoryViewModel.focus(previewTrigger, mobileTouch.matches);
    else galleryToggle.focus({preventScroll: true});
    previewTrigger = null;
    history.replaceState({...history.state, previewImage: null}, '');
  };

  const animatePreview = (outgoing, outgoingBackdrop, direction, effect, gestureOffset = null, gestureIncoming = null) => {
    lightboxStage.getAnimations({subtree: true}).forEach(animation => animation.cancel());
    lightboxStage.querySelectorAll('.preview-outgoing').forEach(image => {
      if (image !== outgoing) image.remove();
    });
    lightboxStage.querySelectorAll('.backdrop-outgoing').forEach(layer => {
      if (layer !== outgoingBackdrop) layer.remove();
    });
    const vertical = mobileTouch.matches;
    const translate = amount => vertical
      ? `translate3d(0, ${amount}%, 0)`
      : `translate3d(${amount}%, 0, 0)`;
    let outgoingFrames;
    let incomingFrames;
    if (gestureOffset !== null) {
      const axisSize = vertical ? lightboxStage.clientHeight : lightboxStage.clientWidth;
      const translatePixels = amount => vertical
        ? `translate3d(0,${amount}px,0)`
        : `translate3d(${amount}px,0,0)`;
      outgoingFrames = [
        {transform: translatePixels(gestureOffset), opacity: 1},
        {transform: translatePixels(-direction * axisSize), opacity: 1}
      ];
      incomingFrames = [
        {transform: translatePixels(direction * axisSize + gestureOffset), opacity: 1},
        {transform: translatePixels(0), opacity: 1}
      ];
    } else if (reducedMotion.matches) {
      outgoingFrames = [{opacity: 1}, {opacity: 0}];
      incomingFrames = [{opacity: 0}, {opacity: 1}];
    } else if (effect === 'drift') {
      outgoingFrames = [
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1},
        {transform: `translate3d(${-direction * 9}%,0,0) scale(1.025)`, opacity: 0}
      ];
      incomingFrames = [
        {transform: `translate3d(${direction * 11}%,0,0) scale(.975)`, opacity: 0},
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1}
      ];
    } else if (effect === 'lift') {
      outgoingFrames = [
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1},
        {transform: `translate3d(0,${-direction * 10}%,0) scale(.98)`, opacity: 0}
      ];
      incomingFrames = [
        {transform: `translate3d(0,${direction * 13}%,0) scale(1.02)`, opacity: 0},
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1}
      ];
    } else if (effect === 'depth') {
      outgoingFrames = [
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1},
        {transform: 'translate3d(0,0,0) scale(1.075)', opacity: 0}
      ];
      incomingFrames = [
        {transform: 'translate3d(0,0,0) scale(.92)', opacity: 0},
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1}
      ];
    } else if (effect === 'soft-focus') {
      outgoingFrames = [
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1},
        {transform: `translate3d(${direction * -3}%,0,0) scale(1.035)`, opacity: 0}
      ];
      incomingFrames = [
        {transform: `translate3d(${direction * 3}%,0,0) scale(1.035)`, opacity: 0},
        {transform: 'translate3d(0,0,0) scale(1)', opacity: 1}
      ];
    } else if (effect === 'curtain') {
      outgoingFrames = [
        {transform: 'translate3d(0,0,0) scaleX(1)', opacity: 1},
        {transform: `translate3d(${direction * -7}%,0,0) scaleX(.94)`, opacity: 0}
      ];
      incomingFrames = [
        {transform: `translate3d(${direction * 7}%,0,0) scaleX(.94)`, opacity: 0},
        {transform: 'translate3d(0,0,0) scaleX(1)', opacity: 1}
      ];
    } else {
      outgoingFrames = [
        {transform: translate(0), opacity: 1},
        {transform: translate(-direction * 12), opacity: 0}
      ];
      incomingFrames = [
        {transform: translate(direction * 12), opacity: 0},
        {transform: translate(0), opacity: 1}
      ];
    }
    const carouselTransition = Boolean(effect) && !reducedMotion.matches;
    const gestureTransition = gestureOffset !== null;
    const outgoingAnimation = outgoing.animate(outgoingFrames, {
      duration: gestureTransition ? 230 : reducedMotion.matches ? 130 : carouselTransition ? 720 : 280,
      easing: gestureTransition ? 'cubic-bezier(.22,.75,.28,1)' : 'cubic-bezier(.4,0,1,1)'
    });
    const incomingTarget = gestureIncoming || lightboxImage;
    const incomingAnimation = incomingTarget.animate(incomingFrames, {
      duration: gestureTransition ? 230 : reducedMotion.matches ? 130 : carouselTransition ? 980 : 280,
      easing: 'cubic-bezier(.16,1,.3,1)'
    });
    outgoingAnimation.finished.catch(() => {}).finally(() => outgoing.remove());
    if (gestureIncoming) incomingAnimation.finished.catch(() => {}).finally(() => gestureIncoming.remove());
    if (outgoingBackdrop) {
      const backdropDuration = reducedMotion.matches ? 150 : effect ? 1050 : 320;
      const backdropOptions = {duration: backdropDuration, easing: 'cubic-bezier(.16,1,.3,1)'};
      const outgoingBackdropAnimation = outgoingBackdrop.animate(reducedMotion.matches
        ? [{opacity: .66}, {opacity: 0}]
        : [
            {transform: 'scale(1.08)', opacity: .66},
            {transform: 'scale(1.14)', opacity: 0}
          ], backdropOptions);
      lightboxBackdrop.animate(reducedMotion.matches
        ? [{opacity: 0}, {opacity: .66}]
        : [
            {transform: 'scale(1.14)', opacity: 0},
            {transform: 'scale(1.08)', opacity: .66}
          ], backdropOptions);
      outgoingBackdropAnimation.finished.catch(() => {}).finally(() => outgoingBackdrop.remove());
    }
  };

  const loadPreviewImage = async entry => {
    const request = ++previewRequest;
    clearTimeout(loadingTimer);
    imageLoading.hidden = true;
    imageLoadError.hidden = true;
    lightboxImage.classList.add('loading');
    const load = async source => {
      const pending = new Image();
      pending.src = source;
      await pending.decode();
      return pending;
    };
    loadingTimer = setTimeout(() => {
      if (previewTrigger === entry && request === previewRequest) imageLoading.hidden = false;
    }, 180);
    try {
      let loaded;
      try {
        loaded = await load(entry.previewSrc);
      } catch (error) {
        if (entry.previewSrc === entry.originalSrc) throw error;
        loaded = await load(entry.originalSrc);
      }
      if (previewTrigger !== entry || request !== previewRequest || lightbox.hidden) return;
      lightboxImage.src = loaded.src;
      lightboxImage.classList.remove('loading');
      lightboxPlaceholder.classList.add('loaded');
      imageLoading.hidden = true;
      zoom.originalLoaded = loaded.src === new URL(entry.originalSrc, location.href).href;
      updateImageInfo();
      updateLightboxStatePosition();
    } catch (_) {
      if (previewTrigger !== entry || request !== previewRequest) return;
      imageLoading.hidden = true;
      imageLoadError.hidden = false;
    } finally {
      clearTimeout(loadingTimer);
    }
  };

  imageLoadError.querySelector('button').addEventListener('click', () => {
    if (previewTrigger) loadPreviewImage(previewTrigger);
  });

  const showPreview = (entry, direction = 0, effect = null, gestureOffset = null) => {
    lastImageTap = null;
    let outgoing = null;
    let outgoingBackdrop = null;
    let gestureIncoming = null;
    if (!lightbox.hidden && direction) {
      if (gestureOffset !== null) {
        gestureIncoming = lightboxStage.querySelector(`.gesture-neighbour[data-direction="${direction}"]`);
      }
      outgoing = lightboxImage.cloneNode();
      outgoing.classList.add('preview-outgoing');
      outgoing.setAttribute('aria-hidden', 'true');
      lightboxStage.append(outgoing);
      if (lightbox.classList.contains('carousel-mode')) {
        outgoingBackdrop = lightboxBackdrop.cloneNode();
        outgoingBackdrop.classList.add('backdrop-outgoing');
        lightboxStage.append(outgoingBackdrop);
      }
    }
    if (gestureOffset !== null) clearGestureLayers(gestureIncoming);
    const opening = lightbox.hidden;
    if (opening && mobileTouch.matches && !history.state?.galleryPreview) {
      const state = {...history.state, previewImage: null, scrollX, scrollY};
      history.replaceState(state, '');
      history.pushState({...state, galleryPreview: true}, '');
    }
    previewTrigger = entry;
    lightbox.dataset.filePath = entry.filePath;
    const name = entry.name;
    const thumbnailSource = currentThumbnailSource(entry);
    lightboxPlaceholder.src = thumbnailSource;
    lightboxPlaceholder.classList.remove('loaded');
    lightboxBackdrop.style.backgroundImage = `url(${JSON.stringify(thumbnailSource)})`;
    lightboxImage.alt = name;
    lightboxCaption.textContent = name;
    zoom = {scale: 1, x: 0, y: 0, mode: 'fit', originalLoaded: false};
    applyZoom();
    loadPreviewImage(entry);
    favouriteError.hidden = true;
    imageTagError.hidden = true;
    updateFavouriteButton();
    updateImageControls();
    resetCommentComposer();
    renderGalleryComments();
    loadGalleryComments();
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    document.querySelector('main').inert = true;
    scrollJumps.inert = true;
    if (opening) {
      clearTimeout(chromeTimer);
      mouseInChromeZone = false;
      lightbox.classList.add('chrome-hidden');
      lightboxClose.focus({preventScroll: true});
    }
    history.replaceState({...history.state, previewImage: entry.listHref}, '');
    updatePreviewButtons();
    renderFilmstrip();
    preloadAdjacentImages();
    if (outgoing) animatePreview(outgoing, outgoingBackdrop, direction, effect, gestureOffset, gestureIncoming);
  };

  const openLightbox = entry => showPreview(entry);

  const switchPreview = (entry, direction, effect = null, gestureOffset = null) => {
    if (!entry || entry === previewTrigger || deleting || deleteDialog.open) return;
    if (effect && !lightbox.classList.contains('carousel-mode')) return;
    showPreview(entry, direction, effect, gestureOffset);
    scheduleCarousel();
  };

  const deleteImage = async () => {
    if (moving || marking || deleting || !previewTrigger || pendingFavourites.has(previewTrigger)) return;
    const entry = previewTrigger;
    deleting = true;
    deleteConfirm.disabled = deleteCancel.disabled = lightboxClose.disabled = true;
    deleteConfirm.textContent = '正在删除…';
    deleteError.hidden = true;
    try {
      const response = await fetch(entry.listHref, {method: 'DELETE'});
      if (!response.ok) throw new Error('删除失败，请检查文件是否存在且可写后重试。');
      const entries = visibleImages();
      const index = entries.indexOf(entry);
      const nextEntry = entries[index + 1] || entries[index - 1];
      if (deleteDialog.open) deleteDialog.close();
      directoryViewModel.remove(entry);
      refreshImageFilters();
      filterDirectory();
      deleting = false;
      updateImageControls();
      if (nextEntry) openLightbox(nextEntry);
      else {
        previewTrigger = null;
        closeLightbox();
      }
    } catch (error) {
      if (!deleteDialog.open) showDeleteDialog();
      deleteError.textContent = error.message;
      deleteError.hidden = false;
    } finally {
      deleting = false;
      deleteConfirm.disabled = deleteCancel.disabled = lightboxClose.disabled = false;
      deleteConfirm.textContent = '删除图片';
      if (deleteDialog.open) deleteCancel.focus();
      else if (!lightbox.hidden) lightboxClose.focus();
    }
  };

  deleteConfirm.addEventListener('click', deleteImage);
  deleteCancel.addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('cancel', event => {
    if (deleting) event.preventDefault();
  });
  deleteDialog.addEventListener('close', scheduleCarousel);

  listing.addEventListener('click', event => {
    const entry = directoryViewModel.fromNode(event.target.closest('.entry.image[data-preview-src]'));
    if (!listing.classList.contains('gallery') || !entry) return;
    event.preventDefault();
    if (selectingImages) {
      toggleImageSelection(entry);
      return;
    }
    openLightbox(entry);
  });
  listing.addEventListener('keydown', event => {
    const entry = directoryViewModel.fromNode(event.target.closest('.entry.image[data-preview-src]'));
    if (!selectingImages || !entry || event.key !== ' ' || event.target.getAttribute('role') !== 'checkbox') return;
    event.preventDefault();
    toggleImageSelection(entry);
  });

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && button !== lightboxClose && !lightbox.hidden) showChrome();
  });
  const updateMouseChrome = event => {
    if (event.pointerType !== 'mouse' || lightbox.hidden) return;
    const controls = figure.querySelector('figcaption').getBoundingClientRect();
    const inChromeZone = event.clientY >= Math.max(0, controls.top - 48);
    if (inChromeZone) {
      mouseInChromeZone = true;
      showChrome(true);
    } else if (mouseInChromeZone) {
      mouseInChromeZone = false;
      showChrome();
    }
  };
  lightbox.addEventListener('pointermove', updateMouseChrome, {passive: true});
  lightbox.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse' || !mouseInChromeZone) return;
    mouseInChromeZone = false;
    showChrome();
  });
  const activePointers = new Map();
  const clearGestureLayers = (preserve = null) => {
    lightboxStage.querySelectorAll('.gesture-neighbour').forEach(image => {
      if (image !== preserve) image.remove();
    });
    lightboxImage.style.removeProperty('--gesture-x');
    lightboxImage.style.removeProperty('--gesture-y');
    lightboxPlaceholder.style.removeProperty('--gesture-x');
    lightboxPlaceholder.style.removeProperty('--gesture-y');
  };
  const gestureNeighbour = direction => {
    const entries = visibleImages();
    const entry = entries[entries.indexOf(previewTrigger) + direction];
    if (!entry) return null;
    let image = lightboxStage.querySelector(`.gesture-neighbour[data-direction="${direction}"]`);
    if (!image) {
      image = document.createElement('img');
      image.className = 'gesture-neighbour';
      image.dataset.direction = direction;
      image.src = currentThumbnailSource(entry);
      image.alt = '';
      image.draggable = false;
      lightboxStage.append(image);
    }
    return image;
  };
  lightbox.addEventListener('pointerdown', event => {
    if (deleting || deleteDialog.open || event.target.closest('button, dialog, a, input, textarea, .gallery-comments') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    activePointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    lightbox.setPointerCapture?.(event.pointerId);
    if (activePointers.size === 2) {
      const points = Array.from(activePointers.values());
      pointerGesture = {pinch: true, distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), scale: zoom.scale};
      return;
    }
    pointerGesture = {id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, time: performance.now(), velocity: 0, moved: false, imageTap: event.target === lightboxImage || event.target === lightboxPlaceholder};
  });
  lightbox.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId) || !pointerGesture) return;
    activePointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (activePointers.size >= 2 && pointerGesture.pinch) {
      const points = Array.from(activePointers.values());
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      setZoom(pointerGesture.scale * distance / Math.max(1, pointerGesture.distance));
      event.preventDefault();
      return;
    }
    if (event.pointerId !== pointerGesture.id) return;
    const now = performance.now();
    const dx = event.clientX - pointerGesture.x;
    const dy = event.clientY - pointerGesture.y;
    const delta = mobileTouch.matches ? dy : dx;
    const stepX = event.clientX - pointerGesture.lastX;
    const stepY = event.clientY - pointerGesture.lastY;
    pointerGesture.velocity = (mobileTouch.matches ? stepY : stepX) / Math.max(1, now - pointerGesture.time);
    pointerGesture.lastX = event.clientX;
    pointerGesture.lastY = event.clientY;
    pointerGesture.time = now;
    pointerGesture.moved ||= Math.hypot(dx, dy) > 8;
    if (zoom.scale > 1.01) {
      zoom.x += stepX;
      zoom.y += stepY;
      applyZoom();
    } else if (Math.abs(delta) > Math.abs(mobileTouch.matches ? dx : dy)) {
      const direction = delta < 0 ? 1 : -1;
      const neighbour = gestureNeighbour(direction);
      const resisted = neighbour ? delta : delta * .28;
      const axisSize = mobileTouch.matches ? lightboxStage.clientHeight : lightboxStage.clientWidth;
      const x = mobileTouch.matches ? 0 : resisted;
      const y = mobileTouch.matches ? resisted : 0;
      lightboxImage.style.setProperty('--gesture-x', `${x}px`);
      lightboxImage.style.setProperty('--gesture-y', `${y}px`);
      lightboxPlaceholder.style.setProperty('--gesture-x', `${x}px`);
      lightboxPlaceholder.style.setProperty('--gesture-y', `${y}px`);
      if (neighbour) {
        const origin = direction * axisSize + resisted;
        neighbour.style.transform = mobileTouch.matches ? `translate3d(0,${origin}px,0)` : `translate3d(${origin}px,0,0)`;
      }
    }
    event.preventDefault();
  });
  const finishPointer = event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    if (!pointerGesture || pointerGesture.pinch) {
      if (activePointers.size === 0) pointerGesture = null;
      return;
    }
    const gesture = pointerGesture;
    pointerGesture = null;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const delta = mobileTouch.matches ? dy : dx;
    const threshold = (mobileTouch.matches ? lightboxStage.clientHeight : lightboxStage.clientWidth) * .22;
    if (zoom.scale <= 1.01 && (Math.abs(delta) >= threshold || Math.abs(gesture.velocity) >= .55)) {
      lastImageTap = null;
      if (stepPreview(delta < 0 ? 1 : -1, delta)) return;
    }
    clearGestureLayers();
    applyZoom();
    if (gesture.moved) return;
    showChrome();
    if (!gesture.imageTap) {
      lastImageTap = null;
      return;
    }
    const now = performance.now();
    const doubleTap = lastImageTap && now - lastImageTap.time < 320
      && Math.hypot(event.clientX - lastImageTap.x, event.clientY - lastImageTap.y) < 36;
    if (doubleTap && mobileTouch.matches) {
      clearTimeout(lastImageTap.timer);
      lastImageTap = null;
      toggleFavourite({x: event.clientX, y: event.clientY});
    } else if (doubleTap) {
      clearTimeout(lastImageTap.timer);
      lastImageTap = null;
      setViewMode(zoom.scale > 1.01 ? 'fit' : 'actual');
    } else if (mobileTouch.matches) {
      const tap = {time: now, x: event.clientX, y: event.clientY};
      tap.timer = setTimeout(() => {
        if (lastImageTap !== tap) return;
        lastImageTap = null;
      }, 320);
      lastImageTap = tap;
    } else {
      lastImageTap = null;
    }
  };
  lightbox.addEventListener('pointerup', finishPointer);
  lightbox.addEventListener('pointercancel', event => {
    activePointers.delete(event.pointerId);
    pointerGesture = null;
    clearGestureLayers();
    applyZoom();
  });
  lightboxStage.addEventListener('wheel', event => {
    if (lightbox.hidden) return;
    event.preventDefault();
    setZoom(zoom.scale * Math.exp(-event.deltaY * .0015), {x: event.clientX, y: event.clientY});
    showChrome();
  }, {passive: false});
  document.addEventListener('paste', event => {
    if (lightbox.hidden || deleting || deleteDialog.open || event.defaultPrevented) return;
    if (event.target.closest?.('input, textarea, select') || event.target.isContentEditable) return;
    const body = event.clipboardData?.getData('text/plain').trim() || '';
    if (!body) return;
    event.preventDefault();
    appendPastedGalleryComment(body);
  });
  let galleryJumpTimer = null;
  const resetGalleryJump = () => {
    clearTimeout(galleryJumpTimer);
    galleryJumpTimer = null;
  };
  window.addEventListener('blur', resetGalleryJump);
  document.addEventListener('keydown', event => {
    const pendingJump = galleryJumpTimer !== null;
    resetGalleryJump();
    if (!listing.classList.contains('gallery') || !lightbox.hidden ||
        event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        event.isComposing || event.repeat || document.querySelector('dialog[open]') ||
        event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
    if (event.key === 'G') {
      event.preventDefault();
      jumpScroll(document.documentElement.scrollHeight);
    } else if (event.key === 'g') {
      event.preventDefault();
      if (pendingJump) jumpScroll(0);
      else galleryJumpTimer = setTimeout(resetGalleryJump, 500);
    }
  });
  document.addEventListener('keydown', event => {
    if (deleting || deleteDialog.open) return;
    const commentEditorActive = !commentsDrawer.hidden
      && (event.target === galleryCommentAuthor || event.target === galleryCommentBody);
    if (commentEditorActive) {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.target.blur();
      } else if (event.target === galleryCommentAuthor && event.key === 'Enter') {
        event.preventDefault();
        galleryCommentBody.focus();
      } else if (event.target === galleryCommentBody && event.key === 'Enter') {
        event.preventDefault();
        if (event.metaKey) {
          galleryCommentBody.setRangeText('\n', galleryCommentBody.selectionStart, galleryCommentBody.selectionEnd, 'end');
        } else {
          galleryCommentComposer.requestSubmit();
        }
      }
      return;
    }
    if (event.key === 'Escape') {
      if (selectingImages && lightbox.hidden && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        if (!event.repeat) setImageSelection(false);
        return;
      }
      if (!commentsDrawer.hidden) closeGalleryComments();
      else if (!viewerExtras.hidden) {
        viewerExtras.hidden = true;
        moreToggle.setAttribute('aria-expanded', 'false');
        moreToggle.classList.remove('open');
      }
      else if (lightbox.classList.contains('carousel-mode')) setCarousel(false);
      else closeLightbox();
      return;
    }
    if (lightbox.hidden) return;
    if (event.key === 'Tab') {
      const focusable = Array.from(lightbox.querySelectorAll('button:not(:disabled),a[href]'))
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement);
      const next = event.shiftKey
        ? focusable[(index <= 0 ? focusable.length : index) - 1]
        : focusable[(index + 1) % focusable.length];
      event.preventDefault();
      next.focus();
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!event.repeat) deleteImage();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
      return;
    }
    if (/^[1-5]$/.test(event.key)) {
      if (event.repeat || event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
      event.preventDefault();
      toggleImageTag(event.key);
      return;
    }
    if (event.key === ' ' && lightbox.classList.contains('carousel-mode')) {
      event.preventDefault();
      carouselPaused = !carouselPaused;
      carouselHud.querySelector('[data-carousel-pause]').textContent = carouselPaused ? '继续' : '暂停';
      if (carouselPaused) clearCarouselTimer(); else scheduleCarousel();
      showChrome();
      return;
    }
    if (event.key === 'p') {
      if (event.repeat || event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
      event.preventDefault();
      setCarousel(!lightbox.classList.contains('carousel-mode'));
      return;
    }
    if (event.key === 'f') {
      if (event.repeat || event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
      event.preventDefault();
      toggleFavourite();
      return;
    }
    if (event.key.toLowerCase() === 'c') {
      if (event.repeat || event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
      event.preventDefault();
      toggleGalleryComments();
      return;
    }
    let direction;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'j') direction = -1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'k') direction = 1;
    else return;
    event.preventDefault();
    stepPreview(direction);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearCarouselTimer();
    else scheduleCarousel();
  });

  galleryToggle.addEventListener('click', () => {
    if (deleting) return;
    const enabled = !listing.classList.contains('gallery');
    if (!enabled) closeLightbox();
    setGallery(enabled);
  });

  const directoryView = new URLSearchParams(location.search).get('view')
    ?? localStorage.getItem(DIRECTORY_VIEW_KEY);
  setGallery(galleryAvailable && directoryView === 'gallery', false);
  const requestedImage = new URLSearchParams(location.search).get('open');
  if (requestedImage) {
    const entry = imageModel().find(item => entryName(item) === requestedImage);
    if (entry) {
      setGallery(true, false);
      openLightbox(entry);
      const url = new URL(location.href);
      url.searchParams.delete('open');
      history.replaceState(history.state, '', url);
    }
  }
  updateImageControls();
  window.addEventListener('popstate', () => {
    if (!mobileTouch.matches) return;
    setImageSelection(Boolean(history.state?.gallerySelection), false);
    if (history.state?.galleryPreview) {
      const entry = visibleImages()
        .find(entry => entry.listHref === history.state.previewImage);
      if (entry) openLightbox(entry);
    } else {
      closeLightbox();
    }
  });
  if (listing.classList.contains('gallery') && history.state?.gallerySelection) {
    setImageSelection(true, false);
  }
  if (listing.classList.contains('gallery') && history.state?.previewImage) {
    const entry = visibleImages()
      .find(entry => entry.listHref === history.state.previewImage);
    if (entry) openLightbox(entry);
  }
}

directoryViewModel.render();
if (history.state?.scrollY !== undefined) {
  window.scrollTo(history.state.scrollX, history.state.scrollY);
  directoryViewModel.render();
}

})();
