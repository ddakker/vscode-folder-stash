import * as vscode from 'vscode';
import { t } from './messages';
import { StashFolder, StashService } from './stashService';

interface ClosedItem extends vscode.QuickPickItem {
  folder: StashFolder;
  relPath: string;
}

export interface ReopenHandler {
  (folder: StashFolder, relPaths: string[]): Promise<void>;
}

/** 닫은 디렉토리 다중 선택 → 다시 열기. 항목 버튼은 해당 항목만 즉시 다시 연다 */
export async function showReopenQuickPick(
  service: StashService,
  folders: { folder: StashFolder; name: string }[],
  reopen: ReopenHandler,
): Promise<void> {
  const items = await buildItems(service, folders);
  if (items.length === 0) {
    void vscode.window.showInformationMessage(t('nothingClosed'));
    return;
  }

  const pick = vscode.window.createQuickPick<ClosedItem>();
  pick.canSelectMany = true;
  pick.placeholder = t('pickPlaceholder');
  pick.items = items;

  pick.onDidTriggerItemButton(async ({ item }) => {
    await reopen(item.folder, [item.relPath]);
    pick.items = await buildItems(service, folders);
    if (pick.items.length === 0) {
      pick.hide();
    }
  });
  pick.onDidAccept(async () => {
    const selected = [...pick.selectedItems];
    pick.hide();
    for (const [folder, relPaths] of groupByFolder(selected)) {
      await reopen(folder, relPaths);
    }
  });
  pick.onDidHide(() => pick.dispose());
  pick.show();
}

async function buildItems(
  service: StashService,
  folders: { folder: StashFolder; name: string }[],
): Promise<ClosedItem[]> {
  const multiRoot = folders.length > 1;
  const reopenButton = { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: t('reopenNow') };
  const items: ClosedItem[] = [];
  for (const { folder, name } of folders) {
    for (const relPath of service.list(folder)) {
      const missing = !(await exists(vscode.Uri.joinPath(vscode.Uri.parse(folder.key), relPath)));
      const description = [multiRoot ? name : '', missing ? t('missing') : ''].filter(Boolean).join(' ');
      items.push({ label: relPath, description, folder, relPath, buttons: [reopenButton] });
    }
  }
  return items;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function groupByFolder(items: ClosedItem[]): Map<StashFolder, string[]> {
  const groups = new Map<StashFolder, string[]>();
  for (const item of items) {
    groups.set(item.folder, [...(groups.get(item.folder) ?? []), item.relPath]);
  }
  return groups;
}
