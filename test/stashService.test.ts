import { strict as assert } from 'assert';
import { test } from 'node:test';
import { ExcludeMap } from '../src/stashCore';
import { SettingsPort, StashFolder, StashService, StorePort } from '../src/stashService';

const JAVA_DEFAULT = ['**/node_modules/**'];
const FOLDER: StashFolder = { key: 'file:///w', fsPath: '/w' };

class FakeSettings implements SettingsPort {
  filesExclude: ExcludeMap | undefined;
  javaWorkspace: string[] | undefined;
  writes: string[] = [];
  failJava = false;
  javaRegistered = true;
  onWrite: () => Promise<void> = async () => {};

  getFilesExclude(): ExcludeMap | undefined {
    return this.filesExclude;
  }
  async setFilesExclude(_folder: StashFolder, value: ExcludeMap | undefined): Promise<void> {
    this.writes.push('files');
    this.filesExclude = value;
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

  const result = await service.close(FOLDER, ['wt1', 'wt2'], true);

  assert.deepEqual(result, { changed: ['wt1', 'wt2'], skipped: [], javaChanged: true });
  assert.deepEqual(settings.writes, ['files', 'java']);
  assert.deepEqual(settings.filesExclude, { '**/target': true, wt1: true, wt2: true });
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt1', '/w/wt2']);
  assert.deepEqual(store.get(FOLDER.key), ['wt1', 'wt2']);
});

test('close: Java 제외를 끄면 java 설정을 쓰지 않는다', async () => {
  const { settings, service } = setup();
  const result = await service.close(FOLDER, ['wt1'], false);
  assert.equal(result.javaChanged, false);
  assert.deepEqual(settings.writes, ['files']);
  assert.equal(settings.javaWorkspace, undefined);
});

test('close: 이미 닫힌 경로와 사용자가 직접 넣은 패턴은 건너뛴다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], false);
  settings.filesExclude = { ...settings.filesExclude, mine: true };
  settings.writes = [];

  const result = await service.close(FOLDER, ['wt1', 'mine', 'wt1'], false);

  assert.deepEqual(result, { changed: [], skipped: ['wt1', 'mine'], javaChanged: false });
  assert.deepEqual(settings.writes, []);
});

test('close: java 쓰기 실패 시 files.exclude 를 되돌리고 목록도 바꾸지 않는다', async () => {
  const { settings, store, service } = setup();
  settings.filesExclude = { '**/target': true };
  settings.failJava = true;

  await assert.rejects(service.close(FOLDER, ['wt1'], true), /EACCES/);

  assert.deepEqual(settings.filesExclude, { '**/target': true });
  assert.deepEqual(store.get(FOLDER.key), []);
});

test('reopen: 우리 항목만 제거하고, 모두 열면 설정 키를 지운다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], true);

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
  await service.close(FOLDER, ['wt1'], true);
  const result = await service.reopen(FOLDER, ['wt1']);
  assert.equal(result.javaChanged, true);
  assert.equal(settings.javaWorkspace, undefined);
});

test('reconcile: settings.json 에서 직접 지운 항목은 목록과 java 에서도 제거', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], true);
  settings.filesExclude = { wt1: true };

  const result = await service.reconcile(FOLDER);

  assert.deepEqual(result.changed, ['wt2']);
  assert.equal(result.javaChanged, true);
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);
  assert.deepEqual(settings.javaWorkspace, [...JAVA_DEFAULT, '/w/wt1']);
});

test('reconcile: 상태가 같으면 아무것도 쓰지 않는다', async () => {
  const { settings, service } = setup();
  await service.close(FOLDER, ['wt1'], false);
  settings.writes = [];
  assert.deepEqual((await service.reconcile(FOLDER)).changed, []);
  assert.deepEqual(settings.writes, []);
});

test('reconcile: 쓰는 도중 발생한 설정 변경 이벤트는 쓰기가 끝난 뒤 실행되어 아무것도 바꾸지 않는다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1', 'wt2'], false);
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

  await Promise.all([service.close(FOLDER, ['wt1'], true), service.close(FOLDER, ['wt2'], true)]);
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
  await service.close(FOLDER, ['wt1'], true);
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
  await service.close(FOLDER, ['wt1'], true);
  settings.javaRegistered = false;
  settings.writes = [];

  const result = await service.reopen(FOLDER, ['wt1']);

  assert.deepEqual(result, { changed: ['wt1'], skipped: [], javaChanged: false });
  assert.deepEqual(settings.writes, ['files']);
});

test('reconcile: 사용자가 false 로 바꾼 키는 목록에서만 빼고 settings.json 은 그대로 둔다', async () => {
  const { settings, store, service } = setup();
  await service.close(FOLDER, ['wt1'], false);
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
  await service.close(FOLDER, ['wt1'], true);

  const result = await service.releaseJava(FOLDER);

  assert.equal(result.javaChanged, true);
  assert.equal(settings.javaWorkspace, undefined);
  assert.deepEqual(settings.filesExclude, { wt1: true });
  assert.deepEqual(store.get(FOLDER.key), ['wt1']);
});
