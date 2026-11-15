import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ABI_TO_TARGET = {
  'arm64-v8a': 'aarch64',
  'armeabi-v7a': 'armv7',
  x86: 'i686',
  x86_64: 'x86_64',
};

const APK = 'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();

const abi = adb('shell', 'getprop', 'ro.product.cpu.abi');
const target = ABI_TO_TARGET[abi];
if (!target) {
  console.error(`unsupported device ABI: ${abi || '(none)'}`);
  process.exit(1);
}

const apk = resolve(APK);
rmSync(apk, { force: true });

const tauri = process.platform === 'win32' ? 'npx.cmd' : 'npx';
run(tauri, ['tauri', 'android', 'build', '--debug', '--apk', '-t', target]);

if (!existsSync(apk)) {
  console.error(`apk not found: ${apk}`);
  process.exit(1);
}

run('adb', ['install', '-r', apk]);
run('adb', ['shell', 'am', 'start', '-n', 'com.syome.ukitouch/.MainActivity']);
