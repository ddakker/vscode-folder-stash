// activate 스모크 테스트용 최소 vscode 대역
export const registered: string[] = [];
export const executed: unknown[][] = [];

const disposable = { dispose() {} };

export const commands = {
  registerCommand(id: string) {
    registered.push(id);
    return disposable;
  },
  async getCommands() {
    return [];
  },
  async executeCommand(...args: unknown[]) {
    executed.push(args);
  },
};

interface FakeFolder {
  uri: { fsPath: string; toString(): string };
  name: string;
}

export const workspace = {
  workspaceFolders: undefined as FakeFolder[] | undefined,
  getWorkspaceFolder(uri: { fsPath: string }): FakeFolder | undefined {
    const inside = (root: string) => uri.fsPath === root || uri.fsPath.startsWith(root + '/');
    return this.workspaceFolders?.find((wf) => inside(wf.uri.fsPath));
  },
  onDidChangeConfiguration: () => disposable,
  onDidChangeWorkspaceFolders: () => disposable,
  getConfiguration: () => ({ inspect: () => undefined, get: (_k: string, d: unknown) => d }),
};

export const window = { registerFileDecorationProvider: () => disposable };
export class EventEmitter {
  event = () => disposable;
  fire() {}
  dispose() {}
}
export class ThemeColor {
  constructor(public id: string) {}
}
export const extensions = { getExtension: () => undefined };
export const env = { language: 'ko' };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const FileType = { File: 1, Directory: 2 };
export class ThemeIcon {
  constructor(public id: string) {}
}
export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
  file: (fsPath: string) => ({ fsPath, toString: () => 'file://' + fsPath }),
};
