// activate 스모크 테스트용 최소 vscode 대역
export const registered: string[] = [];

const disposable = { dispose() {} };

export const commands = {
  registerCommand(id: string) {
    registered.push(id);
    return disposable;
  },
  async getCommands() {
    return [];
  },
};

export const workspace = {
  workspaceFolders: undefined,
  onDidChangeConfiguration: () => disposable,
  onDidChangeWorkspaceFolders: () => disposable,
  getConfiguration: () => ({ inspect: () => undefined, get: (_k: string, d: unknown) => d }),
};

export const window = {};
export const extensions = { getExtension: () => undefined };
export const env = { language: 'ko' };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const FileType = { File: 1, Directory: 2 };
export class ThemeIcon {
  constructor(public id: string) {}
}
export const Uri = { parse: (value: string) => ({ toString: () => value }) };
