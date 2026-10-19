# Folder Stash — 하위 디렉토리 임시 닫기/열기 (계획)

- 상태: ✅ 구현 완료 · 0.11.0 (단위 테스트 38개 통과, 지워진 디렉토리 정리 수동 확인 전)
- 작성: 2026-10-14 (KST)
- 참고: [artern/vscode-workspace-folder-stash](https://github.com/artern/vscode-workspace-folder-stash) v0.1.1

## 1. 배경

`/data/sources/khan-monitoring` 을 VS Code 에서 폴더 하나로 열면, 그 아래 git worktree 7개
(`khan-monitoring-error-dispatch` 등, 모두 `khan-monitoring-master` 의 worktree)가 함께 검색된다.
artern 확장은 `.code-workspace` 의 `folders[]` ↔ `stashedFolders[]` 를 옮기는 방식이라
**멀티 루트 워크스페이스의 루트 폴더만** 닫을 수 있다 (`when: workbenchState == workspace`).

목표: 이클립스의 Close/Open Project 처럼, 열어 둔 폴더의 **하위 디렉토리**를 우클릭으로 임시로 닫고 다시 연다.
닫힌 디렉토리는 아래 기능에서 빠져야 한다.

| 기능 | 회색 `dim` (기본, 12장) | 숨김 `hide` |
|---|---|---|
| 탐색기 | 회색 표시 (FileDecoration) | `files.exclude` 로 숨김 |
| 파일에서 찾기 (Ctrl+Shift+F) | `search.exclude` | `files.exclude` |
| 빠른 열기 (Ctrl+P) | `search.exclude` | `files.exclude` |
| 작업 영역의 기호로 이동 (Ctrl+T), 정의로 이동 | `java.import.exclusions` (redhat.java) | 같음 |

파일에서 찾기는 검색 창 "제외 설정 및 무시 파일 사용"이 켜져 있을 때만 제외된다.

## 2. 결정 사항 (eng review)

| # | 결정 | 이유 |
|---|---|---|
| D2 | 숨김 방식은 `files.exclude` 토글 | 폴더 하나로 연 상태를 유지한다. 루트 재구성 방식은 하위 디렉토리 29개가 루트로 펼쳐지고, 바꿀 때마다 확장 호스트가 재시작된다 |
| D3 | 닫힌 목록은 `context.workspaceState` 에 저장 | 프로젝트 파일에 목록이 남지 않는다 |
| D4/D6 | Java 언어 서버에서도 제외 (`folderStash.excludeFromJava`, 기본 true) | Ctrl+T 에서 같은 클래스가 worktree 수만큼 나오는 문제 |
| D5 | Wide Search 는 범위에서 제외 | VS Code 기본 검색만 대상 |
| D7 | 설정은 `inspect()` 로 계층별 처리 | 기본값과 사용자 설정이 복사되지 않게 하고, 배열은 덮어쓰기 때문에 상속값을 보존한다 |
| D8 | 상태가 어긋나면 settings.json 우선 | 사용자가 직접 고친 파일이 항상 이긴다 |
| D9 | 단위 테스트 + 수동 체크리스트 | 위험한 로직은 모두 순수 함수로 분리한다 |

## 3. 구조

```
 Explorer 우클릭                     명령 팔레트 / Explorer 우클릭
 "디렉토리 임시로 닫기"               "닫은 디렉토리 다시 열기"
        │                                     │
        ▼                                     ▼
 extension.ts ── closeDirs(uris) ──┐   reopenQuickPick.ts (다중 선택, 📂 바로 다시 열기)
   │ folders.ts (워크스페이스 폴더)  ▼          │
   │                        stashService.ts ◄─┘  (Promise 큐로 작업을 하나씩 실행)
   └─ closedView.ts: 탐색기 회색 표시 + 컨텍스트 키 folderStash.closedPaths (stashStore 변경 시 갱신)
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
          stashStore.ts     settingsWriter.ts     stashCore.ts (순수 함수, vscode 의존 없음)
          workspaceState    inspect()/update()    - toExcludePattern / toJavaPattern (escape)
          (폴더 URI별 키)    폴더/워크스페이스 대상 - addExcludeKeys / removeExcludeKeys
                                                  - addJavaExclusions / removeJavaExclusions
                                                  - reconcile(stored, folderFilesExclude, exists)
```

### 3.1 닫기 흐름

```
uris ─► 루트 폴더 자신이면 제외 ─► 상대 경로 계산 ─► 이미 닫힌 경로면 제외
     ─► files.exclude: inspect().workspaceFolderValue 에 {패턴: true} 추가 (update 1회)
     ─► (excludeFromJava && redhat.java 설치) java.import.exclusions: 상속 배열 + "<절대경로>" (update 1회)
     ─► workspaceState 에 저장
     ─► Java 쪽이 바뀌었으면 알림: [Java 프로젝트 다시 불러오기]
```

### 3.2 다시 열기 흐름

닫기의 역순이다. 확장이 넣은 키만 뺀다. `java.import.exclusions` 에 우리 항목이 하나도 남지 않으면
폴더 설정 키를 `undefined` 로 지워서 상속 상태로 되돌린다.

### 3.3 상태 맞춤 (D8)

실행 시점: `activate`, `onDidChangeConfiguration('files.exclude' | 'search.exclude' | 'folderStash.closeStyle')`,
워크스페이스 폴더 변경. 모든 작업은 큐로 하나씩 실행되므로, 확장이 쓴 설정 때문에 생긴 이벤트는 쓰기가 끝난 뒤
맞춤을 실행하고 아무것도 바꾸지 않는다. 표의 "files.exclude 폴더 값"은 두 exclude 설정 중 하나라도 `true` 인지로 본다.

| 저장된 목록 | files.exclude 폴더 값 | 디스크 | 처리 |
|---|---|---|---|
| 있음 | 있음 | 있음 | 그대로 |
| 있음 | **없음** | - | 사용자가 직접 열었다고 보고 목록과 java 항목에서 제거 |
| 있음 | - | **없음** | 다시 연 것으로 보고 두 exclude·java 항목과 목록에서 제거 (13장) |

## 4. 구현 규칙

- `files.exclude` 는 resource 범위라 `ConfigurationTarget.WorkspaceFolder` 에 쓴다.
- `java.import.exclusions` 는 redhat.java 에서 `scope: window` 라 폴더 단위로 쓸 수 없어 `ConfigurationTarget.Workspace` 에 쓴다.
  폴더 하나로 연 경우 둘 다 `.vscode/settings.json` 이다.
- `files.exclude` 는 `inspect().workspaceFolderValue` 만 읽고 쓴다. `get()` 의 병합값은 쓰지 않는다.
- `java.import.exclusions` 의 현재값은 `workspaceValue ?? globalValue ?? defaultValue` 이다.
- Java 패턴은 디렉토리 절대 경로 **그 자체**이다 (`/**` 를 붙이지 않음).
  jdt.ls `BasicFileDetector.preVisitDirectory` 가 디렉토리 경로를 `PathMatcher("glob:"+패턴)` 로 비교해 하위를 건너뛰므로,
  `/w/wt1/**` 는 `/w/wt1` 자신과 매칭되지 않아 `pom.xml` 이 그대로 불러와진다 (Java PathMatcher 로 확인).
- 패턴의 glob 특수문자 `[ ] { } * ?` 는 escape 한다.
- 여러 디렉토리를 닫거나 열 때도 설정 키마다 `update` 는 한 번만 호출한다 (Java 재로딩 1회).
- 디스크를 삭제하거나 이동하는 코드는 없다. 설정과 workspaceState 만 바꾼다.
- 메뉴 `when`: 닫기 `explorerResourceIsFolder && !explorerResourceIsRoot`, 다시 열기 `workspaceFolderCount > 0`.
- 문구는 `package.nls.json` / `package.nls.ko.json` 에 둔다.
  - 디렉토리 임시로 닫기 / Temporarily Close Directory
  - 닫은 디렉토리 다시 열기 / Reopen Closed Directory
- 빌드: TypeScript + esbuild (wide-search 확장과 같은 구성). 테스트: `node --test`.

## 5. 실패 시나리오

| 시나리오 | 대응 | 테스트 |
|---|---|---|
| 사용자가 files.exclude 에 넣어 둔 `**/target` 이 다시 열기로 지워짐 | 우리 키만 제거 | 단위 |
| java 폴더 설정에 우리 경로만 써서 `**/node_modules/**` 제외가 풀림 | 상속 배열 보존 | 단위 |
| 디렉토리 이름에 `[` 가 있어 다른 디렉토리까지 숨겨짐 | escape | 단위 |
| settings.json 직접 수정 후 재시작하면 다시 닫힘 | 맞춤 규칙 (D8) | 단위 |
| 설정 변경 이벤트로 맞춤이 무한 반복 | `isWriting` 플래그 | 단위 (가짜 vscode) |
| `.vscode/settings.json` 쓰기 실패 (권한 등) | 오류 메시지 표시, workspaceState 는 바꾸지 않음 | 단위 (가짜 vscode) |
| Java 언어 서버가 제외 변경을 바로 반영하지 않음 | 알림 버튼으로 다시 불러오기 실행 | **수동 확인 필요** |
| 검색 창에서 "제외 설정 사용"을 끄면 닫은 디렉토리가 다시 나옴 | VS Code 기본 동작으로 둠, README 에 안내 | 해당 없음 |

## 6. 테스트 계획

```
CODE PATHS                                         USER FLOWS
[+] stashCore.ts                                   [+] 닫기
  ├── toExcludePattern  [GAP] 일반/특수문자/중첩     ├── [GAP] 우클릭 → 탐색기·Ctrl+P·Ctrl+Shift+F 에서 빠짐 (수동)
  ├── toJavaPattern     [GAP] 절대경로 + /**        ├── [GAP] 다중 선택 닫기 → update 1회 (단위)
  ├── applyFilesExclude [GAP] 추가/제거/사용자 키 보존 └── [GAP] 루트 폴더 자신 선택 → 무시 (단위)
  ├── applyJavaExclusions [GAP] 상속값 보존/전부 열면 undefined
  └── reconcile         [GAP] 표 3.3 의 세 경우       [+] 다시 열기
[+] stashService.ts                                  ├── [GAP] QuickPick 다중 선택 → 복원 (수동)
  ├── close / reopen    [GAP] 쓰기 실패 시 롤백       ├── [GAP] 🗑 목록에서 제거 (단위)
  └── isWriting 가드    [GAP]                        └── [GAP] 닫은 목록 비어 있음 → 안내 메시지 (단위)
[+] extension.ts
  └── activate 스모크   [GAP] 명령 등록 확인          [+] Java
                                                     └── [GAP] Ctrl+T 결과에서 빠짐 (수동)
COVERAGE: 0/17 (신규 프로젝트) — 모두 구현과 함께 작성
```

### 수동 체크리스트 (khan-monitoring)

1. `/data/sources/khan-monitoring` 을 폴더로 연다.
2. `khan-monitoring-error-dispatch` 를 제외한 worktree 6개를 다중 선택해서 닫는다.
3. 탐색기, Ctrl+P(`ErrorDispatch`), Ctrl+Shift+F 에서 6개가 빠졌는지 확인한다.
4. `.vscode/settings.json` 에 기존 `tomcatAutoDeploy.*` 가 그대로 있고, 우리 항목만 추가되었는지 확인한다.
5. Java 다시 불러오기를 한 뒤, Ctrl+T 결과에 닫은 worktree 의 클래스가 없는지 확인한다.
6. VS Code 를 다시 시작한 뒤에도 닫힌 상태가 유지되는지 확인한다.
7. settings.json 에서 항목 하나를 직접 지우면, 다시 열기 목록에서도 빠지는지 확인한다.
8. 모두 다시 열면 `java.import.exclusions` 키가 settings.json 에서 사라지는지 확인한다.

## 7. 범위 밖 (NOT in scope)

- Wide Search(vscode-popup-search-extenstion)의 exclude 지원 (D5)
- 소스 제어(Git) 화면에서 worktree 숨기기 (`git.ignoredRepositories`)
- 상태 표시줄의 닫힌 개수 표시
- 마켓플레이스 배포 (`install.sh` 로 vsix 를 로컬에 설치)

## 8. 구현 작업

| ID | 우선순위 | 작업 | 파일 |
|---|---|---|---|
| T1 | P1 | 프로젝트 골격 (package.json, nls, esbuild, tsconfig, package.sh) | 루트 |
| T2 | P1 | 순수 함수 + 단위 테스트 | src/stashCore.ts, test/stashCore.test.ts |
| T3 | P1 | 설정 쓰기 / workspaceState 저장 | src/settingsWriter.ts, src/stashStore.ts |
| T4 | P1 | 닫기/열기/맞춤 서비스 + 가짜 vscode 테스트 | src/stashService.ts, test/stashService.test.ts |
| T5 | P2 | 명령, 메뉴, QuickPick, 메시지 | src/extension.ts, src/reopenQuickPick.ts, src/messages.ts |
| T6 | P2 | Java 다시 불러오기 알림 (닫기 `java.clean.workspace`, 열기 `java.project.import.command`) | src/extension.ts |
| T7 | P3 | README_ko.md, 수동 체크리스트 수행 | README_ko.md |

## 9. 구현 결과 (2026-10-14)

| 파일 | 역할 |
|---|---|
| src/stashCore.ts | 순수 함수 (패턴 생성·escape, 설정 병합, 상태 맞춤) |
| src/stashService.ts | 닫기/열기/맞춤/방식 변경, 작업 직렬화 큐, 쓰기 실패 시 exclude 롤백 |
| src/settingsWriter.ts | `inspect()`/`update()` 어댑터 |
| src/stashStore.ts | workspaceState 어댑터 (`folderStash.closed:<폴더 URI>`), 변경 시 onChange |
| src/closedView.ts | 탐색기 회색 표시(FileDecorationProvider), 컨텍스트 키 `folderStash.closedPaths` |
| src/folders.ts | 워크스페이스 폴더 → StashFolder 변환 |
| src/missing.ts | 닫은 경로 중 디스크에서 지워졌거나 파일로 바뀐 것 찾기 |
| src/reopenQuickPick.ts | 다시 열기 QuickPick (다중 선택, 📂 바로 다시 열기) |
| src/extension.ts | 명령·이벤트 등록, Java 다시 불러오기 알림 |
| test/*.test.ts | 단위 38개 (`npm test`) |
| package.sh | node_modules 없으면 `npm install` → 타입 체크·테스트 → vsix 생성 (실패 시 중단) |
| install.sh | `package.sh` 실행 후 `code --install-extension --force` (같은 버전 덮어쓰기) |

계획과 달라진 점
- Java 패턴: `<절대경로>/**` → `<절대경로>` (위 4장 참고)
- Java 설정 대상: WorkspaceFolder → Workspace (scope: window)
- Java 확장(redhat.java)이 없으면 java 설정을 쓰지 않는다
- VS Code glob 의 `[ ]` 는 `?` 로 바꾼다 (한 글자 와일드카드라 이름이 비슷한 디렉토리도 함께 숨겨질 수 있음)

## 10. 코드 리뷰 반영 · 0.9.0 (2026-10-15)

| 항목 | 수정 |
|---|---|
| 동시 실행 덮어쓰기 (높음) | `StashService` 의 모든 작업을 Promise 큐로 하나씩 실행. `writing` 카운터 제거 |
| Java 확장 꺼진 뒤 다시 열기 실패 (높음) | 설정이 등록 안 됐으면(기본값 없음) Java 건너뜀. 제거 방향에서 Java 쓰기 실패는 되돌리지 않고 경고만 |
| 📂 버튼 문구 (중간) | 🗑 "목록에서 제거" → 📂 "바로 다시 열기" (실제 동작과 일치) |
| 사용자가 고친 키 삭제 (중간) | `files.exclude` 는 값이 `true` 인 키만 지움. `false`·`when` 으로 바꾼 키는 유지 |
| 폴더 제거 시 Java 패턴 잔류 (중간) | `onDidChangeWorkspaceFolders` 의 removed 폴더는 Java 패턴만 지움 (`releaseJava`) |
| `..cache` 같은 이름 (중간) | 바깥 경로 판정을 `..` / `../` / 절대 경로로 한정 |
| 롤백 오류가 원래 오류를 가림 | 롤백 실패는 삼키고 원래 오류를 던짐 |
| 폴더 하나 실패 시 나머지 건너뜀 | `reconcileAll` 폴더별 처리 |
| `fs.existsSync` | `vscode.workspace.fs.stat` |
| `@types/vscode` | `~1.74.0` 고정 (engines 와 일치) |
| 기타 | `skipped` 중복 제거, `sameItems` 하나로 통합, 멀티 루트 건너뜀 알림에 폴더 이름 |

반영하지 않은 것
- `[ ]` escape 를 `[[]`/`[]]` 로 바꾸기: VS Code glob 과 검색(ripgrep) 양쪽 동작을 확인하지 못해 `?` 치환을 유지
- 사용자가 `java.import.exclusions` 에 직접 넣은 같은 절대 경로를 다시 열기 때 함께 지우는 문제: 드문 경우라 유지
- `vsce` 전역 설치 → `npx` 고정: 형제 프로젝트와 같은 방식 유지

## 11. 퍼블리시 준비 (2026-10-15)

- package.json: `version 0.9.0`, `license Apache-2.0`(LICENSE 파일), `icon images/icon.png`, `repository`/`homepage`/`bugs`, `keywords`
- 설명은 `package.nls*.json` 의 `extension.description`
- 아이콘: 형제 확장과 같이 왼쪽 위 굵은 "D" + 회색 그림, 배경 투명. 원본 `images/src/icon.svg`
  - `rsvg-convert -w 256 -h 256 images/src/icon.svg -o images/icon.png`
- README 이미지: `images/src/mock.html` 을 Chrome headless 로 찍은 PNG (`?lang=en|ko&scene=close|reopen|flow`)
  - vsix 에서는 빼고, vsce 가 GitHub raw 주소로 바꾼다 → **GitHub push 후 퍼블리시**
- 퍼블리시: `./package.sh` → `vsce publish --packagePath folder-stash-0.9.0.vsix` (publisher `ddakker` PAT 필요)

## 12. 회색 표시(dim) 방식 (2026-10-19)

요구: 이클립스 프로젝트 닫기처럼 탐색기에는 흐리게 남기고, 파일 검색·내용 검색에서는 빠져야 한다.

| 항목 | 내용 |
|---|---|
| 설정 | `folderStash.closeStyle`: `dim`(기본) / `hide` |
| dim | `search.exclude`(폴더) 에 쓴다. 탐색기는 그대로, 파일에서 찾기·빠른 열기에서 제외 |
| hide | 기존과 같이 `files.exclude` |
| 회색 표시 | `FileDecorationProvider` (`src/closedView.ts`). 색 `disabledForeground`, 닫은 디렉토리에 배지 `닫`/`C` + 툴팁, 하위는 색만 |
| 우클릭 다시 열기 | `folderStash.reopenSelected`. 조건 `resourcePath in folderStash.closedPaths` (setContext 로 닫은 절대 경로 배열) |
| 방식 변경 | 설정이 바뀌거나 시작할 때 맞춤(reconcile) 후 닫아 둔 항목을 다른 exclude 설정으로 옮김 (`changeStyle`) |
| 옮기는 규칙 | 새 위치에 먼저 쓰고 이전 위치에서 제거. 새 위치에 사용자 키(`true`/`false`/`when`)가 있으면 덮어쓰지 않고 그 항목은 옮기지 않음. 방식 값은 큐에서 실행될 때 읽음 |
| 다시 열기·맞춤 | 두 exclude 설정 모두에서 값이 `true` 인 우리 키만 제거. 어느 쪽에도 `true` 가 없으면 직접 연 것으로 봄 |

확인한 근거 (설치된 VS Code 1.141 번들)
- `search.exclude` 설명: "excluding files and folders in fulltext searches and file search in quick open"
- `search.exclude` 의 scope 는 5 = RESOURCE (`files.encoding` 이 6 = LANGUAGE_OVERRIDABLE 인 것과 비교) → 폴더 설정에 쓸 수 있음

한계
- 회색 디렉토리도 펼칠 수 있음 (펼치기를 막는 API 없음)
- 빠른 열기의 최근에 연 파일 목록은 상대 경로 패턴으로는 걸러지지 않음
- 회색 디렉토리에도 "디렉토리 임시로 닫기" 메뉴가 보임 (`not in` 조건이 engines 1.74 에서 지원되는지 확인하지 못해 쓰지 않음). 누르면 "이미 닫힘" 안내
- 다시 열기는 두 exclude 설정에서 모두 `true` 키를 지운다. 닫은 뒤 사용자가 다른 쪽 설정에 같은 키를 직접 넣었다면 함께 지워짐 (드문 경우라 문서로만 안내)
- 닫을 때 두 exclude 설정 중 하나에 사용자 키가 이미 있으면 건너뜀 (다시 열기 때 사용자 키를 지우지 않기 위한 의도된 동작)
- 회색 색상은 편집기 탭 등 같은 파일이 보이는 다른 곳에도 적용될 수 있음
- 원격(Remote-SSH 등)에서는 `resourcePath` 형식이 달라 회색 디렉토리 우클릭 메뉴가 안 보일 수 있음 (확인 못 함). 이 경우 "닫은 디렉토리 다시 열기" 목록 사용
- 0.9.0 에서 `files.exclude` 로 닫아 둔 항목은 업데이트 후 시작 시 `search.exclude` 로 옮겨져 회색으로 보임

코드 리뷰 반영 (2026-10-19)
- 방식 변경 시 옮겨 갈 설정의 사용자 키 보존, 방식 값을 실행 시점에 읽음, 방식 변경 시에도 맞춤 먼저 실행
- 안내 문구(`alreadyClosed`, 툴팁, 확장 설명)를 dim 기준으로 수정, 버전 0.10.0
- 테스트 추가: hide→dim 업그레이드, 사용자 키 보존, 실행 시점 방식, 두 설정 동시 제거, ClosedView 표시·컨텍스트 키, store onChange

수동 체크리스트 (dim)
1. 창 다시 로드 → 이전에 숨겼던 디렉토리가 회색 + `닫` 으로 보이는지
2. `.vscode/settings.json` 에 `search.exclude` 로 옮겨졌고 `files.exclude` 의 기존 항목은 그대로인지
3. 열린 디렉토리 우클릭 → 디렉토리 임시로 닫기 → 회색으로 바뀌는지
4. Ctrl+Shift+F 로 회색 디렉토리에만 있는 문자열 검색 → 결과 없음
5. Ctrl+P 로 회색 디렉토리에만 있는 파일 이름 검색 → 결과 없음
6. Ctrl+T 로 회색 디렉토리에만 있는 클래스 검색 → 결과 없음 (Java 다시 불러오기 후)
7. 회색 디렉토리 우클릭 → 디렉토리 다시 열기 → 색이 돌아오고 4~5 에서 다시 검색됨
8. 설정 `folderStash.closeStyle` 을 `hide` 로 → 닫은 디렉토리가 탐색기에서 사라짐, 다시 `dim` 으로 → 회색으로 돌아옴

## 13. 지워진 디렉토리 정리 · 0.11.0 (2026-10-19)

worktree 를 지우면 닫은 기록(exclude 항목, java 절대 경로, 목록)이 남는다.
같은 이름으로 다시 만들면 새 worktree 가 처음부터 검색에서 빠지는 문제가 있어 자동 정리한다.

- 정리 시점: VS Code 열 때(`syncAll` 맨 앞), 닫기·다시 열기 명령 실행 직전 (`withPrune` → `pruneAll`)
- 파일 감시는 쓰지 않는다 (단순하게 유지)
- `findMissing` (`src/missing.ts`): 큐 밖에서 `stat` 을 병렬로 실행한다 (느린 원격에서도 다른 작업이 기다리지 않도록)
  - `FileSystemError` `FileNotFound` 이거나 디렉토리가 아니면(파일로 바뀜, 끊어진 링크) 지워진 것으로 본다
  - 원격 연결 전 등 다른 오류는 건너뛴다
- 정리는 `StashService.reopen` 그대로 쓴다. 확인과 정리 사이에 목록이 바뀌어도 아직 목록에 있는 항목만 처리된다
- 알림: "디스크에서 지워진 닫은 디렉토리를 정리했습니다: wt1, wt2"
- Java 다시 불러오기는 명령마다 한 번만 제안한다
  - 닫기에서 Java 가 바뀌면 `java.clean.workspace` 하나로 (정리 결과까지 포함)
  - 정리만 바뀌었으면 `java.project.import.command`
  - 멀티 루트에서도 폴더별로 따로 묻지 않는다
- 다시 열기 목록의 `(없음)` 표시는 없앴다 (열기 직전에 정리되므로)
- 제약: 다른 브랜치로 바꿔 디렉토리가 잠깐 없는 상태에서 닫기/열기를 하면 그 디렉토리도 정리된다.
  돌아온 뒤 다시 닫으면 된다 (README 안내)

리뷰 반영 (같은 날): 확인을 큐 밖 병렬로, `StashService.prune` 대신 `reopen` 재사용, Java 알림 한 번으로,
파일로 바뀐 경로도 정리, 알림에 경로 이름 표시, `findMissing` 테스트 추가.

수동 확인
1. 디렉토리를 닫고 디스크에서 지운 뒤 다른 디렉토리를 닫기 → 정리 알림, settings.json 에서 항목 제거
2. 지운 상태로 창 다시 로드 → 정리 알림
3. 같은 이름으로 다시 만들면 회색이 아니고 검색에 나옴
4. (가능하면) Remote-SSH/WSL 에서 1번 반복

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** ENG CLEARED — 구현 완료. 수동 체크리스트(6장)는 사용자 확인 필요.

NO UNRESOLVED DECISIONS
