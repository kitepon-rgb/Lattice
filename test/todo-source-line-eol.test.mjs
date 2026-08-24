import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { matchesTodoSourceLineDigest } from '../src/todo-source-line-eol.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('source line digestはcheckout由来のLFとCRLFだけを同一視する', () => {
  const lf = Buffer.from('- [ ] T1', 'utf8');
  const crlf = Buffer.from('- [ ] T1\r', 'utf8');
  assert.equal(matchesTodoSourceLineDigest(crlf, digest(lf)), true);
  assert.equal(matchesTodoSourceLineDigest(lf, digest(crlf)), true);
  assert.equal(matchesTodoSourceLineDigest(lf, digest(lf)), true);
  assert.equal(matchesTodoSourceLineDigest(crlf, digest(crlf)), true);
  assert.equal(matchesTodoSourceLineDigest(Buffer.from('- [ ] T2\r'), digest(lf)), false);
});
