import { strict as assert } from 'assert';
import { test } from 'node:test';
import { ExcludeKey, ExcludeMap } from '../src/stashCore';
import { CloseOptions, SettingsPort, StashFolder, StashService, StorePort } from '../src/stashService';

const JAVA_DEFAULT = ['**/node_modules/**'];
const FOLDER: StashFolder = { key: 'file:///w', fsPath: '/w' };
const HIDE: CloseOptions = { style: 'hide', excludeFromJava: false };
const HIDE_JAVA: CloseOptions = { style: 'hide', excludeFromJava: true };
const DIM: CloseOptions = { style: 'dim', excludeFromJava: false };

class FakeSettings implements SettingsPort {
  filesExclude: ExcludeMap | undefined;
  searchExclude: ExcludeMap | undefined;
  javaWorkspace: string[] | undefined;
  writes: string[] = [];
  failJava = false;
  javaRegistered = true;
  onWrite: () => Promise<void> = async () => {};

  getExclude(_folder: StashFolder, key: ExcludeKey): ExcludeMap | undefined {
    return key === 'files.exclude' ? this.filesExclude : this.searchExclude;
  }
  async setExclude(_folder: StashFolder, key: ExcludeKey, value: ExcludeMap | undefined): Promise<void> {
    if (key === 'files.exclude') {
      this.writes.push('files');
      this.filesExclude = value;
    } else {
      this.writes.push('search');
      this.searchExclude = value;
    }
    await this.onWrite();
  }
  getJavaExclusions() {
    return this.javaRegistered ? { workspace: this.javaWorkspace, inherited: JAVA_DEFAULT } : undefined;
  }
  async setJavaExclusions(value: string[] | undefined): Promise<void> {
    if (this.failJava) {
      throw new Error('EACCES');
    }
    this.writes.push('java');
    this.javaWorkspace = value;
  }
}

class FakeStore implements StorePort {
  data = new Map<string, string[]>();
  get(key: string): string[] {
    return this.data.get(key) ?? [];
  }
  async set(key: string, relPaths: string[]): Promise<void> {
    this.data.set(key, relPaths);
  }
}

function setup() {
  const settings = new FakeSettings();
  const store = new FakeStore();
  return { settings, store, service: new StashService(settings, store) };
}

test('close: 여러 디렉토리를 닫아도 설정 키마다 한 번만 쓴다', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };

  const result = await service.close(FOLDER, ['wt1', 'wt2'], HIDE_JAVA);

  assert.deepEqual(result, { changed: ['wt1', 'wt2'], skipped: [], javaChanged: true });
  assert.deepEqual(settings.writes, ['files', 'java']);
  assert.deepEqual(settings.filesExclude, { '**/target': true, wt1: true, wt2: true });
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt1', '/w/wt2']);
  assert.deepEqual(store.get(FOLDER.key), ['wt1', 'wt2']);
});

test('close: Java 제외를 끄면 java 설정을 쓰지 않는다', async () => {
  const { settings, service } = setup();
  const result = await service.close(FOLDER, ['wt1'], HIDE);
  assert.equal(result.javaChanged, false);
  assert.deepEqual(settings.writes, ['files']);
  assert.equal(settings.javaWorkspace, undefined);
});

test('close: 이미 닫힌 경로와 사용자가 직접 넣은 패턴은 건너뛴다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE);
  settings.filesExclude = { ...settings.filesExclude, mine: true };
  settings.writes = [];

  const result = await service.close(FOLDER, ['wt1', 'mine', 'wt1'], HIDE);

  assert.deepEqual(result, { changed: [], skipped: ['wt1', 'mine'], javaChanged: false });
  assert.deepEqual(settings.writes, []);
});

test('close: java 쓰기 실패 시 files.exclude 를 되돌리고 목록도 바꾸지 않는다', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };
  settings.failJava = true;

  await assert.rejects(service.close(FOLDER, ['wt1'], HIDE_JAVA), /EACCES/);

  assert.deepEqual(settings.filesExclude, { '**/target': true });
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('reopen: 우리 항목만 제거하고, 모두 열면 설정 키를 지운다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], HIDE_JAVA);

  let result = await service.reopen(FOLDER, ['wt1']);
  assert.deepEqual(result, { changed: ['wt1'], skipped: [], javaChanged: true });
  assert.deepEqual(settings.filesExclude, { wt2: true });
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt2']);

  result = await service.reopen(FOLDER, ['wt2', 'unknown']);
  assert.deepEqual(result.skipped, ['unknown']);
  assert.equal(settings.filesExclude, undefined);
  assert.equal(settings.javaWorkspace, undefined);
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('reopen: Java 제외를 꺼도 이전에 넣은 Java 패턴은 제거한다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE_JAVA);
  const result = await service.reopen(FOLDER, ['wt1']);
  assert.equal(result.javaChanged, true);
  assert.equal(settings.javaWorkspace, undefined);
});

test('reconcile: settings.json 에서 직접 지운 항목은 목록과 java 에서도 제거', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], HIDE_JAVA);
  settings.filesExclude = { wt1: true };

  const result = await service.reconcile(FOLDER);

  assert.deepEqual(result.changed, ['wt2']);
  assert.equal(result.javaChanged, true);
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt1']);
});

test('reconcile: 상태가 같으면 아무것도 쓰지 않는다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE);
  settings.writes = [];
  assert.deepEqual((await service.reconcile(FOLDER)).changed, []);
  assert.deepEqual(settings.writes, []);
});

test('reconcile: 쓰는 도중 발생한 설정 변경 이벤트는 쓰기가 끝난 뒤 실행되어 아무것도 바꾸지 않는다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], HIDE);
  const during: Promise<{ changed: string[] }>[] = [];
  settings.onWrite = async () => {
    during.push(service.reconcile(FOLDER));
  };

  await service.reopen(FOLDER, ['wt1']);

  assert.deepEqual((await Promise.all(during)).map((r) => r.changed), [[]]);
  assert.deepEqual(store.get(FOLDER.key), ['wt2']);
});

test('동시에 실행한 닫기/열기는 순서대로 처리되어 서로 덮어쓰지 않는다', async () => {
  const { settings, store, service } = setup();
  settings.onWrite = () => new Promise((resolve) => setTimeout(resolve, 5));

  await Promise.all([service.close(FOLDER, ['wt1'], HIDE_JAVA), service.close(FOLDER, ['wt2'], HIDE_JAVA)]);
  assert.deepEqual(settings.filesExclude, { wt1: true, wt2: true });
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt1', '/w/wt2']);
  assert.deepEqual(store.get(FOLDER.key), ['wt1', 'wt2']);

  await Promise.all([service.reopen(FOLDER, ['wt1']), service.reopen(FOLDER, ['wt2'])]);
  assert.equal(settings.filesExclude, undefined);
  assert.equal(settings.javaWorkspace, undefined);
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('reopen: Java 쓰기가 실패해도 files.exclude 와 목록은 반영하고 오류를 알린다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE_JAVA);
  settings.failJava = true;

  const result = await service.reopen(FOLDER, ['wt1']);

  assert.deepEqual(result.changed, ['wt1']);
  assert.equal(result.javaChanged, false);
  assert.match(String(result.javaError), /EACCES/);
  assert.equal(settings.filesExclude, undefined);
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('reopen: Java 확장이 꺼져 설정이 없으면 Java 는 건너뛴다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE_JAVA);
  settings.javaRegistered = false;
  settings.writes = [];

  const result = await service.reopen(FOLDER, ['wt1']);

  assert.deepEqual(result, { changed: ['wt1'], skipped: [], javaChanged: false });
  assert.deepEqual(settings.writes, ['files']);
});

test('reconcile: 사용자가 false 로 바꾼 키는 목록에서만 빼고 settings.json 은 그대로 둔다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE);
  settings.filesExclude = { wt1: false };
  settings.writes = [];

  const result = await service.reconcile(FOLDER);

  assert.deepEqual(result.changed, ['wt1']);
  assert.deepEqual(settings.filesExclude, { wt1: false });
  assert.deepEqual(settings.writes, []);
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('releaseJava: 빠진 폴더의 Java 패턴만 지우고 목록은 남긴다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE_JAVA);

  const result = await service.releaseJava(FOLDER);

  assert.equal(result.javaChanged, true);
  assert.equal(settings.javaWorkspace, undefined);
  assert.deepEqual(settings.filesExclude, { wt1: true });
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);
});

test('dim: search.exclude 에만 쓰고 files.exclude 는 건드리지 않는다', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };

  await service.close(FOLDER, ['wt1'], DIM);

  assert.deepEqual(settings.searchExclude, { wt1: true });
  assert.deepEqual(settings.filesExclude, { '**/target': true });
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);

  await service.reopen(FOLDER, ['wt1']);
  assert.equal(settings.searchExclude, undefined);
  assert.deepEqual(settings.filesExclude, { '**/target': true });
});

test('dim: 사용자가 files.exclude 에 직접 넣은 경로는 건너뛴다', async () => {
  const { settings, service } = setup();
  settings.filesExclude = { mine: true };
  const result = await service.close(FOLDER, ['mine'], DIM);
  assert.deepEqual(result.skipped, ['mine']);
  assert.equal(settings.searchExclude, undefined);
});

test('reconcile: search.exclude 에서 직접 지운 항목은 목록에서 뺀다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], DIM);
  settings.searchExclude = { wt2: true };

  const result = await service.reconcile(FOLDER);

  assert.deepEqual(result.changed, ['wt1']);
  assert.deepEqual(store.get(FOLDER.key), ['wt2']);
});

test('changeStyle: 닫아 둔 항목을 새 방식의 설정으로 옮기고 사용자 키는 그대로 둔다', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };
  await service.close(FOLDER, ['wt1', 'wt2'], DIM);

  const result = await service.changeStyle(FOLDER, () => 'hide');

  assert.deepEqual(result.changed, ['wt1', 'wt2']);
  assert.deepEqual(settings.filesExclude, { '**/target': true, wt1: true, wt2: true });
  assert.equal(settings.searchExclude, undefined);
  assert.deepEqual(store.get(FOLDER.key), ['wt1', 'wt2']);
  assert.deepEqual((await service.changeStyle(FOLDER, () => 'hide')).changed, []);
});

test('changeStyle: 0.9.0 업그레이드 경로 hide → dim', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };
  await service.close(FOLDER, ['wt1'], HIDE);

  const result = await service.changeStyle(FOLDER, () => 'dim');

  assert.deepEqual(result.changed, ['wt1']);
  assert.deepEqual(settings.searchExclude, { wt1: true });
  assert.deepEqual(settings.filesExclude, { '**/target': true });
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);
});

test('changeStyle: 옮겨 갈 설정에 사용자 키가 있으면 덮어쓰지 않고 그 항목은 두고 간다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], HIDE);
  settings.searchExclude = { wt1: false };

  const result = await service.changeStyle(FOLDER, () => 'dim');

  assert.deepEqual(result.changed, ['wt2']);
  assert.deepEqual(settings.searchExclude, { wt1: false, wt2: true });
  assert.deepEqual(settings.filesExclude, { wt1: true });
});

test('changeStyle: 방식은 작업이 실행될 때 읽는다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], HIDE);
  let style: 'dim' | 'hide' = 'dim';
  const pending = service.changeStyle(FOLDER, () => style);
  style = 'hide';
  assert.deepEqual((await pending).changed, []);
  assert.deepEqual(settings.filesExclude, { wt1: true });
});

test('reopen: 두 exclude 설정에 모두 있으면 둘 다 지운다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], DIM);
  settings.filesExclude = { wt1: true, '**/target': true };

  await service.reopen(FOLDER, ['wt1']);

  assert.equal(settings.searchExclude, undefined);
  assert.deepEqual(settings.filesExclude, { '**/target': true });
});
