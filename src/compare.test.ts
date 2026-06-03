import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, outputsMatch } from './compare.js';

test('normalize strips trailing whitespace and trailing blank lines', () => {
  assert.equal(normalize('a \nb\t\n\n\n'), 'a\nb');
  assert.equal(normalize('hello\r\nworld\r\n'), 'hello\nworld');
});

test('exact and whitespace-only differences match', () => {
  assert.ok(outputsMatch('42\n', '42'));
  assert.ok(outputsMatch('1 2 3', '1 2 3\n'));
  assert.ok(outputsMatch('1   2\t3', '1 2 3')); // intra-line spacing ignored
});

test('distinct integers do NOT match (tolerance is tiny)', () => {
  assert.ok(!outputsMatch('42', '43'));
  assert.ok(!outputsMatch('5 6 7', '5 6 8'));
});

test('close floats match within tolerance', () => {
  assert.ok(outputsMatch('3.1415926535', '3.1415926540'));
  assert.ok(outputsMatch('0.1', '0.1000000001'));
  assert.ok(!outputsMatch('3.14', '3.15'));
});

test('line count must match (formatting preserved)', () => {
  assert.ok(!outputsMatch('1 2', '1\n2'));
  assert.ok(outputsMatch('1 2\n3 4', '1 2\n3 4'));
});

test('token count per line must match', () => {
  assert.ok(!outputsMatch('1 2 3', '1 2'));
});

test('non-numeric tokens compared exactly', () => {
  assert.ok(outputsMatch('YES', 'YES'));
  assert.ok(!outputsMatch('YES', 'NO'));
});
