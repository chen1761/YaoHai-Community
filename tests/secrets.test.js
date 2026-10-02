import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanRepository } from './repository-policy.js';

test('public source contains no credentials or commercial implementations', () => {
  assert.deepEqual(scanRepository(join(import.meta.dirname, '..')), []);
});

test('scanner detects common provider credentials', () => {
  const fixtures = [
    'sk-abcdefghijklmnopqrstuvwxyz123456', // policy-fixture
    'sk-ant-abcdefghijklmnopqrstuvwxyz123456', // policy-fixture
    'AIzaabcdefghijklmnopqrstuvwxyz123456789', // policy-fixture
  ];

  for (const [index, credential] of fixtures.entries()) {
    withFixture({ [`credential-${index}.txt`]: credential }, (fixtureRoot) => {
      assert.equal(scanRepository(fixtureRoot).length, 1, credential.slice(0, 7));
    });
  }
});

test('scanner examines jsx and extensionless scripts', () => {
  withFixture({
    'component.jsx': 'const token = "sk-abcdefghijklmnopqrstuvwxyz123456";', // policy-fixture
    run: '#!/bin/sh\nAPP_MASTER_PASSWORD=unsafe', // policy-fixture
  }, (fixtureRoot) => {
    assert.deepEqual(scanRepository(fixtureRoot).map(({ path }) => path).sort(), [
      'component.jsx',
      'run',
    ]);
  });
});

test('line exemptions do not hide unmarked content in the same file', () => {
  const cases = {
    'tests/secrets.test.js': [
      'const fixture = "sk-abcdefghijklmnopqrstuvwxyz123456"; // policy-fixture', // policy-fixture
      'const leaked = "sk-ant-abcdefghijklmnopqrstuvwxyz123456";', // policy-fixture
    ].join('\n'),
    'tests/repository-policy.js': [
      'const rule = /AIza[0-9A-Za-z_-]{20,}/; // policy-rule', // policy-fixture
      'const leaked = "AIzaabcdefghijklmnopqrstuvwxyz123456789";', // policy-fixture
    ].join('\n'),
  };

  for (const [path, content] of Object.entries(cases)) {
    withFixture({ [path]: content }, (fixtureRoot) => {
      const findings = scanRepository(fixtureRoot);
      assert.equal(findings.length, 1, path);
      assert.equal(findings[0].line, 2, path);
    });
  }
});

function withFixture(files, run) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'yaohai-policy-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(fixtureRoot, relativePath);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    }
    run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
