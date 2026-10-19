import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  addExcludeKeys,
  addJavaExclusions,
  excludeKeyOf,
  findClosedAncestor,
  reconcile,
  removeExcludeKeys,
  removeJavaExclusions,
  toExcludePattern,
  toJavaPattern,
} from '../src/stashCore';

const JAVA_DEFAULT = ['**/node_modules/**', '**/.metadata/**'];

test('toExcludePattern: 일반/중첩/윈도우 경로', () => {
  assert.equal(toExcludePattern('khan-monitoring-error-dispatch'), 'khan-monitoring-error-dispatch');
  assert.equal(toExcludePattern('a/b/'), 'a/b');
  assert.equal(toExcludePattern('a\\b'), 'a/b');
});

test('toExcludePattern: glob 특수문자 escape', () => {
  assert.equal(toExcludePattern('a*b?c'), 'a[*]b[?]c');
  assert.equal(toExcludePattern('x{1,2}'), 'x[{]1,2[}]');
  assert.equal(toExcludePattern('wt[old]'), 'wt?old?');
});

test('toJavaPattern: 디렉토리 절대 경로, 특수문자 escape', () => {
  assert.equal(toJavaPattern('/data/src/wt'), '/data/src/wt');
  assert.equal(toJavaPattern('/data/src/wt[1]'), '/data/src/wt\\[1\\]');
  assert.equal(toJavaPattern('C:\\src\\wt'), 'C:/src/wt');
});

test('addExcludeKeys: 사용자 키 보존, 원본 불변', () => {
  const user = { '**/target': true };
  const next = addExcludeKeys(user, ['wt1', 'wt2']);
  assert.deepEqual(next, { '**/target': true, wt1: true, wt2: true });
  assert.deepEqual(user, { '**/target': true });
  assert.deepEqual(addExcludeKeys(undefined, ['wt1']), { wt1: true });
});

test('removeExcludeKeys: 우리 키만 제거, 비면 undefined', () => {
  assert.deepEqual(removeExcludeKeys({ '**/target': true, wt1: true }, ['wt1']), { '**/target': true });
  assert.equal(removeExcludeKeys({ wt1: true }, ['wt1']), undefined);
  assert.equal(removeExcludeKeys(undefined, ['wt1']), undefined);
  assert.deepEqual(removeExcludeKeys({ wt1: false }, ['wt1']), { wt1: false });
});

test('addJavaExclusions: 상속값 보존 + 중복 없음', () => {
  assert.deepEqual(addJavaExclusions(JAVA_DEFAULT, ['/w/a']), [...JAVA_DEFAULT, '/w/a']);
  assert.deepEqual(addJavaExclusions([...JAVA_DEFAULT, '/w/a'], ['/w/a']), [...JAVA_DEFAULT, '/w/a']);
});

test('removeJavaExclusions: 상속값과 같아지면 undefined', () => {
  assert.equal(removeJavaExclusions([...JAVA_DEFAULT, '/w/a'], ['/w/a'], JAVA_DEFAULT), undefined);
  assert.deepEqual(
    removeJavaExclusions([...JAVA_DEFAULT, '/w/a', '/w/b'], ['/w/a'], JAVA_DEFAULT),
    [...JAVA_DEFAULT, '/w/b'],
  );
  assert.equal(removeJavaExclusions(undefined, ['/w/a'], JAVA_DEFAULT), undefined);
});

test('removeJavaExclusions: 사용자가 워크스페이스에 넣은 항목은 유지', () => {
  const custom = ['**/node_modules/**', '**/legacy/**', '/w/a'];
  assert.deepEqual(removeJavaExclusions(custom, ['/w/a'], JAVA_DEFAULT), ['**/node_modules/**', '**/legacy/**']);
});

test('reconcile: files.exclude 에서 빠진 항목은 dropped', () => {
  assert.deepEqual(reconcile(['wt1', 'wt2'], [{ wt1: true, wt2: true }]), { kept: ['wt1', 'wt2'], dropped: [] });
  assert.deepEqual(reconcile(['wt1', 'wt2'], [{ wt1: true }]), { kept: ['wt1'], dropped: ['wt2'] });
  assert.deepEqual(reconcile(['wt1'], [{ wt1: false }]), { kept: [], dropped: ['wt1'] });
  assert.deepEqual(reconcile(['wt1'], [undefined]), { kept: [], dropped: ['wt1'] });
  assert.deepEqual(reconcile(['wt1'], [undefined, { wt1: true }]), { kept: ['wt1'], dropped: [] });
});

test('findClosedAncestor: 자신과 하위만 찾고 이름이 겹치는 형제는 제외', () => {
  const closed = ['wt1', 'sub/wt2'];
  assert.equal(findClosedAncestor(closed, 'wt1'), 'wt1');
  assert.equal(findClosedAncestor(closed, 'wt1/src/A.java'), 'wt1');
  assert.equal(findClosedAncestor(closed, 'sub\\wt2\\pom.xml'), 'sub/wt2');
  assert.equal(findClosedAncestor(closed, 'wt10'), undefined);
  assert.equal(findClosedAncestor(closed, 'sub'), undefined);
});

test('excludeKeyOf: dim 은 search.exclude, hide 는 files.exclude', () => {
  assert.equal(excludeKeyOf('dim'), 'search.exclude');
  assert.equal(excludeKeyOf('hide'), 'files.exclude');
});
