import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectJavaNames } from './runners.js';

test('public class Main -> Main / Main', () => {
  const r = detectJavaNames('public class Main { public static void main(String[] a){} }');
  assert.deepEqual(r, { fileBase: 'Main', runClass: 'Main' });
});

test('renamed public class -> file + run use that name', () => {
  const r = detectJavaNames('public class Foo { public static void main(String[] a){} }');
  assert.deepEqual(r, { fileBase: 'Foo', runClass: 'Foo' });
});

test('non-public class with main -> file + run use that class', () => {
  const r = detectJavaNames('class Solution { public static void main(String[] a){} }');
  assert.deepEqual(r, { fileBase: 'Solution', runClass: 'Solution' });
});

test('public class + separate main-bearing class', () => {
  const code = `
    public class Helper {}
    class Runner { public static void main(String[] a){} }
  `;
  const r = detectJavaNames(code);
  // File must match the public type; run the type that declares main.
  assert.equal(r.fileBase, 'Helper');
  assert.equal(r.runClass, 'Runner');
});

test('keywords inside comments/strings are ignored', () => {
  const code = `
    // public class Fake {}
    /* class AlsoFake {} */
    public class Real { public static void main(String[] a){ String s = "class Nope"; } }
  `;
  const r = detectJavaNames(code);
  assert.deepEqual(r, { fileBase: 'Real', runClass: 'Real' });
});

test('falls back to Main when nothing detected', () => {
  const r = detectJavaNames('int x = 5;');
  assert.deepEqual(r, { fileBase: 'Main', runClass: 'Main' });
});

test('only accepts plain identifiers (shell-safe)', () => {
  const r = detectJavaNames('public class A1_b { public static void main(String[] a){} }');
  assert.equal(r.fileBase, 'A1_b');
  assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.fileBase));
  assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.runClass));
});
