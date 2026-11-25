'use strict';
/*
 * Version-independent test runner for the repository root.
 *
 *   node tools/test.js
 *
 * Node's `--test` accepts a directory only on some releases (Node 22 on the
 * GitHub Windows runner treats `tests/` as a module and fails). This runner
 * enumerates the test files itself and hands the explicit list to `node --test`,
 * so the local command and CI run exactly the same set.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testsDir, name));

if (files.length === 0) {
  console.error('Test dosyası bulunamadı:', testsDir);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

if (result.error) {
  console.error('Test koşucusu başlatılamadı:', result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
