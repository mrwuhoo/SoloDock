// Photo frame album: which photo to show, when to switch, captions and countdowns.
// Pure helpers shared by the renderer and Node tests.
(function exposeFrameDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchFrame = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFrameDomain() {
  const MAX_PHOTOS = 50;
  const CAPTION_LIMIT = 24;
  const ROTATE_MODES = ['open', 'daily'];
  const PHOTO_ID = /^photo-[a-z0-9-]{1,48}$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim())
    .slice(0, limit).join('');

  function dayKey(now = Date.now()) {
    const date = new Date(Number(now));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function normalizeFrame(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const seen = new Set();
    const photos = (Array.isArray(source.photos) ? source.photos : []).map((photo) => {
      if (!photo || typeof photo !== 'object' || !PHOTO_ID.test(String(photo.id || ''))) return null;
      if (seen.has(photo.id)) return null;
      seen.add(photo.id);
      const countdownTo = DATE.test(String(photo.countdownTo || '')) ? photo.countdownTo : '';
      return {
        id: photo.id,
        caption: clean(photo.caption, CAPTION_LIMIT),
        countdownTo,
        addedAt: Math.max(0, Number(photo.addedAt) || 0),
      };
    }).filter(Boolean).slice(0, MAX_PHOTOS);
    const ids = new Set(photos.map((photo) => photo.id));
    return {
      rotate: ROTATE_MODES.includes(source.rotate) ? source.rotate : 'open',
      pinnedId: ids.has(source.pinnedId) ? source.pinnedId : '',
      currentId: ids.has(source.currentId) ? source.currentId : (photos[0] ? photos[0].id : ''),
      shownOn: DATE.test(String(source.shownOn || '')) ? source.shownOn : '',
      photos,
    };
  }

  // Keep metadata for photos still on disk (in the saved order); append new files; drop missing ones.
  function reconcile(state, diskPhotos) {
    const current = normalizeFrame(state);
    const disk = (Array.isArray(diskPhotos) ? diskPhotos : [])
      .filter((photo) => photo && PHOTO_ID.test(String(photo.id || '')));
    const onDisk = new Map(disk.map((photo) => [photo.id, photo]));
    const kept = current.photos.filter((photo) => onDisk.has(photo.id));
    const known = new Set(kept.map((photo) => photo.id));
    const added = disk
      .filter((photo) => !known.has(photo.id))
      .sort((left, right) => (Number(left.addedAt) || 0) - (Number(right.addedAt) || 0))
      .map((photo) => ({ id: photo.id, caption: '', countdownTo: '', addedAt: Number(photo.addedAt) || 0 }));
    return normalizeFrame({ ...current, photos: [...kept, ...added] });
  }

  function visibleId(state) {
    const frame = normalizeFrame(state);
    return frame.pinnedId || frame.currentId || '';
  }

  function stepId(state, delta) {
    const frame = normalizeFrame(state);
    if (!frame.photos.length) return '';
    const index = Math.max(0, frame.photos.findIndex((photo) => photo.id === visibleId(frame)));
    const next = (index + delta + frame.photos.length * 2) % frame.photos.length;
    return frame.photos[next].id;
  }

  // Called when the panel opens: the album moves on (every open, or once a day); a pinned photo stays.
  function onPanelOpen(state, now = Date.now()) {
    const frame = normalizeFrame(state);
    if (frame.pinnedId || frame.photos.length < 2) return frame;
    const today = dayKey(now);
    if (frame.rotate === 'daily' && frame.shownOn === today) return frame;
    return { ...frame, currentId: stepId(frame, 1), shownOn: today };
  }

  function countdown(dateText, now = Date.now()) {
    if (!DATE.test(String(dateText || ''))) return null;
    const [year, month, day] = dateText.split('-').map(Number);
    const target = new Date(year, month - 1, day).getTime();
    const today = new Date(dayKey(now).replace(/-/g, '/')).getTime();
    const days = Math.round((target - today) / 86400000);
    if (days > 0) return { days, text: `还有 ${days} 天` };
    if (days === 0) return { days, text: '就是今天' };
    return { days, text: `${-days} 天前` };
  }

  function removePhoto(state, id) {
    const frame = normalizeFrame(state);
    const index = frame.photos.findIndex((photo) => photo.id === id);
    if (index < 0) return frame;
    const photos = frame.photos.filter((photo) => photo.id !== id);
    const fallback = photos.length ? photos[Math.min(index, photos.length - 1)].id : '';
    return normalizeFrame({
      ...frame,
      photos,
      pinnedId: frame.pinnedId === id ? '' : frame.pinnedId,
      currentId: frame.currentId === id ? fallback : frame.currentId,
    });
  }

  function updatePhoto(state, id, patch) {
    const frame = normalizeFrame(state);
    return normalizeFrame({
      ...frame,
      photos: frame.photos.map((photo) => (photo.id === id ? { ...photo, ...patch, id } : photo)),
    });
  }

  return {
    MAX_PHOTOS,
    CAPTION_LIMIT,
    dayKey,
    normalizeFrame,
    reconcile,
    visibleId,
    stepId,
    onPanelOpen,
    countdown,
    removePhoto,
    updatePhoto,
  };
});
