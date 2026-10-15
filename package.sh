#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "=== 의존성 설치 ==="
  npm install
fi

if ! command -v vsce &> /dev/null; then
  echo "vsce가 설치되어 있지 않습니다. 설치합니다..."
  npm install -g @vscode/vsce
fi

# ─── 패키징 전 타입 체크·테스트 ───
echo "=== 타입 체크 · 테스트 실행 ==="
if ! npm run typecheck || ! npm test; then
  echo ""
  echo "❌ 타입 체크 또는 테스트 실패 — 패키징을 중단합니다."
  exit 1
fi
echo ""

# vscode:prepublish 에서 esbuild 릴리즈 빌드가 실행된다.
vsce package --no-dependencies

VSIX=$(ls -t *.vsix | head -1)
echo ""
echo "패키징 완료: $VSIX"
