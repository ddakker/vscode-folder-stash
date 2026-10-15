#!/bin/bash
# 빌드 실패(테스트 실패 포함) 시 이전 vsix 를 설치해버리지 않도록 즉시 중단한다.
set -e

cd "$(dirname "$0")"

./package.sh

latest=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -z "$latest" ]; then
  echo "vsix 파일이 없습니다."
  exit 1
fi
echo "설치: $latest"
# --force: 버전이 그대로면 "이미 설치됨" 으로 건너뛰므로, 같은 버전의 새 빌드를 덮어쓰려면 필요하다.
code --install-extension "$latest" --force
echo "설치완료: $latest"
echo ""
# 같은 버전을 덮어쓰면 VS Code 가 "다시 로드" 안내를 띄우지 않는다.
echo "=== 적용하려면 창을 다시 로드하세요 ==="
echo "Ctrl+Shift+P → 개발자: 창 다시 로드 (Developer: Reload Window)"
echo "창마다 따로 해야 그 창의 확장이 갱신됩니다."
