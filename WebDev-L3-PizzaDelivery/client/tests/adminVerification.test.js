import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationProfile, verificationNotice, verificationLinkNotice } from '../src/components/admin/verification.js';

test('admin email state comes from a valid backend admin profile', () => {
  for (const isVerified of [false, true]) {
    assert.equal(verificationProfile({ admin: { email: 'admin@example.test', role: 'admin', isVerified } }).isVerified, isVerified);
  }
  for (const data of [{}, { admin: { role: 'user', email: 'user@example.test', isVerified: true } }, { admin: { role: 'admin', email: 'admin@example.test' } }, { admin: { role: 'admin', email: '', isVerified: true } }]) {
    assert.throws(() => verificationProfile(data), /could not be read/);
  }
});

test('email accepted for delivery does not mean the administrator is verified', () => {
  assert.deepEqual(verificationNotice({ message: 'Accepted for delivery', isVerified: false }), { text: 'Accepted for delivery', isVerified: false });
  assert.equal(verificationNotice({ message: 'Already verified', isVerified: true }).isVerified, true);
  for (const data of [{}, { message: 'Sent' }, { message: '', isVerified: true }, { message: 'Sent', isVerified: 'true' }]) {
    assert.throws(() => verificationNotice(data), /could not be read/);
  }
});

test('verification redirects display success or expired-link guidance without authenticating', () => {
  assert.equal(verificationLinkNotice('success').success, true);
  assert.equal(verificationLinkNotice('invalid').success, false);
  assert.match(verificationLinkNotice('invalid').text, /request a new link/);
  assert.equal(verificationLinkNotice('arbitrary'), null);
  assert.equal(verificationLinkNotice(null), null);
});
