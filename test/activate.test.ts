import { strict as assert } from 'assert';
import { test } from 'node:test';
import { activate } from '../src/extension';
import { registered } from './fakeVscode';

test('activate: 명령 세 개를 등록한다', () => {
  const memento = { get: (_k: string, d: unknown) => d, update: async () => {} };
  activate({ subscriptions: [], workspaceState: memento } as never);
  assert.deepEqual(registered, [
    'folderStash.closeDirectory',
    'folderStash.reopenSelected',
    'folderStash.reopenDirectory',
  ]);
});
