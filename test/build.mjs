// test/*.test.ts 를 out-test/ 로 번들한다. vscode 모듈은 가짜 구현으로 대체한다.
import * as esbuild from 'esbuild';
import { readdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const testDir = fileURLToPath(new URL('.', import.meta.url));
rmSync(new URL('../out-test', import.meta.url), { recursive: true, force: true });

await esbuild.build({
  entryPoints: readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).map((f) => testDir + f),
  bundle: true,
  outdir: 'out-test',
  format: 'cjs',
  platform: 'node',
  alias: { vscode: testDir + 'fakeVscode.ts' },
});
