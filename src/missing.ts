import * as vscode from 'vscode';
import { StashFolder } from './stashService';

/** 닫은 경로 중 디스크에서 지워졌거나 파일로 바뀐 것. 여러 경로를 한 번에 확인한다 */
export async function findMissing(folder: StashFolder, relPaths: string[]): Promise<string[]> {
  const root = vscode.Uri.parse(folder.key);
  const missing = await Promise.all(relPaths.map((relPath) => isMissingDirectory(vscode.Uri.joinPath(root, relPath))));
  return relPaths.filter((_, i) => missing[i]);
}

/** 원격 연결 전 등 확인할 수 없는 오류는 지워진 것으로 보지 않는다 */
export async function isMissingDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) === 0;
  } catch (err) {
    return err instanceof vscode.FileSystemError && err.code === 'FileNotFound';
  }
}
