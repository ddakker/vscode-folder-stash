import * as path from 'path';
import * as vscode from 'vscode';
import { ClosedView } from './closedView';
import { toStashFolder, workspaceFolders } from './folders';
import { t } from './messages';
import { findMissing } from './missing';
import { showReopenQuickPick } from './reopenQuickPick';
import { VscodeSettings } from './settingsWriter';
import { CloseStyle, toPosix } from './stashCore';
import { ChangeResult, StashFolder, StashService } from './stashService';
import { WorkspaceStateStore } from './stashStore';

const JAVA_EXTENSION_ID = 'redhat.java';
// 닫기: 이미 불러온 프로젝트를 빼려면 Java 작업 공간 정리가 필요하다. 열기: 다시 불러오기만 하면 된다.
const JAVA_RELOAD_COMMAND = {
  close: 'java.clean.workspace',
  reopen: 'java.project.import.command',
};

export function activate(context: vscode.ExtensionContext): void {
  let view: ClosedView | undefined;
  const store = new WorkspaceStateStore(context.workspaceState, () => view?.refresh());
  const service = new StashService(new VscodeSettings(), store);
  view = new ClosedView(service);

  context.subscriptions.push(
    view,
    vscode.window.registerFileDecorationProvider(view),
    vscode.commands.registerCommand('folderStash.closeDirectory', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      withPrune(service, JAVA_RELOAD_COMMAND.close, () => closeDirectories(service, selectedUris(uri, uris))),
    ),
    vscode.commands.registerCommand('folderStash.reopenSelected', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      withPrune(service, JAVA_RELOAD_COMMAND.reopen, () => reopenSelected(service, selectedUris(uri, uris))),
    ),
    vscode.commands.registerCommand('folderStash.reopenDirectory', () =>
      withPrune(service, JAVA_RELOAD_COMMAND.reopen, () => showReopenList(service)),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('folderStash.closeStyle')) {
        void syncAll(service);
      } else if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('search.exclude')) {
        void reconcileAll(service).then(offerReopenReload);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      let javaChanged = false;
      for (const removed of e.removed) {
        javaChanged = warnJavaError(await service.releaseJava(toStashFolder(removed)).catch(showError)) || javaChanged;
      }
      javaChanged = (await reconcileAll(service)) || javaChanged;
      offerReopenReload(javaChanged);
      view?.refresh();
    }),
  );

  view.refresh();
  void syncAll(service);
}

export function deactivate(): void {}

async function closeDirectories(service: StashService, uris: vscode.Uri[]): Promise<boolean> {
  const groups = await groupDirectoriesByFolder(uris);
  if (groups.size === 0) {
    void vscode.window.showInformationMessage(t('noTarget'));
    return false;
  }

  const options = { style: closeStyle(), excludeFromJava: shouldExcludeFromJava() };
  let closed = 0;
  let javaChanged = false;
  const skipped: string[] = [];
  try {
    for (const { folder, name, relPaths } of groups.values()) {
      const result = await service.close(folder, relPaths, options);
      closed += result.changed.length;
      javaChanged ||= result.javaChanged;
      skipped.push(...result.skipped.map((relPath) => displayPath(name, relPath, groups.size > 1)));
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
  return javaChanged;
}

/** 다시 열고 Java 가 바뀌었는지 돌려준다 */
async function reopenDirectories(service: StashService, folder: StashFolder, relPaths: string[]): Promise<boolean> {
  const result = await service.reopen(folder, relPaths).catch(showError);
  if (result && result.changed.length > 0) {
    void vscode.window.showInformationMessage(t('reopened', result.changed.length));
  }
  return warnJavaError(result);
}

/** 탐색기에서 회색 디렉토리를 우클릭해 바로 다시 연다 */
async function reopenSelected(service: StashService, uris: vscode.Uri[]): Promise<boolean> {
  let javaChanged = false;
  for (const { folder, relPaths } of (await groupDirectoriesByFolder(uris)).values()) {
    javaChanged = (await reopenDirectories(service, folder, relPaths.map(toPosix))) || javaChanged;
  }
  return javaChanged;
}

/** 목록은 띄우기만 하고 바로 돌아온다. 고른 뒤의 Java 다시 불러오기는 목록에서 직접 제안한다 */
async function showReopenList(service: StashService): Promise<boolean> {
  await showReopenQuickPick(service, workspaceFolders(), async (folder, relPaths) =>
    offerReopenReload(await reopenDirectories(service, folder, relPaths)),
  );
  return false;
}

/** 지워진 디렉토리를 먼저 정리하고 명령을 실행한다. Java 다시 불러오기는 한 번만 제안한다 */
async function withPrune(service: StashService, reloadCommand: string, action: () => Promise<boolean>): Promise<void> {
  const pruned = await pruneAll(service);
  if (await action()) {
    void offerJavaReload(reloadCommand);
  } else {
    offerReopenReload(pruned);
  }
}

/** 디스크에서 지워진 닫은 디렉토리는 다시 연 것으로 정리한다. Java 가 바뀌었는지 돌려준다 */
async function pruneAll(service: StashService): Promise<boolean> {
  const folders = workspaceFolders();
  const pruned: string[] = [];
  let javaChanged = false;
  for (const { folder, name } of folders) {
    const missing = await findMissing(folder, service.list(folder));
    if (missing.length === 0) {
      continue;
    }
    // 확인과 정리 사이에 목록이 바뀌어도 reopen 은 아직 목록에 있는 항목만 처리한다
    const result = await service.reopen(folder, missing).catch(showError);
    pruned.push(...(result?.changed ?? []).map((relPath) => displayPath(name, relPath, folders.length > 1)));
    javaChanged = warnJavaError(result) || javaChanged;
  }
  if (pruned.length > 0) {
    void vscode.window.showInformationMessage(t('pruned', pruned.join(', ')));
  }
  return javaChanged;
}

/** 지워진 디렉토리와 직접 지운 항목을 먼저 정리하고, 남은 항목을 현재 닫는 방식의 설정으로 옮긴다 */
async function syncAll(service: StashService): Promise<void> {
  const pruned = await pruneAll(service);
  offerReopenReload((await reconcileAll(service)) || pruned);
  for (const { folder } of workspaceFolders()) {
    await service.changeStyle(folder, closeStyle).catch(showError);
  }
}

/** 폴더 하나가 실패해도 나머지 폴더는 계속 맞춘다. Java 가 바뀌었는지 돌려준다 */
async function reconcileAll(service: StashService): Promise<boolean> {
  let javaChanged = false;
  for (const { folder } of workspaceFolders()) {
    javaChanged = warnJavaError(await service.reconcile(folder).catch(showError)) || javaChanged;
  }
  return javaChanged;
}

/** 제거 방향 결과의 Java 쓰기 실패를 경고하고, Java 가 바뀌었는지 돌려준다 */
function warnJavaError(result: ChangeResult | undefined): boolean {
  if (result?.javaError !== undefined) {
    void vscode.window.showWarningMessage(t('javaFailed', errorMessage(result.javaError)));
  }
  return result?.javaChanged ?? false;
}

function offerReopenReload(javaChanged: boolean): void {
  if (javaChanged) {
    void offerJavaReload(JAVA_RELOAD_COMMAND.reopen);
  }
}

/** 멀티 루트에서는 폴더 이름을 앞에 붙인다 */
function displayPath(name: string, relPath: string, multiRoot: boolean): string {
  return multiRoot ? `${name}/${relPath}` : relPath;
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

function selectedUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  return uris?.length ? uris : uri ? [uri] : [];
}

function closeStyle(): CloseStyle {
  return vscode.workspace.getConfiguration('folderStash').get<CloseStyle>('closeStyle', 'dim');
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
