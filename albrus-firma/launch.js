// VS Code sets ELECTRON_RUN_AS_NODE=1 which prevents Electron from starting as a GUI app.
// This launcher clears that variable before spawning Electron.
const { spawn } = require('child_process');
const path = require('path');

const electronExe = path.resolve('./node_modules/electron/dist/electron.exe');
const appPath = path.resolve('.');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

console.log('Starting Albrus Firma...');

const child = spawn(electronExe, [appPath], {
  env,
  detached: true,
  stdio: 'ignore'
});

child.on('error', e => console.error('Hata:', e.message));
child.unref();
console.log('Uygulama açıldı (PID:', child.pid + ')');
