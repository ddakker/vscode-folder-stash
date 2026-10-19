import { strict as assert } from 'assert';
import { test } from 'node:test';
import * as vscode from 'vscode';
import { ClosedView } from '../src/closedView';
import { StashService } from '../src/stashService';
import { WorkspaceStateStore } from '../src/stashStore';
import { executed, workspace } from './fakeVscode';

const ROOT = vscode.Uri.file('/w');
workspace.workspaceFolders = [{ uri: ROOT, name: 'w' }];

function setup(closed: string[]) {
  const data = new Map<string, unknown>([['folderStash.closed:' + ROOT.toString(), closed]]);
  const memento = {
    get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
    update: async (key: string, value: unknown) => void data.set(key, value),
  };
  let changes = 0;
  const store = new WorkspaceStateStore(memento as never, () => changes++);
  const view = new ClosedView(new StashService({} as never, store));
  return { store, view, changes: () => changes };
}

test('ClosedView: 닫은 디렉토리는 배지+회색, 하위는 회색만, 이름이 겹치는 형제와 바깥은 없음', () => {
  const { view } = setup(['wt1']);
  const self = view.provideFileDecoration(vscode.Uri.file('/w/wt1') as never);
  assert.equal(self?.badge, '닫');
  assert.ok(self?.color);
  const child = view.provideFileDecoration(vscode.Uri.file('/w/wt1/src/A.java') as never);
  assert.equal(child?.badge, undefined);
  assert.ok(child?.color);
  assert.equal(view.provideFileDecoration(vscode.Uri.file('/w/wt10') as never), undefined);
  assert.equal(view.provideFileDecoration(vscode.Uri.file('/other/wt1') as never), undefined);
});

test('ClosedView.refresh: 닫은 디렉토리의 절대 경로를 컨텍스트 키로 넘긴다', () => {
  const { view } = setup(['wt1', 'sub/wt2']);
  executed.length = 0;
  view.refresh();
  assert.deepEqual(executed, [['setContext', 'folderStash.closedPaths', ['/w/wt1', '/w/sub/wt2']]]);
});

test('WorkspaceStateStore.set: 값이 바뀌면 onChange 를 부른다', async () => {
  const { store, changes } = setup([]);
  await store.set(ROOT.toString(), ['wt1']);
  assert.equal(changes(), 1);
  assert.deepEqual(store.get(ROOT.toString()), ['wt1']);
});
