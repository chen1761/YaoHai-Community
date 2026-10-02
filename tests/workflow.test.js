import assert from 'node:assert/strict';
import test from 'node:test';
import { validBody } from '../server/routes/_business.js';

test('workflow validation rejects unknown and oversized fields', () => {
  assert.throws(() => validBody({ unknown: true }, ['name']), /unknown/i);
  assert.throws(() => validBody({ name: 'x'.repeat(2001) }, ['name']), /too long/i);
});
