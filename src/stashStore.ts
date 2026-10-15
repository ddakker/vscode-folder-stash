import * as vscode from 'vscode';
import { StorePort } from './stashService';

const KEY_PREFIX = 'folderStash.closed:';

/** 닫힌 상대 경로 목록을 워크스페이스 폴더별로 workspaceState 에 저장한다 */
export class WorkspaceStateStore implements StorePort {
  constructor(private readonly memento: vscode.Memento) {}

  get(folderKey: string): string[] {
    return this.memento.get<string[]>(KEY_PREFIX + folderKey, []);
  }

  async set(folderKey: string, relPaths: string[]): Promise<void> {
    await this.memento.update(KEY_PREFIX + folderKey, relPaths.length > 0 ? relPaths : undefined);
  }
}
