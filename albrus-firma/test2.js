console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);

// Try different require paths
const tries = ['electron', 'electron/main', 'electron/renderer'];
for (const t of tries) {
  try {
    const m = require(t);
    console.log(t + ' typeof:', typeof m, '| has app:', !!(m && m.app));
  } catch(e) {
    console.log(t + ' ERR:', e.message.substring(0, 60));
  }
}
