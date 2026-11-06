// The browser opens a private address only when the user named its host, whether the URL names the address or a
// name that resolves to it, as web_fetch does. Security audit 2026-11-06, finding 5.
import { expect, test } from 'bun:test';
import { browserAccess, pageDeniedResolved } from '../src/core/tools/browser.ts';

const access = browserAccess({ anyHost: false, allowedDomains: [] }, ['*']);
const dns: Record<string, string[]> = { 'meta.nip.io': ['169.254.169.254'], 'router.lan': ['10.0.0.1'], 'example.com': ['93.184.215.14'], 'mixed.example': ['93.184.215.14', '192.168.1.1'] };
const resolve = async (h: string) => (dns[h] ?? []).map((address) => ({ address, family: 4 }));

test('a name that resolves to a private or link-local address is refused', async () => {
  for (const url of ['http://meta.nip.io/latest/meta-data/', 'http://router.lan/', 'http://mixed.example/']) expect([url, await pageDeniedResolved(url, access, resolve)]).toEqual([url, expect.stringContaining('private address')]);
  expect(await pageDeniedResolved('http://nowhere.invalid/', access, resolve)).toContain('cannot resolve');
});

test('a public name, loopback, and a private host the user named still open', async () => {
  expect(await pageDeniedResolved('https://example.com/', access, resolve)).toBeUndefined();
  expect(await pageDeniedResolved('http://localhost:3000/', access, resolve)).toBeUndefined();
  expect(await pageDeniedResolved('about:blank', access, resolve)).toBeUndefined();
  const named = browserAccess({ anyHost: false, allowedDomains: ['router.lan'] }, ['*']);
  expect(await pageDeniedResolved('http://router.lan/', named, resolve)).toBeUndefined();
});
