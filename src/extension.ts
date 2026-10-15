import * as path from 'path';
import * as vscode from 'vscode';
import { t } from './messages';
import { showReopenQuickPick } from './reopenQuickPick';
import { VscodeSettings } from './settingsWriter';
import { ChangeResult, StashFolder, StashService } from './stashService';
import { WorkspaceStateStore } from './stashStore';

const JAVA_EXTENSION_ID = 'redhat.java';
// 닫기: 이미 불러온 프로젝트를 빼려면 Java 작업 공간 정리가 필요하다. 열기: 다시 불러오기만 하면 된다.
const JAVA_RELOAD_COMMAND = {
  close: 'java.clean.workspace',
  reopen: 'java.project.import.command',
};

export function activate(context: vscode.ExtensionContext): void {
  const service = new StashService(new VscodeSettings(), new WorkspaceStateStore(context.workspaceState));

  context.subscriptions.push(
    vscode.commands.registerCommand('folderStash.closeDirectory', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      closeDirectories(service, uris?.length ? uris : uri ? [uri] : []),
    ),
    vscode.commands.registerCommand('folderStash.reopenDirectory', () =>
      showReopenQuickPick(service, workspaceFolders(), (folder, relPaths) =>
        reopenDirectories(service, folder, relPaths),
      ),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('files.exclude')) {
        void reconcileAll(service);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      for (const removed of e.removed) {
        handleResult(await service.releaseJava(toStashFolder(removed)).catch(showError));
      }
      await reconcileAll(service);
    }),
  );

  void reconcileAll(service);
}

export function deactivate(): void {}

async function closeDirectories(service: StashService, uris: vscode.Uri[]): Promise<void> {
  const groups = await groupDirectoriesByFolder(uris);
  if (groups.size === 0) {
    void vscode.window.showInformationMessage(t('noTarget'));
    return;
  }

  const excludeFromJava = shouldExcludeFromJava();
  let closed = 0;
  let javaChanged = false;
  const skipped: string[] = [];
  try {
    for (const { folder, name, relPaths } of groups.values()) {
      const result = await service.close(folder, relPaths, excludeFromJava);
      closed += result.changed.length;
      javaChanged ||= result.javaChanged;
      skipped.push(...result.skipped.map((relPath) => (groups.size > 1 ? `${name}/${relPath}` : relPath)));
    }
  } catch (err) {
    showError(err);
  }

  if (closed > 0) {
    void vscode.window.showInformationMessage(t('closed', closed));
  }
  if (skipped.length > 0) {
    void vscode.window.showWarningMessage(t('alreadyClosed', skipped.join(', ')));
  }
  if (javaChanged) {
    void offerJavaReload(JAVA_RELOAD_COMMAND.close);
  }
}

async function reopenDirectories(service: StashService, folder: StashFolder, relPaths: string[]): Promise<void> {
  const result = await service.reopen(folder, relPaths).catch(showError);
  if (result && result.changed.length > 0) {
    void vscode.window.showInformationMessage(t('reopened', result.changed.length));
  }
  handleResult(result);
}

/** 폴더 하나가 실패해도 나머지 폴더는 계속 맞춘다 */
async function reconcileAll(service: StashService): Promise<void> {
  for (const { folder } of workspaceFolders()) {
    handleResult(await service.reconcile(folder).catch(showError));
  }
}

/** 제거 방향 결과 처리: Java 쓰기 실패는 경고만, 바뀌었으면 다시 불러오기를 제안한다 */
function handleResult(result: ChangeResult | undefined): void {
  if (result?.javaError !== undefined) {
    void vscode.window.showWarningMessage(t('javaFailed', errorMessage(result.javaError)));
  }
  if (result?.javaChanged) {
    void offerJavaReload(JAVA_RELOAD_COMMAND.reopen);
  }
}

/** 디렉토리만 골라 워크스페이스 폴더별로 묶는다. 루트 폴더 자신과 파일은 제외한다 */
async function groupDirectoriesByFolder(
  uris: vscode.Uri[],
): Promise<Map<string, { folder: StashFolder; name: string; relPaths: string[] }>> {
  const groups = new Map<string, { folder: StashFolder; name: string; relPaths: string[] }>();
  for (const uri of uris) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder || !(await isDirectory(uri))) {
      continue;
    }
    const relPath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    if (!isInside(relPath)) {
      continue;
    }
    const folder = toStashFolder(workspaceFolder);
    const group = groups.get(folder.key) ?? { folder, name: workspaceFolder.name, relPaths: [] };
    group.relPaths.push(relPath);
    groups.set(folder.key, group);
  }
  return groups;
}

/** 루트 자신('')과 바깥 경로('..', '../x')는 제외. '..cache' 같은 이름은 허용 */
function isInside(relPath: string): boolean {
  return relPath !== '' && relPath !== '..' && !relPath.startsWith('..' + path.sep) && !path.isAbsolute(relPath);
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

function workspaceFolders(): { folder: StashFolder; name: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((wf) => ({ folder: toStashFolder(wf), name: wf.name }));
}

function toStashFolder(workspaceFolder: vscode.WorkspaceFolder): StashFolder {
  return { key: workspaceFolder.uri.toString(), fsPath: workspaceFolder.uri.fsPath };
}

/** Java 확장이 없으면 java.import.exclusions 를 쓰지 않는다 */
function shouldExcludeFromJava(): boolean {
  const enabled = vscode.workspace.getConfiguration('folderStash').get<boolean>('excludeFromJava', true);
  return enabled && vscode.extensions.getExtension(JAVA_EXTENSION_ID) !== undefined;
}

async function offerJavaReload(command: string): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(command)) {
    return;
  }
  const answer = await vscode.window.showInformationMessage(t('javaReload'), t('javaReloadButton'));
  if (answer) {
    await vscode.commands.executeCommand(command);
  }
}

function showError(err: unknown): undefined {
  void vscode.window.showErrorMessage(t('failed', errorMessage(err)));
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
