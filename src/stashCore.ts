// vscode 에 의존하지 않는 순수 함수 모음 (단위 테스트 대상)

export type ExcludeMap = Record<string, unknown>;

/** dim: 탐색기에는 회색으로 남기고 검색에서만 뺀다. hide: 탐색기에서도 숨긴다 */
export type CloseStyle = 'dim' | 'hide';
export type ExcludeKey = 'files.exclude' | 'search.exclude';
export const EXCLUDE_KEYS: ExcludeKey[] = ['files.exclude', 'search.exclude'];

export function excludeKeyOf(style: CloseStyle): ExcludeKey {
  return style === 'hide' ? 'files.exclude' : 'search.exclude';
}

/** files.exclude 키 — 워크스페이스 폴더 기준 상대 경로 glob */
export function toExcludePattern(relPath: string): string {
  // VS Code glob 은 백슬래시 escape 를 지원하지 않아 문자 클래스로 감싼다.
  // [ ] 는 문자 클래스로 표현할 수 없어 한 글자 와일드카드(?)로 바꾼다.
  return toPosix(relPath).replace(/[*?{}\[\]]/g, (ch) => (ch === '[' || ch === ']' ? '?' : `[${ch}]`));
}

/**
 * java.import.exclusions 항목 — 디렉토리 절대 경로 자체.
 * jdt.ls 는 디렉토리 방문 시 그 경로를 glob 과 비교해 하위 전체를 건너뛰므로 '/**' 를 붙이면 안 된다.
 * (Java PathMatcher 는 백슬래시 escape 지원)
 */
export function toJavaPattern(absPath: string): string {
  return toPosix(absPath).replace(/[*?{}\[\]\\]/g, (ch) => `\\${ch}`);
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function addExcludeKeys(folderValue: ExcludeMap | undefined, patterns: string[]): ExcludeMap {
  const next: ExcludeMap = { ...(folderValue ?? {}) };
  for (const pattern of patterns) {
    next[pattern] = true;
  }
  return next;
}

/** 값이 true 인 키만 제거한다 (사용자가 false·when 으로 바꾼 키는 유지). 남는 키가 없으면 undefined */
export function removeExcludeKeys(folderValue: ExcludeMap | undefined, patterns: string[]): ExcludeMap | undefined {
  const next: ExcludeMap = { ...(folderValue ?? {}) };
  for (const pattern of patterns) {
    if (next[pattern] === true) {
      delete next[pattern];
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * 배열 설정은 상위 계층을 덮어쓰므로, 현재 적용 중인 값(effective)에 패턴을 더해 쓴다.
 * effective = workspaceValue ?? inherited
 */
export function addJavaExclusions(effective: string[], patterns: string[]): string[] {
  const next = [...effective];
  for (const pattern of patterns) {
    if (!next.includes(pattern)) {
      next.push(pattern);
    }
  }
  return next;
}

/** 패턴을 제거한다. 결과가 상속값과 같으면 undefined (워크스페이스 키를 지워 상속 상태로 복귀) */
export function removeJavaExclusions(
  workspaceValue: string[] | undefined,
  patterns: string[],
  inherited: string[],
): string[] | undefined {
  if (workspaceValue === undefined) {
    return undefined;
  }
  const next = workspaceValue.filter((item) => !patterns.includes(item));
  return sameItems(next, inherited) ? undefined : next;
}

/** settings.json 우선: 어느 exclude 설정에서도 true 가 아닌 항목은 사용자가 직접 연 것으로 본다 */
export function reconcile(
  stored: string[],
  values: (ExcludeMap | undefined)[],
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const relPath of stored) {
    if (values.some((value) => value?.[toExcludePattern(relPath)] === true)) {
      kept.push(relPath);
    } else {
      dropped.push(relPath);
    }
  }
  return { kept, dropped };
}

/** relPath 가 닫은 디렉토리 자신이거나 그 아래이면 그 닫은 디렉토리를 돌려준다 */
export function findClosedAncestor(closed: string[], relPath: string): string | undefined {
  const target = toPosix(relPath);
  return closed.find((dir) => target === dir || target.startsWith(dir + '/'));
}

export function sameItems(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
