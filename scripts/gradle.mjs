// Run the Android project's Gradle wrapper from npm on any OS:
//   node scripts/gradle.mjs assembleDebug
// (npm runs scripts through cmd.exe on Windows, which needs gradlew.bat.)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../android', import.meta.url));
const windows = process.platform === 'win32';
// An absolute path: cmd.exe may be set not to search the current directory.
const wrapper = join(cwd, windows ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(windows ? `"${wrapper}"` : wrapper, process.argv.slice(2), {
  cwd,
  stdio: 'inherit',
  shell: windows,
});
process.exit(result.status ?? 1);
