'use strict';

const https = require('node:https');

const SOURCE = 'https://aihot.news/api/v1/codex-resets';
const MAX_BYTES = 1024 * 1024;
const CACHE_MS = 15 * 60 * 1000;
const clip = (value, max = 280) => typeof value === 'string' ? value.slice(0, max) : '';
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
const beijingDate = (value) => /^\d{4}-\d{2}-\d{2}T/.test(value || '') ? value.slice(0, 10) : '';

function normalizeResetNews(raw) {
  if (!raw || !Array.isArray(raw.events) || raw.timezone !== 'Asia/Shanghai') throw new Error('invalid_response');
  return {
    ok: true,
    source: 'AIHOT',
    timezone: 'Asia/Shanghai',
    today: dateOnly(raw.today),
    checkedAt: clip(raw.checkedAt, 40),
    events: raw.events.slice(0, 150).map((event) => {
      const schedule = event.schedule && typeof event.schedule === 'object' ? event.schedule : {};
      const day = dateOnly(event.occurredOn) || beijingDate(schedule.from) || beijingDate(event.confirmedAt) || beijingDate(event.createdAt);
      if (!day) return null;
      return {
        id: clip(event.id, 120),
        day,
        kind: event.type === 'reset_credit' ? 'credit' : 'reset',
        status: event.status === 'confirmed' ? 'confirmed' : 'announced',
        title: clip(event.title, 120),
        label: clip(event.displayLabel || event.label, 80),
        scope: clip(event.scope, 120),
        schedule: clip(schedule.label, 160),
        posts: (Array.isArray(event.posts) ? event.posts : []).slice(0, 3).map((post) => ({
          text: clip(post.text, 420),
          publishedAt: clip(post.publishedAt, 40),
          url: typeof post.url === 'string' && /^https:\/\/(x\.com|twitter\.com)\/[^\s]*$/.test(post.url) ? post.url : '',
        })),
      };
    }).filter(Boolean),
  };
}

function fetchResetNews() {
  return new Promise((resolve, reject) => {
    const request = https.get(SOURCE, {
      headers: { Accept: 'application/json', 'User-Agent': 'SoloDock/0.1 (public reset calendar)' },
      timeout: 10000,
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('http_error')); return; }
      let bytes = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { request.destroy(new Error('too_large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(normalizeResetNews(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch { reject(new Error('invalid_response')); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

function createResetNewsService({ fetcher = fetchResetNews, now = () => Date.now() } = {}) {
  let cache = null;
  let fetchedAt = 0;
  let inFlight = null;
  return {
    async read({ force = false } = {}) {
      if (!force && cache && now() - fetchedAt < CACHE_MS) return cache;
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(fetcher).then((result) => {
        cache = result;
        fetchedAt = now();
        return result;
      }).catch((error) => cache ? { ...cache, stale: true } : { ok: false, error: error.message || 'read_failed' })
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

module.exports = { normalizeResetNews, createResetNewsService };
