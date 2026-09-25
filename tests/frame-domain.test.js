const test = require('node:test');
const assert = require('node:assert/strict');
const frame = require('../renderer/frame-domain');
const { isFramePhotoId, framePhotoSize } = require('../main-services');

const now = new Date(2026, 8, 24, 14, 0).getTime();
const photos = (...ids) => ids.map((id, index) => ({ id: `photo-${id}`, addedAt: index + 1 }));

test('photo files are resized so the long edge fits, never upscaled', () => {
  assert.deepEqual(framePhotoSize({ width: 4032, height: 3024 }, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(framePhotoSize({ width: 3000, height: 4000 }, 320), { width: 240, height: 320 });
  assert.deepEqual(framePhotoSize({ width: 800, height: 600 }, 1600), { width: 800, height: 600 });
  assert.equal(framePhotoSize({ width: 0, height: 10 }, 1600), null);
  assert.equal(isFramePhotoId('photo-legacy-cover'), true);
  assert.equal(isFramePhotoId('../mirror-cover'), false);
  assert.equal(isFramePhotoId('photo-../../x'), false);
});

test('reconcile keeps saved order and captions, appends new files and drops missing ones', () => {
  const saved = { photos: [{ id: 'photo-b', caption: '京都' }, { id: 'photo-a', caption: '全家福' }, { id: 'photo-gone' }], currentId: 'photo-gone', pinnedId: 'photo-gone' };
  const result = frame.reconcile(saved, photos('a', 'b', 'c'));
  assert.deepEqual(result.photos.map((photo) => [photo.id, photo.caption]), [['photo-b', '京都'], ['photo-a', '全家福'], ['photo-c', '']]);
  assert.equal(result.pinnedId, '');
  assert.equal(result.currentId, 'photo-b');
});

test('the album moves on each panel open, once a day, or stays on a pinned photo', () => {
  const base = frame.normalizeFrame({ photos: photos('a', 'b', 'c'), currentId: 'photo-c' });
  assert.equal(frame.onPanelOpen(base, now).currentId, 'photo-a', 'wraps around');
  const daily = frame.onPanelOpen({ ...base, rotate: 'daily' }, now);
  assert.equal(daily.currentId, 'photo-a');
  assert.equal(frame.onPanelOpen(daily, now + 3600000).currentId, 'photo-a', 'same day keeps the photo');
  assert.equal(frame.onPanelOpen(daily, now + 86400000).currentId, 'photo-b');
  const pinned = { ...base, pinnedId: 'photo-b' };
  assert.equal(frame.visibleId(frame.onPanelOpen(pinned, now)), 'photo-b');
  assert.equal(frame.stepId(base, -1), 'photo-b');
  assert.equal(frame.onPanelOpen({ photos: photos('a') }, now).currentId, 'photo-a');
});

test('countdowns count whole days from today', () => {
  assert.deepEqual(frame.countdown('2026-10-06', now), { days: 12, text: '还有 12 天' });
  assert.deepEqual(frame.countdown('2026-09-24', now), { days: 0, text: '就是今天' });
  assert.deepEqual(frame.countdown('2026-09-21', now), { days: -3, text: '3 天前' });
  assert.equal(frame.countdown('someday', now), null);
});

test('removing and editing photos keep the state valid', () => {
  const base = frame.normalizeFrame({ photos: photos('a', 'b', 'c'), currentId: 'photo-b', pinnedId: 'photo-b' });
  const removed = frame.removePhoto(base, 'photo-b');
  assert.deepEqual(removed.photos.map((photo) => photo.id), ['photo-a', 'photo-c']);
  assert.equal(removed.currentId, 'photo-c');
  assert.equal(removed.pinnedId, '');
  const edited = frame.updatePhoto(base, 'photo-a', { caption: '  想去的   海边，一定要去一次看看日出和日落  ', countdownTo: '2026-12-31' });
  assert.equal(edited.photos[0].caption, '想去的 海边，一定要去一次看看日出和日落');
  assert.equal(edited.photos[0].countdownTo, '2026-12-31');
  assert.equal(frame.updatePhoto(base, 'photo-a', { countdownTo: 'bad' }).photos[0].countdownTo, '');
  assert.equal(frame.normalizeFrame({ photos: Array.from({ length: 60 }, (_, i) => ({ id: `photo-n${i}` })) }).photos.length, 50);
});
