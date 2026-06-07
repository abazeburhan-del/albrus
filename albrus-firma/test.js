console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
const e = require('electron');
console.log('electron typeof:', typeof e);
if (typeof e === 'object' && e.app) {
  console.log('has app:', true);
  e.app.whenReady().then(() => { console.log('ready'); e.app.quit(); });
} else if (typeof e === 'string') {
  console.log('electron path returned (npm package shadowing!):', e.substring(0, 80));
}
