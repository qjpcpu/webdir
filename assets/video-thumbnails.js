(() => {
  const pending = new Map();
  const queue = [];
  let active = 0;

  const capture = async entry => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    document.body.append(video);
    let timer;
    try {
      await new Promise((resolve, reject) => {
        const fail = () => reject(new Error('浏览器无法生成这个视频的封面'));
        timer = setTimeout(fail, 30000);
        video.onerror = fail;
        video.onloadeddata = () => {
          video.onloadeddata = null;
          const time = Math.min(1, video.duration / 2);
          if (time > 0) {
            video.onseeked = resolve;
            video.currentTime = time;
          } else resolve();
        };
        video.src = entry.originalSrc;
        video.load();
      });
      return await Promise.all([512, 2560].map(maxEdge => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return new Promise((resolve, reject) => canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('视频封面生成失败'));
        }, 'image/jpeg', maxEdge === 512 ? .85 : .92));
      }));
    } finally {
      clearTimeout(timer);
      video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
  };

  const load = async entry => {
    const sources = [entry.gallerySrc, entry.previewSrc];
    const responses = await Promise.all(sources.map(source => fetch(source, {method: 'HEAD'})));
    if (responses.every(response => response.ok)) return entry.gallerySrc;
    if (responses.some(response => !response.ok && response.status !== 404)) throw new Error('视频封面加载失败');
    const blobs = await capture(entry);
    const uploaded = await Promise.all(sources.map((source, index) => fetch(source, {
      method: 'POST', headers: {'Content-Type': 'image/jpeg'}, body: blobs[index]
    })));
    if (uploaded.some(response => !response.ok)) throw new Error('视频封面保存失败');
    return entry.gallerySrc;
  };

  const run = () => {
    while (active < 2 && queue.length) {
      const {entry, resolve, reject} = queue.shift();
      active++;
      load(entry).then(resolve, reject).finally(() => { active--; run(); });
    }
  };
  window.loadVideoThumbnail = entry => {
    if (!pending.has(entry.gallerySrc)) {
      pending.set(entry.gallerySrc, new Promise((resolve, reject) => {
        queue.push({entry, resolve, reject});
        run();
      }));
    }
    return pending.get(entry.gallerySrc);
  };
})();
