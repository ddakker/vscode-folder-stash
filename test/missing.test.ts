import { strict as assert } from 'assert';
import { test } from 'node:test';
import { findMissing } from '../src/missing';
import { FileSystemError, FileType, workspace } from './fakeVscode';

const FOLDER = { key: 'file:///w', fsPath: '/w' };

test('findMissing: 없거나 파일로 바뀐 경로만 고르고, 확인할 수 없는 오류는 건너뛴다', async () => {
  const entries: Record<string, () => { type: number }> = {
    'file:///w/dir': () => ({ type: FileType.Directory }),
    'file:///w/link': () => ({ type: FileType.Directory | FileType.SymbolicLink }),
    'file:///w/file': () => ({ type: FileType.File }),
    'file:///w/gone': () => {
      throw new FileSystemError('FileNotFound');
    },
    'file:///w/offline': () => {
      throw new FileSystemError('Unavailable');
    },
    'file:///w/plain': () => {
      throw new Error('ENOENT');
    },
  };
  workspace.fs.stat = async (uri) => entries[uri.toString()]();

  const missing = await findMissing(FOLDER, ['dir', 'link', 'file', 'gone', 'offline', 'plain']);

  assert.deepEqual(missing, ['file', 'gone']);
});
