const reviewCards = new Map();
let reviewRunIndex = [];
let reviewLocations = new Map();
let reviewFollowFrame;
let reviewFollowFromScroll = false;
let lastResolvedCommentId = null;

function findUnique(haystack, needle) {
  if (!needle) return -1;
  const first = haystack.indexOf(needle);
  return first < 0 || haystack.indexOf(needle, first + 1) >= 0 ? -1 : first;
}
function exactReviewAnchor(text, anchor) {
  const quote = String(anchor.quote || '');
  if (!quote) return null;
  const prefix = String(anchor.prefix || ''), suffix = String(anchor.suffix || '');
  const context = `${prefix}${quote}${suffix}`;
  const contextual = findUnique(text, context);
  if (contextual >= 0) return {start: contextual + prefix.length, end: contextual + prefix.length + quote.length};
  if (prefix || suffix) return null;
  const start = Number(anchor.start), end = Number(anchor.end);
  if (Number.isFinite(start) && Number.isFinite(end) && text.slice(start, end) === quote) return {start, end};
  const found = findUnique(text, quote);
  return found < 0 ? null : {start: found, end: found + quote.length};
}
function betweenReviewContext(text, anchor) {
  const prefix = String(anchor.prefix || ''), suffix = String(anchor.suffix || '');
  if ((!prefix.trim() && !anchor.atStart) || (!suffix.trim() && !anchor.atEnd)) return null;
  const left = anchor.atStart ? 0 : findUnique(text, prefix);
  const right = anchor.atEnd ? text.trimEnd().length : findUnique(text, suffix);
  const start = anchor.atStart ? 0 : left + prefix.length;
  if (left < 0 || right <= start) return null;
  const replacement = text.slice(start, right);
  if (!replacement.trim() || /\n\s*\n/.test(replacement.trim())) return null;
  return {start, end: right};
}
function resolveReviewScope(scope) {
  if (!scope || scope.type !== 'range') return null;
  const anchor = scope;
  const paragraph = anchor.paragraph;
  if (paragraph) {
    const located = exactReviewAnchor(source.value, paragraph) || betweenReviewContext(source.value, paragraph);
    if (located) {
      const start = located.start + Number(anchor.start) - Number(paragraph.start);
      const end = start + String(anchor.quote || '').length;
      if (source.value.slice(located.start, located.end) === paragraph.quote && source.value.slice(start, end) === anchor.quote) {
        return {start, end, stale: false, kind: 'exact'};
      }
      const contextual = exactReviewAnchor(source.value, anchor);
      if (contextual && contextual.start >= located.start && contextual.end <= located.end) return {...contextual, stale: false, kind: 'exact'};
      const quote = findUnique(source.value.slice(located.start, located.end), String(anchor.quote || ''));
      if (quote >= 0) return {start: located.start + quote, end: located.start + quote + anchor.quote.length, stale: false, kind: 'exact'};
      return {...located, stale: false, kind: 'paragraph'};
    }
  } else {
    const exact = exactReviewAnchor(source.value, anchor);
    if (exact) return {...exact, stale: false, kind: 'exact'};
    const located = betweenReviewContext(source.value, anchor);
    if (located) return {...located, stale: false, kind: 'paragraph'};
  }
  return {start: -1, end: -1, stale: true, kind: 'missing'};
}
function captureReviewParagraph(startRun, endRun) {
  const block = run => run.closest('p,li,pre,blockquote,td,th,h1,h2,h3,h4,h5,h6') || run;
  const runs = [...block(startRun).querySelectorAll('.source-run'), ...block(endRun).querySelectorAll('.source-run')];
  if (!runs.length) return null;
  const start = Math.min(...runs.map(run => Number(run.dataset.sourceStart)));
  const end = Math.max(...runs.map(run => Number(run.dataset.sourceEnd)));
  return {start, end, quote: source.value.slice(start, end), prefix: source.value.slice(Math.max(0, start - 64), start), suffix: source.value.slice(end, end + 64), atStart: !source.value.slice(0, start).trim(), atEnd: !source.value.slice(end).trim()};
}
function runsForReview(resolved) {
  if (!resolved || resolved.stale) return [];
  let low = 0, high = reviewRunIndex.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (reviewRunIndex[middle].end <= resolved.start) low = middle + 1;
    else high = middle;
  }
  const runs = [];
  for (let index = low; index < reviewRunIndex.length && reviewRunIndex[index].start < resolved.end; index++) {
    runs.push(reviewRunIndex[index].run);
  }
  return runs;
}
function reviewTextBoundary(run, sourceOffset) {
  const start = Number(run.dataset.sourceStart), end = Number(run.dataset.sourceEnd);
  let offset = Math.round(Math.max(0, Math.min(1, (sourceOffset - start) / (end - start))) * run.textContent.length);
  const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (offset <= node.length) return {node, offset};
    offset -= node.length;
    node = walker.nextNode();
  }
  return {node: run, offset: run.childNodes.length};
}
function markReviewRanges(resolvedScopes) {
  reviewRunIndex = Array.from(article.querySelectorAll('.source-run'), run => ({run, start: Number(run.dataset.sourceStart), end: Number(run.dataset.sourceEnd)}));
  reviewRunIndex.sort((a, b) => a.start - b.start);
  reviewRunIndex.forEach(({run}) => {
    run.classList.remove('has-review', 'has-addressed-review', 'has-resolved-review', 'review-target');
    delete run.dataset.commentIds;
  });
  const highlights = {open: [], addressed: [], resolved: []};
  reviewLocations = new Map();
  for (const comment of reviewDocument.comments) {
    const resolved = resolvedScopes.get(comment.id), runs = runsForReview(resolved);
    if (!runs.length) continue;
    const range = document.createRange();
    const start = reviewTextBoundary(runs[0], resolved.start), end = reviewTextBoundary(runs.at(-1), resolved.end);
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    reviewLocations.set(comment.id, {range, runs, resolved});
    highlights[comment.status]?.push(range);
    runs.forEach(run => {
      run.classList.add(comment.status === 'resolved' ? 'has-resolved-review' : comment.status === 'addressed' ? 'has-addressed-review' : 'has-review');
      run.dataset.commentIds = [...(run.dataset.commentIds?.split(',') || []), comment.id].join(',');
    });
  }
  for (const [status, ranges] of Object.entries(highlights)) CSS.highlights.set(`review-${status}`, new Highlight(...ranges));
  updateActiveReview();
}
function messageMarkup(message, index, commentId) {
  const date = new Date(message.created_at);
  const shownDate = Number.isNaN(date.getTime()) ? message.created_at : date.toLocaleString();
  const edited = message.edited_at ? ' · 已编辑' : '';
  return `<section class="message" data-comment-id="${escapeReviewHtml(commentId)}" data-message-id="${escapeReviewHtml(message.id || '')}" data-message-index="${index}"><header><strong>${escapeReviewHtml(message.author)}</strong><span><time>${escapeReviewHtml(shownDate)}</time>${edited}</span></header><p>${escapeReviewHtml(message.body)}</p><div class="message-tools"><button type="button" data-message-action="edit">修改</button><button type="button" data-message-action="delete">删除</button></div></section>`;
}
function commentMarkup(comment, resolved, showDeleteButton) {
  const documentScope = comment.scope?.type === 'document';
  const quote = documentScope ? '全文评论' : (comment.scope?.display_quote || comment.scope?.quote || '选区评论');
  const anchorState = documentScope ? 'document' : resolved?.kind || 'missing';
  const locationLabel = {document: '全文讨论', exact: '已关联原文', paragraph: '原文已修改 · 已关联段落', missing: '原文关联已失效'}[anchorState];
  let buttons = documentScope ? '<button type="button" data-comment-action="edit-comment">编辑全文评论</button>' : '';
  buttons += '<button type="button" data-comment-action="reply">回复</button>';
  if (comment.status === 'open') buttons += '<button class="primary" type="button" data-comment-action="resolve">标记解决</button>';
  else if (comment.status === 'addressed') buttons += '<button class="primary" type="button" data-comment-action="resolve">确认解决</button><button type="button" data-comment-action="reopen">重新打开</button>';
  else if (comment.status === 'resolved') buttons += '<button type="button" data-comment-action="reopen">重新打开</button>';
  if (showDeleteButton) buttons += `<button type="button" data-comment-action="delete-comment">${documentScope ? '删除全文评论' : '删除整条评论'}</button>`;
  const messages = comment.messages.map((message, index) => messageMarkup(message, index, comment.id)).join('');
  const discussion = comment.status === 'resolved' ? `<details class="comment-history"><summary>查看 ${comment.messages.length} 条讨论与处理回复</summary>${messages}</details>` : messages;
  return `<div class="comment-meta"><span class="comment-status ${escapeReviewHtml(comment.status)}">${escapeReviewHtml(reviewStatusLabel(comment.status))}</span><span>${comment.messages.length} 条消息</span></div><div class="comment-location" data-anchor-state="${anchorState}"><span>${locationLabel}</span>${anchorState === 'missing' ? '' : '<button type="button" data-comment-action="locate">查看原文</button>'}</div><p class="comment-scope${anchorState === 'missing' ? ' stale' : ''}"><span class="comment-reference">${documentScope ? '讨论范围' : '评论时的原文'}</span>${escapeReviewHtml(quote)}</p>${anchorState === 'missing' ? '<p class="comment-anchor-help">原文已删除或无法确定位置。</p>' : ''}${discussion}<div class="comment-actions">${buttons}</div>`;
}
function updateReviewCard(card, markup) {
  if (card.reviewMarkup === markup) return;
  const drafts = [...card.querySelectorAll('.reply-box,.message-editor')].map(node => ({node, message: node.closest('.message')?.dataset}));
  const historyOpen = card.querySelector('.comment-history')?.open;
  card.innerHTML = markup;
  for (const {node, message} of drafts) {
    const target = message ? [...card.querySelectorAll('.message')].find(element => message.messageId ? element.dataset.messageId === message.messageId : element.dataset.messageIndex === message.messageIndex) : card;
    if (target) target.append(node);
  }
  if (historyOpen && card.querySelector('.comment-history')) card.querySelector('.comment-history').open = true;
  card.reviewMarkup = markup;
}
function renderReview() {
  const comments = reviewDocument.comments || [];
  const focused = commentList.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused?.tagName === 'TEXTAREA' ? [focused.selectionStart, focused.selectionEnd] : null;
  const scrollTop = commentList.scrollTop;
  const counts = {open: 0, addressed: 0, resolved: 0};
  comments.forEach(comment => { if (counts[comment.status] !== undefined) counts[comment.status] += 1; });
  document.querySelectorAll('[data-review-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.reviewFilter === reviewFilter);
    button.setAttribute('aria-pressed', String(button.dataset.reviewFilter === reviewFilter));
    button.querySelector('b').textContent = counts[button.dataset.reviewFilter] || 0;
  });
  document.querySelector('#review-count').textContent = counts.open + counts.addressed;
  document.querySelector('#review-summary').textContent = `${comments.length} 条讨论 · ${counts.resolved} 条已解决`;
  document.querySelector('#review-complete').hidden = comments.length === 0 || counts.open + counts.addressed > 0;
  const resolvedScopes = new Map(comments.map(comment => [comment.id, resolveReviewScope(comment.scope)]));
  const visible = comments.map((comment, index) => ({comment, index, resolved: resolvedScopes.get(comment.id)}))
    .filter(item => item.comment.status === reviewFilter)
    .sort((left, right) => {
      const position = item => {
        if (item.comment.scope?.type === 'document') return -1;
        if (!item.resolved || item.resolved.stale) return Number.POSITIVE_INFINITY;
        return item.resolved.start;
      };
      return position(left) - position(right) || left.index - right.index;
    });
  const lastDocumentComment = visible.findLast(item => item.comment.scope?.type === 'document');
  const lastRangeComment = visible.findLast(item => item.comment.scope?.type !== 'document');
  const wanted = new Set(visible.map(item => item.comment.id));
  for (const child of [...commentList.children]) if (!wanted.has(child.dataset.commentId)) child.remove();
  let cursor = commentList.firstElementChild;
  for (const item of visible) {
    let card = reviewCards.get(item.comment.id);
    if (!card) {
      card = document.createElement('article'); card.className = 'comment-card';
      card.dataset.commentId = item.comment.id;
      reviewCards.set(item.comment.id, card);
    }
    updateReviewCard(card, commentMarkup(item.comment, item.resolved, item === lastDocumentComment || item === lastRangeComment));
    card.dataset.anchorState = item.comment.scope?.type === 'document' ? 'document' : item.resolved?.kind || 'missing';
    if (card !== cursor) commentList.insertBefore(card, cursor);
    cursor = card.nextElementSibling;
  }
  const ids = new Set(comments.map(comment => comment.id));
  for (const id of reviewCards.keys()) if (!ids.has(id)) reviewCards.delete(id);
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'comment-empty';
    empty.textContent = reviewFilter === 'open' ? '暂无待处理评论。划选正文即可添加批注。' : `暂无${reviewStatusLabel(reviewFilter)}评论。`;
    commentList.replaceChildren(empty);
  }
  markReviewRanges(resolvedScopes);
  if (focused?.isConnected && document.activeElement !== focused) {
    focused.focus({preventScroll: true});
    if (selection) focused.setSelectionRange(...selection);
  }
  commentList.scrollTop = scrollTop;
  if (submittedCommentId) {
    const card = reviewCards.get(submittedCommentId);
    card?.classList.add('submitted');
    requestAnimationFrame(() => revealReviewCard(submittedCommentId));
  }
  scheduleReviewFollow();
}
function updateActiveReview() {
  for (const [id, card] of reviewCards) {
    card.classList.toggle('active', id === selectedCommentId);
    if (id === selectedCommentId && card.querySelector('.comment-history')) card.querySelector('.comment-history').open = true;
  }
  article.querySelectorAll('.review-target').forEach(run => run.classList.remove('review-target'));
  const location = reviewLocations.get(selectedCommentId);
  location?.runs.forEach(run => run.classList.add('review-target'));
  CSS.highlights.set('review-selected', new Highlight(...(location ? [location.range] : [])));
  const visible = [...commentList.querySelectorAll('.comment-card')];
  const index = visible.findIndex(card => card.dataset.commentId === selectedCommentId);
  document.querySelector('#review-position').textContent = index < 0 ? `${visible.length} 条讨论` : `${index + 1} / ${visible.length}`;
  document.querySelector('#review-previous').disabled = !visible.length || index === 0;
  document.querySelector('#review-next').disabled = !visible.length || index === visible.length - 1;
}
function revealReviewCard(id, anchorTop) {
  const card = reviewCards.get(id);
  if (!card?.isConnected) return;
  const bounds = card.getBoundingClientRect(), list = commentList.getBoundingClientRect();
  if (anchorTop !== undefined) {
    const top = Math.max(list.top + 8, Math.min(anchorTop, list.bottom - Math.min(bounds.height, list.height) - 8));
    commentList.scrollTop += bounds.top - top;
  } else if (bounds.top < list.top || bounds.bottom > list.bottom) {
    commentList.scrollTop += bounds.top - list.top - 8;
  }
}
function activateReview(id, locate = false) {
  const comment = reviewDocument.comments.find(item => item.id === id);
  if (!comment) return;
  selectedCommentId = id;
  const changeFilter = reviewFilter !== comment.status;
  reviewFilter = comment.status;
  openReviewPanel();
  if (changeFilter) renderReview();
  else updateActiveReview();
  if (locate) scrollToCommentSource(id);
  else revealReviewCard(id);
}
function scrollToCommentSource(commentId) {
  const comment = reviewDocument.comments.find(item => item.id === commentId);
  if (!comment) return;
  const location = reviewLocations.get(commentId);
  if (comment.scope?.type !== 'document' && !location) {
    showReviewToast('原文关联已失效'); return;
  }
  selectedCommentId = commentId;
  updateActiveReview();
  if (overlayReviewLayout.matches) {
    closeReviewPanel();
    document.querySelector('#review-return').hidden = false;
  }
  const target = location?.runs[0] || article;
  target.scrollIntoView({behavior: 'instant', block: 'center'});
  revealReviewCard(commentId, target.getBoundingClientRect().top);
}
function scheduleReviewFollow(fromScroll = false) {
  reviewFollowFromScroll ||= fromScroll === true;
  if (reviewFollowFrame) return;
  reviewFollowFrame = requestAnimationFrame(() => {
    reviewFollowFrame = null;
    const chooseFromViewport = reviewFollowFromScroll;
    reviewFollowFromScroll = false;
    if (submittedCommentId || overlayReviewLayout.matches || editing || document.body.classList.contains('review-closed') || commentList.querySelector('textarea:focus') || !reviewComposer.hidden) return;
    if (selectedCommentId && !chooseFromViewport) return;
    const top = reviewPanel.getBoundingClientRect().top;
    const locations = [...commentList.querySelectorAll('.comment-card')].map(card => {
      const location = reviewLocations.get(card.dataset.commentId);
      return location ? {id: card.dataset.commentId, rect: location.range.getBoundingClientRect()} : null;
    }).filter(item => item && item.rect.bottom > top && item.rect.top < innerHeight);
    const current = locations.find(item => item.id === selectedCommentId)
      || locations.sort((a, b) => Math.abs(a.rect.top - top) - Math.abs(b.rect.top - top))[0];
    if (!current) return;
    selectedCommentId = current.id;
    updateActiveReview();
    revealReviewCard(current.id, current.rect.top);
  });
}
function initializeReviewContext() {
  for (const [selector, direction] of [['#review-previous', -1], ['#review-next', 1]]) {
    document.querySelector(selector).addEventListener('click', () => {
      const cards = [...commentList.querySelectorAll('.comment-card')];
      const current = cards.findIndex(card => card.dataset.commentId === selectedCommentId);
      const next = cards[current < 0 ? 0 : current + direction];
      if (next) activateReview(next.dataset.commentId, !overlayReviewLayout.matches);
      else return;
      revealReviewCard(selectedCommentId);
    });
  }
  document.querySelector('#review-return').addEventListener('click', () => activateReview(selectedCommentId));
  document.querySelector('#review-show-resolved').addEventListener('click', () => activateReview(lastResolvedCommentId));
  window.addEventListener('scroll', () => scheduleReviewFollow(true), {passive: true});
  window.addEventListener('resize', scheduleReviewFollow, {passive: true});
  new ResizeObserver(scheduleReviewFollow).observe(article);
}
