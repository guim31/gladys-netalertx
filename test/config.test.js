import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeUrl } from '../src/config.js';

test('an address without port gets the API port 20212, https keeps its own', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10:20212');
  assert.equal(normalizeUrl(' netalertx.lan/ '), 'http://netalertx.lan:20212');
  assert.equal(normalizeUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(normalizeUrl('http://192.0.2.10:80'), 'http://192.0.2.10');
  assert.equal(normalizeUrl('https://nax.example.org/api/'), 'https://nax.example.org/api');
  assert.equal(normalizeUrl('http://[2001:db8::1]'), 'http://[2001:db8::1]:20212');
  assert.equal(normalizeUrl('http://[2001:db8::1]:9000'), 'http://[2001:db8::1]:9000');
});

test('unusable addresses are refused, credentials included', () => {
  for (const value of ['', '   ', undefined, 42, 'ftp://192.0.2.10', 'http://user:pw@192.0.2.10']) {
    assert.equal(normalizeUrl(value), null, String(value));
  }
});

test('the defaults are the ones of the manifest, invalid values fall back to them', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    token: '',
    pollInterval: Number(DEFAULT_CONFIG.poll_interval),
    language: 'fr',
  });
  assert.deepEqual(
    normalizeConfig({ url: '192.0.2.10', api_token: ' t_x ', poll_interval: '17', language: 'it' }),
    { url: 'http://192.0.2.10:20212', token: 't_x', pollInterval: 60, language: 'fr' },
  );
  assert.equal(normalizeConfig({ poll_interval: '300' }).pollInterval, 300);
  assert.equal(normalizeConfig(null).language, 'fr');
});
