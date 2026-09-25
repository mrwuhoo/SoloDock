// Main-process photo frame storage: resizing, thumbnails, the v0.1 cover migration and the limit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeImage } = require('electron');
const { createFrameStore, FRAME_MAX_PHOTOS } = require('../frame-store');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);

function solidImage(width, height) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let index = 0; index < bitmap.length; index += 4) {
    bitmap[index] = 200; bitmap[index + 1] = 120; bitmap[index + 2] = 60; bitmap[index + 3] = 255;
  }
  return nativeImage.createFromBitmap(bitmap, { width, height });
}

app.whenReady().then(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solodock-frame-'));
  const dir = path.join(root, 'photo-frame');
  const legacy = path.join(root, 'mirror-cover.jpg');
  fs.writeFileSync(legacy, solidImage(900, 600).toJPEG(90));
  const store = createFrameStore({ dir: () => dir, legacyFile: () => legacy, nativeImage });

  // The v0.1 cover becomes the first album photo once; the original file stays.
  const first = store.list();
  assert.deepEqual(first.map((photo) => photo.id), ['photo-legacy-cover']);
  assert.ok(fs.existsSync(legacy), 'the legacy cover is kept for rollback');
  store.remove('photo-legacy-cover');
  assert.deepEqual(store.list(), [], 'the migration does not run again after the photo is removed');

  // Large photos are stored with a 1600px long edge and a 320px thumbnail.
  const big = path.join(root, 'big.png');
  fs.writeFileSync(big, solidImage(4000, 3000).toPNG());
  const broken = path.join(root, 'broken.jpg');
  fs.writeFileSync(broken, 'not an image');
  const imported = store.importFiles([big, broken]);
  assert.equal(imported.added.length, 1);
  assert.equal(imported.skipped, 1);
  const id = imported.added[0].id;
  assert.deepEqual(nativeImage.createFromPath(path.join(dir, `${id}.jpg`)).getSize(), { width: 1600, height: 1200 });
  assert.deepEqual(nativeImage.createFromPath(path.join(dir, `${id}.thumb.jpg`)).getSize(), { width: 320, height: 240 });
  assert.match(store.read(id), /^data:image\/jpeg;base64,/);
  assert.match(store.read(id, true), /^data:image\/jpeg;base64,/);
  assert.equal(store.read('../mirror-cover'), null, 'ids cannot escape the folder');
  assert.equal(store.remove('../mirror-cover'), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, `${id}.jpg`)).mode & 0o777, 0o600);

  // At most 50 photos.
  const small = path.join(root, 'small.png');
  fs.writeFileSync(small, solidImage(40, 30).toPNG());
  const many = store.importFiles(Array.from({ length: FRAME_MAX_PHOTOS + 2 }, () => small));
  assert.equal(many.added.length, FRAME_MAX_PHOTOS - 1);
  assert.equal(many.skipped, 3);
  assert.equal(store.list().length, FRAME_MAX_PHOTOS);
  assert.equal(store.isFull(), true);
  assert.deepEqual(nativeImage.createFromPath(path.join(dir, `${many.added[0].id}.jpg`)).getSize(), { width: 40, height: 30 }, 'small photos are not upscaled');

  store.remove(id);
  assert.equal(fs.existsSync(path.join(dir, `${id}.jpg`)) || fs.existsSync(path.join(dir, `${id}.thumb.jpg`)), false);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Frame store checks passed');
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
