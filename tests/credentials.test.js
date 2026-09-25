const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const domain = require('../renderer/domain');
const { deriveEnvName, credentialEnvName, normalizeCredentialInput } = require('../main-services');

test('the renderer and the main process derive the same variable names', () => {
  const names = ['OpenAI', 'Google Gemini', 'GITHUB_TOKEN', 'Anthropic API', 'API', 'AWS', '飞书', '3D Studio', 'Stripe secret key', '', 'x'.repeat(80)];
  for (const name of names) assert.equal(domain.deriveEnvName(name), deriveEnvName(name), name);
  assert.equal(deriveEnvName('OpenAI'), 'OPENAI_API_KEY');
  assert.equal(deriveEnvName('Anthropic API'), 'ANTHROPIC_API_KEY');
  assert.equal(deriveEnvName('GITHUB_TOKEN'), 'GITHUB_TOKEN');
  assert.equal(deriveEnvName('飞书'), 'API_KEY');
});

test('API keys keep their variable name in the account field, so older versions still read them', () => {
  const key = normalizeCredentialInput({ kind: 'apikey', service: 'OpenAI', password: 'sk-test', account: 'openai_org_key', url: ' https://platform.openai.com ', note: '团队\n共用' }, 'k1', 5);
  assert.deepEqual(key, { id: 'k1', service: 'OpenAI', account: 'OPENAI_ORG_KEY', password: 'sk-test', createdAt: 5, kind: 'apikey', url: 'https://platform.openai.com', note: '团队 共用' });
  assert.equal(normalizeCredentialInput({ kind: 'apikey', service: 'DeepSeek', password: 'sk' }, 'k2', 1).account, 'DEEPSEEK_API_KEY', 'an empty variable name is filled in');
  assert.equal(credentialEnvName(key), 'OPENAI_ORG_KEY');
  // Old entries keep exactly their v0.1 shape.
  assert.deepEqual(normalizeCredentialInput({ service: 'GitHub', account: 'me', password: 'pw' }, 'p1', 2), { id: 'p1', service: 'GitHub', account: 'me', password: 'pw', createdAt: 2 });
  assert.equal(normalizeCredentialInput({ service: 'GitHub', password: 'pw' }), null, 'passwords still need an account');
  assert.equal(normalizeCredentialInput({ kind: 'apikey', service: 'OpenAI', password: '' }), null);
  assert.equal(normalizeCredentialInput({ service: 'A', account: 'b', password: 'c', lastUsedAt: 99 }, 'x', 1).lastUsedAt, 99);
});

test('recently used entries come first; search covers name, account and URL but never the password', () => {
  const rows = [
    { id: 'old', service: 'Figma', account: 'me', createdAt: 1 },
    { id: 'used', service: 'GitHub', account: 'me', createdAt: 2, lastUsedAt: 50 },
    { id: 'new', service: 'Notion', account: 'me', createdAt: 3, url: 'https://notion.so', password: 'secret-word' },
  ];
  assert.deepEqual(domain.sortCredentials(rows).map((row) => row.id), ['used', 'new', 'old']);
  assert.deepEqual(domain.filterCredentials(rows, 'notion.so').map((row) => row.id), ['new']);
  assert.deepEqual(domain.filterCredentials(rows, 'secret-word'), []);
  assert.deepEqual(domain.credentialRowAction({ copyField: 'env' }), { type: 'copy', field: 'env' });
  assert.deepEqual(domain.credentialRowAction({ copyField: 'url' }), { type: 'copy', field: 'url' });
});

test('generated passwords have the requested length and every character class', () => {
  const randomInt = (max) => crypto.randomInt(max);
  for (let round = 0; round < 50; round += 1) {
    const password = domain.generatePassword({}, randomInt);
    assert.equal(password.length, 20);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[2-9]/);
    assert.match(password, /[!@#$%^&*\-_=+?]/);
    assert.doesNotMatch(password, /[0O1lI]/, 'look-alike characters are left out');
  }
  const plain = domain.generatePassword({ length: 32, symbols: false }, randomInt);
  assert.equal(plain.length, 32);
  assert.match(plain, /^[A-Za-z2-9]+$/);
  assert.equal(domain.generatePassword({ length: 3 }, randomInt).length, 8, 'at least 8 characters');
});
