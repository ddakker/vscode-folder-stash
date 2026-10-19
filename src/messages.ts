import * as vscode from 'vscode';

const ko = {
  closed: '디렉토리 {0}개를 닫았습니다.',
  alreadyClosed: '이미 닫혀 있거나 search.exclude/files.exclude 에 직접 등록된 디렉토리는 건너뛰었습니다: {0}',
  noTarget: '닫을 하위 디렉토리를 탐색기에서 선택하세요.',
  reopened: '디렉토리 {0}개를 다시 열었습니다.',
  nothingClosed: '닫은 디렉토리가 없습니다.',
  pickPlaceholder: '다시 열 디렉토리를 선택하세요',
  missing: '(없음)',
  reopenNow: '바로 다시 열기',
  closedBadge: '닫',
  closedTooltip: '닫힘 (Folder Stash)',
  failed: 'Folder Stash 설정 저장 실패: {0}',
  javaReload: 'Java 프로젝트 제외 목록이 바뀌었습니다. Java 프로젝트를 다시 불러올까요?',
  javaReloadButton: '다시 불러오기',
  javaFailed: 'Java 제외 목록(java.import.exclusions)을 바꾸지 못했습니다. 직접 확인하세요: {0}',
};

const en: typeof ko = {
  closed: 'Closed {0} director(ies).',
  alreadyClosed: 'Skipped directories already closed or listed in search.exclude/files.exclude: {0}',
  noTarget: 'Select a sub directory in the Explorer to close.',
  reopened: 'Reopened {0} director(ies).',
  nothingClosed: 'No closed directories.',
  pickPlaceholder: 'Select directories to reopen',
  missing: '(missing)',
  reopenNow: 'Reopen now',
  closedBadge: 'C',
  closedTooltip: 'Closed (Folder Stash)',
  failed: 'Folder Stash failed to save settings: {0}',
  javaReload: 'Java import exclusions changed. Reload Java projects?',
  javaReloadButton: 'Reload',
  javaFailed: 'Could not update java.import.exclusions. Please check it manually: {0}',
};

export type MessageKey = keyof typeof ko;

export function t(key: MessageKey, ...args: (string | number)[]): string {
  const table = vscode.env.language.startsWith('ko') ? ko : en;
  return table[key].replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
}
