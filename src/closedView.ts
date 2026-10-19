import * as path from 'path';
import * as vscode from 'vscode';
import { toStashFolder, workspaceFolders } from './folders';
import { t } from './messages';
import { findClosedAncestor, toPosix } from './stashCore';
import { StashService } from './stashService';

/** 우클릭 메뉴 조건 `resourcePath in folderStash.closedPaths` 에 쓰는 컨텍스트 키 */
const CLOSED_PATHS_CONTEXT = 'folderStash.closedPaths';
const DIM_COLOR = new vscode.ThemeColor('disabledForeground');

/**
 * 탐색기 표시: 닫은 디렉토리와 그 하위를 회색으로 칠하고, 닫은 디렉토리에는 배지와 툴팁을 단다.
 * (hide 방식이면 탐색기에 보이지 않으므로 칠해도 영향 없음)
 */
export class ClosedView implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private readonly service: StashService) {}

  refresh(): void {
    this.emitter.fire(undefined);
    const closedPaths = workspaceFolders().flatMap(({ folder }) =>
      this.service.list(folder).map((relPath) => path.join(folder.fsPath, relPath)),
    );
    void vscode.commands.executeCommand('setContext', CLOSED_PATHS_CONTEXT, closedPaths);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return undefined;
    }
    const relPath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    const closed = findClosedAncestor(this.service.list(toStashFolder(workspaceFolder)), relPath);
    if (closed === undefined) {
      return undefined;
    }
    if (closed !== toPosix(relPath)) {
      return { color: DIM_COLOR };
    }
    return { badge: t('closedBadge'), tooltip: t('closedTooltip'), color: DIM_COLOR };
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
