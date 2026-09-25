// Photo frame storage in the data folder: "<id>.jpg" (long edge ≤ 1600) plus "<id>.thumb.jpg".
// Captions, order and the switching mode live in the renderer's LocalStorage (notch-frame-v1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isFramePhotoId, framePhotoSize } = require('./main-services');

const FRAME_MAX_PHOTOS = 50;
const FRAME_MAX_EDGE = 1600;
const FRAME_THUMB_EDGE = 320;
const MAX_SOURCE_PIXELS = 60_000_000;

function createFrameStore({ dir, legacyFile, nativeImage }) {
  const photoFile = (id, thumb = false) => path.join(dir(), `${id}${thumb ? '.thumb' : ''}.jpg`);

  function write(image, id) {
    const size = image.getSize();
    const full = framePhotoSize(size, FRAME_MAX_EDGE);
    const thumb = framePhotoSize(size, FRAME_THUMB_EDGE);
    if (!full || !thumb) throw new Error('invalid_image');
    fs.mkdirSync(dir(), { recursive: true });
    const fullImage = full.width === size.width ? image : image.resize({ ...full, quality: 'best' });
    fs.writeFileSync(photoFile(id), fullImage.toJPEG(88), { mode: 0o600 });
    fs.writeFileSync(photoFile(id, true), image.resize({ ...thumb, quality: 'good' }).toJPEG(82), { mode: 0o600 });
  }

  // Once per data folder: bring the v0.1 single cover into the album. The old file stays for rollback.
  function migrateLegacy() {
    const marker = path.join(dir(), '.migrated');
    try {
      if (fs.existsSync(marker)) return;
      fs.mkdirSync(dir(), { recursive: true });
      const legacy = legacyFile();
      if (legacy && fs.existsSync(legacy)) {
        const image = nativeImage.createFromPath(legacy);
        if (!image.isEmpty()) write(image, 'photo-legacy-cover');
      }
      fs.writeFileSync(marker, '');
    } catch (error) {}
  }

  function list() {
    migrateLegacy();
    try {
      return fs.readdirSync(dir())
        .filter((name) => name.endsWith('.jpg') && !name.endsWith('.thumb.jpg'))
        .map((name) => name.slice(0, -4))
        .filter(isFramePhotoId)
        .map((id) => ({ id, addedAt: Math.round(fs.statSync(photoFile(id)).mtimeMs) }))
        .sort((left, right) => left.addedAt - right.addedAt);
    } catch (error) {
      return [];
    }
  }

  function read(id, thumb = false) {
    if (!isFramePhotoId(id)) return null;
    try {
      return `data:image/jpeg;base64,${fs.readFileSync(photoFile(id, thumb === true)).toString('base64')}`;
    } catch (error) {
      return null;
    }
  }

  function importFiles(files) {
    const existing = list().length;
    const added = [];
    let skipped = 0;
    for (const file of Array.isArray(files) ? files : []) {
      if (existing + added.length >= FRAME_MAX_PHOTOS) {
        skipped += 1;
        continue;
      }
      try {
        const image = nativeImage.createFromPath(String(file));
        if (image.isEmpty()) throw new Error('invalid_image');
        const size = image.getSize();
        if (!size.width || !size.height || size.width * size.height > MAX_SOURCE_PIXELS) throw new Error('image_too_large');
        const id = `photo-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        write(image, id);
        added.push({ id, addedAt: Date.now() });
      } catch (error) {
        skipped += 1;
      }
    }
    return { added, skipped };
  }

  function remove(id) {
    if (!isFramePhotoId(id)) return false;
    for (const file of [photoFile(id), photoFile(id, true)]) {
      try { fs.unlinkSync(file); } catch (error) {}
    }
    return true;
  }

  return { list, read, importFiles, remove, isFull: () => list().length >= FRAME_MAX_PHOTOS };
}

module.exports = { createFrameStore, FRAME_MAX_PHOTOS, FRAME_MAX_EDGE, FRAME_THUMB_EDGE };
