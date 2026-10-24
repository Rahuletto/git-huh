import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountCachePrefixes, composeKey, escapeName, KEY_SEPARATOR } from './cacheKey';

describe('escapeName', () => {
  it('keeps plain names as they are', () => {
    assert.equal(escapeName('jaikhuranna'), 'jaikhuranna');
    assert.equal(escapeName('owner-repo.main'), 'owner-repo.main');
  });

  it('escapes a literal underscore, so it cannot be confused with an escape', () => {
    assert.notEqual(escapeName('_47_'), escapeName('/'));
    assert.notEqual(escapeName('a_b'), escapeName('a/b'));
  });

  it('is injective over adversarial names', () => {
    const names = ['a/b', 'a_b', '_47_', 'a_2f_b', 'a2fb', 'x.y', 'x-y', 'x\u0001y', ''];
    const seen = new Map<string, string>();
    for (const name of names) {
      const escaped = escapeName(name);
      assert.equal(seen.get(escaped), undefined, `${name} collided with ${seen.get(escaped)}`);
      seen.set(escaped, name);
    }
  });
});

describe('composeKey', () => {
  it('makes dash-boundary tuples distinct', () => {
    // The finding: branch "a-b" + path "c" must not equal branch "a" + path "b-c".
    assert.notEqual(composeKey('me', 'file', 'a-b', 'c'), composeKey('me', 'file', 'a', 'b-c'));
  });

  it('keeps the account first and lower case', () => {
    assert.equal(composeKey('Me', 'file').startsWith(`me${KEY_SEPARATOR}`), true);
  });

  it('gives an account-less resource a marker no login can make', () => {
    assert.equal(composeKey(null, 'home-settings').startsWith('~'), true);
  });

  it('treats null and undefined parts the same', () => {
    assert.equal(composeKey('me', 'x', null), composeKey('me', 'x', undefined));
  });
});

describe('accountCachePrefixes', () => {
  it('covers both the current key shape and the older login-dash files', () => {
    const [current, legacy] = accountCachePrefixes('Me');
    assert.equal(current, `me${KEY_SEPARATOR}`.replace(KEY_SEPARATOR, `_1_`));
    assert.equal(legacy, 'me-');
    // The current shape as it lands on disk: the separator escaped.
    assert.equal(escapeName(`me${KEY_SEPARATOR}`), current);
  });
});
