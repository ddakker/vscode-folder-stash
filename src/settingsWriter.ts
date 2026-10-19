import * as vscode from 'vscode';
import { ExcludeKey, ExcludeMap } from './stashCore';
import { JavaExclusions, SettingsPort, StashFolder } from './stashService';

const JAVA_EXCLUSIONS = 'java.import.exclusions';

/**
 * get() 은 기본값·사용자·폴더 값을 합친 결과라서 쓰기에 쓰지 않고 inspect() 로 계층별 값을 읽는다.
 * - files.exclude / search.exclude: resource 범위 → WorkspaceFolder 대상
 * - java.import.exclusions: window 범위 → Workspace 대상 (폴더 하나로 열면 둘 다 .vscode/settings.json)
 */
export class VscodeSettings implements SettingsPort {
  getExclude(folder: StashFolder, key: ExcludeKey): ExcludeMap | undefined {
    return config(folder).inspect<ExcludeMap>(key)?.workspaceFolderValue;
  }

  async setExclude(folder: StashFolder, key: ExcludeKey, value: ExcludeMap | undefined): Promise<void> {
    await config(folder).update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
  }

  /** 기본값이 없으면 Java 확장이 꺼져 있어 등록되지 않은 설정이다 (쓰면 오류) */
  getJavaExclusions(): JavaExclusions | undefined {
    const info = vscode.workspace.getConfiguration().inspect<string[]>(JAVA_EXCLUSIONS);
    if (info?.defaultValue === undefined) {
      return undefined;
    }
    return {
      workspace: info.workspaceValue,
      inherited: info.globalValue ?? info.defaultValue,
    };
  }

  async setJavaExclusions(value: string[] | undefined): Promise<void> {
    await vscode.workspace.getConfiguration().update(JAVA_EXCLUSIONS, value, vscode.ConfigurationTarget.Workspace);
  }
}

function config(folder: StashFolder): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(undefined, vscode.Uri.parse(folder.key));
}
