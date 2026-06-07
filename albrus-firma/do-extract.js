const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const electronDir = path.resolve('./node_modules/electron');
const pkg = require(path.join(electronDir, 'package.json'));
const version = pkg.version;

// Find the zip in cache
const cacheDir = 'C:\\Users\\user\\AppData\\Local\\electron\\Cache';
let zipPath = null;

const cacheDirs = fs.readdirSync(cacheDir);
for (const d of cacheDirs) {
  const candidate = path.join(cacheDir, d, `electron-v${version}-win32-x64.zip`);
  if (fs.existsSync(candidate)) {
    zipPath = candidate;
    break;
  }
}

if (!zipPath) {
  console.error('Zip not found in cache!');
  process.exit(1);
}

const distPath = path.join(electronDir, 'dist');
console.log('Extracting v' + version + ' from:', zipPath);
console.log('To:', distPath);

execSync(`powershell -Command "Expand-Archive -Force '${zipPath}' '${distPath}'"`, { stdio: 'inherit' });
fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');

const files = fs.readdirSync(distPath);
console.log('Done! Files:', files.length, '| electron.exe:', files.includes('electron.exe'));
