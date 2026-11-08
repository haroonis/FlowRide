import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePhone } from '../server/phone.ts';

test('UK formats normalise to international digits for wa.me', () => {
  for (const s of ['07700 900123', '07700-900-123', '+44 7700 900123', '0044 7700 900123', '+44 (0)7700 900123', '(07700) 900123'])
    assert.equal(normalisePhone(s), '447700900123', s);
});
test('international numbers are kept', () => {
  assert.equal(normalisePhone('+92 300 1234567'), '923001234567');
});
test('junk is rejected', () => {
  for (const s of ['', 'abc', '123', '0770090012', '+44 7700 9001234', null, 7700900123, '07700 900123 ext 4'])
    assert.equal(normalisePhone(s), null, String(s));
});
