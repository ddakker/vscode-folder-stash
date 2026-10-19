import * as path from 'path';
import {
  CloseStyle,
  EXCLUDE_KEYS,
  ExcludeKey,
  ExcludeMap,
  addExcludeKeys,
  excludeKeyOf,
  addJavaExclusions,
  reconcile,
  removeExcludeKeys,
  removeJavaExclusions,
  sameItems,
  toExcludePattern,
  toJavaPattern,
  toPosix,
} from './stashCore';

export interface StashFolder {
  key: string;
  fsPath: string;
}

export interface JavaExclusions {
  workspace: string[] | undefined;
  inherited: string[];
}

export interface SettingsPort {
  getExclude(folder: StashFolder, key: ExcludeKey): ExcludeMap | undefined;
  setExclude(folder: StashFolder, key: ExcludeKey, value: ExcludeMap | undefined): Promise<void>;
  /** Java 확장이 없어 설정이 등록되지 않았으면 undefined */
  getJavaExclusions(): JavaExclusions | undefined;
  setJavaExclusions(value: string[] | undefined): Promise<void>;
}

export interface StorePort {
  get(folderKey: string): string[];
  set(folderKey: string, relPaths: string[]): Promise<void>;
}

export interface ChangeResult {
  changed: string[];
  skipped: string[];
  javaChanged: boolean;
  /** 제거 방향에서 Java 설정 쓰기가 실패한 경우의 오류 (exclude 설정과 목록은 반영됨) */
  javaError?: unknown;
}

export interface CloseOptions {
  style: CloseStyle;
  excludeFromJava: boolean;
}

const NO_CHANGE: ChangeResult = { changed: [], skipped: [], javaChanged: false };

/**
 * 닫기/열기/상태 맞춤.
 *
 *   close : search.exclude 또는 files.exclude(폴더) → java.import.exclusions(워크스페이스) → workspaceState
 *   reopen: 같은 순서로 제거 (두 exclude 설정 모두에서)
 *   모든 작업은 큐로 하나씩 실행한다. 읽기와 쓰기 사이에 다른 작업이 끼어들어 값을 덮어쓰지 않도록 한다.
 */
export class StashService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: SettingsPort,
    private readonly store: StorePort,
  ) {}

  list(folder: StashFolder): string[] {
    return this.store.get(folder.key);
  }

  close(folder: StashFolder, relPaths: string[], options: CloseOptions): Promise<ChangeResult> {
    return this.run(() => this.doClose(folder, relPaths, options));
  }

  reopen(folder: StashFolder, relPaths: string[]): Promise<ChangeResult> {
    return this.run(() => this.doReopen(folder, relPaths));
  }

  /** settings.json 우선으로 목록을 맞춘다. changed 는 목록에서 제거된 항목이다 */
  reconcile(folder: StashFolder): Promise<ChangeResult> {
    return this.run(() => this.doReconcile(folder));
  }

  /**
   * 닫는 방식이 바뀌면 닫아 둔 항목을 다른 exclude 설정으로 옮긴다. changed 는 옮긴 항목이다.
   * 방식은 작업이 실행될 때 읽는다 (빠르게 여러 번 바꿔도 마지막 값으로 맞춰지도록).
   */
  changeStyle(folder: StashFolder, getStyle: () => CloseStyle): Promise<ChangeResult> {
    return this.run(() => this.doChangeStyle(folder, getStyle()));
  }

  /** 워크스페이스에서 빠진 폴더의 Java 패턴만 지운다 (exclude 설정과 목록은 그 폴더에 남겨 둔다) */
  releaseJava(folder: StashFolder): Promise<ChangeResult> {
    return this.run(async () => {
      const relPaths = this.store.get(folder.key);
      if (relPaths.length === 0) {
        return NO_CHANGE;
      }
      return { ...NO_CHANGE, ...(await this.removeJava(folder, relPaths)) };
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async doClose(folder: StashFolder, relPaths: string[], options: CloseOptions): Promise<ChangeResult> {
    const stored = this.store.get(folder.key);
    const key = excludeKeyOf(options.style);
    const folderValue = this.settings.getExclude(folder, key);
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const relPath of unique(relPaths.map(toPosix))) {
      // 이미 닫았거나, 사용자가 직접 넣어 둔 패턴은 건드리지 않는다 (다시 열 때 지워지지 않도록 두 설정 모두 확인)
      if (!relPath || stored.includes(relPath) || this.hasUserPattern(folder, relPath)) {
        skipped.push(relPath);
      } else {
        changed.push(relPath);
      }
    }
    if (changed.length === 0) {
      return { ...NO_CHANGE, skipped };
    }

    const java = options.excludeFromJava ? this.settings.getJavaExclusions() : undefined;
    const nextJava = java && addJavaExclusions(java.workspace ?? java.inherited, this.javaPatterns(folder, changed));
    await this.settings.setExclude(folder, key, addExcludeKeys(folderValue, changed.map(toExcludePattern)));
    if (nextJava) {
      try {
        await this.settings.setJavaExclusions(nextJava);
      } catch (err) {
        await this.rollbackExclude(folder, key, folderValue);
        throw err;
      }
    }
    await this.store.set(folder.key, [...stored, ...changed]);
    return { changed, skipped, javaChanged: nextJava !== undefined };
  }

  private async doReopen(folder: StashFolder, relPaths: string[]): Promise<ChangeResult> {
    const stored = this.store.get(folder.key);
    const changed = unique(relPaths).filter((relPath) => stored.includes(relPath));
    const skipped = unique(relPaths).filter((relPath) => !changed.includes(relPath));
    if (changed.length === 0) {
      return { ...NO_CHANGE, skipped };
    }
    const java = await this.removeFromSettings(folder, changed);
    await this.store.set(folder.key, stored.filter((relPath) => !changed.includes(relPath)));
    return { changed, skipped, ...java };
  }

  private async doReconcile(folder: StashFolder): Promise<ChangeResult> {
    const stored = this.store.get(folder.key);
    if (stored.length === 0) {
      return NO_CHANGE;
    }
    const values = EXCLUDE_KEYS.map((key) => this.settings.getExclude(folder, key));
    const { kept, dropped } = reconcile(stored, values);
    if (dropped.length === 0) {
      return NO_CHANGE;
    }
    const java = await this.removeFromSettings(folder, dropped);
    await this.store.set(folder.key, kept);
    return { changed: dropped, skipped: [], ...java };
  }

  /**
   * 새 위치에 먼저 쓰고 이전 위치에서 지운다 (중간에 실패해도 검색에 다시 나타나지 않도록).
   * 새 위치에 사용자가 넣은 같은 키가 있으면 덮어쓰지 않고 그 항목은 옮기지 않는다.
   */
  private async doChangeStyle(folder: StashFolder, style: CloseStyle): Promise<ChangeResult> {
    const target = excludeKeyOf(style);
    const source = excludeKeyOf(style === 'dim' ? 'hide' : 'dim');
    const sourceValue = this.settings.getExclude(folder, source);
    const targetValue = this.settings.getExclude(folder, target);
    const moving = this.store.get(folder.key).filter((relPath) => {
      const pattern = toExcludePattern(relPath);
      return sourceValue?.[pattern] === true && targetValue?.[pattern] === undefined;
    });
    if (moving.length === 0) {
      return NO_CHANGE;
    }
    const patterns = moving.map(toExcludePattern);
    await this.settings.setExclude(folder, target, addExcludeKeys(targetValue, patterns));
    await this.settings.setExclude(folder, source, removeExcludeKeys(sourceValue, patterns));
    return { ...NO_CHANGE, changed: moving };
  }

  private hasUserPattern(folder: StashFolder, relPath: string): boolean {
    const pattern = toExcludePattern(relPath);
    return EXCLUDE_KEYS.some((key) => this.settings.getExclude(folder, key)?.[pattern] !== undefined);
  }

  private async removeFromSettings(
    folder: StashFolder,
    relPaths: string[],
  ): Promise<Pick<ChangeResult, 'javaChanged' | 'javaError'>> {
    const patterns = relPaths.map(toExcludePattern);
    for (const key of EXCLUDE_KEYS) {
      const value = this.settings.getExclude(folder, key);
      const next = removeExcludeKeys(value, patterns);
      if (!sameExclude(value, next)) {
        await this.settings.setExclude(folder, key, next);
      }
    }
    return this.removeJava(folder, relPaths);
  }

  /**
   * 설정을 꺼 둔 상태에서도 이전에 넣은 Java 패턴은 제거한다.
   * 실패해도 되돌리지 않는다: 여는 동작은 Java 확장이 꺼져 있어도 성공해야 한다.
   */
  private async removeJava(
    folder: StashFolder,
    relPaths: string[],
  ): Promise<Pick<ChangeResult, 'javaChanged' | 'javaError'>> {
    const java = this.settings.getJavaExclusions();
    if (!java) {
      return { javaChanged: false };
    }
    const nextJava = removeJavaExclusions(java.workspace, this.javaPatterns(folder, relPaths), java.inherited);
    if (sameItems(java.workspace, nextJava)) {
      return { javaChanged: false };
    }
    try {
      await this.settings.setJavaExclusions(nextJava);
      return { javaChanged: true };
    } catch (err) {
      return { javaChanged: false, javaError: err };
    }
  }

  /** 되돌리기가 실패해도 원래 오류를 던지도록 여기서 삼킨다 */
  private async rollbackExclude(folder: StashFolder, key: ExcludeKey, value: ExcludeMap | undefined): Promise<void> {
    try {
      await this.settings.setExclude(folder, key, value);
    } catch {
      // 원래 오류를 우선한다
    }
  }

  private javaPatterns(folder: StashFolder, relPaths: string[]): string[] {
    return relPaths.map((relPath) => toJavaPattern(path.join(folder.fsPath, relPath)));
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function sameExclude(a: ExcludeMap | undefined, b: ExcludeMap | undefined): boolean {
  return sameItems(a && Object.keys(a), b && Object.keys(b));
}
