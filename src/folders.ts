import * as vscode from 'vscode';
import { StashFolder } from './stashService';

export function toStashFolder(workspaceFolder: vscode.WorkspaceFolder): StashFolder {
  return { key: workspaceFolder.uri.toString(), fsPath: workspaceFolder.uri.fsPath };
}

export function workspaceFolders(): { folder: StashFolder; name: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((wf) => ({ folder: toStashFolder(wf), name: wf.name }));
}
