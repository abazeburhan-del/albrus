const fs = require('fs');
const path = require('path');

const indexPath = path.resolve('./node_modules/electron/index.js');
const backupPath = path.resolve('./node_modules/electron/index.js.bak');

// Backup original
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(indexPath, backupPath);
  console.log('Backed up index.js');
}

// Replace with empty file — lets Electron's built-in resolver handle it
fs.writeFileSync(indexPath, '// placeholder - electron API is provided by Electron runtime\nmodule.exports = {};\n');
console.log('Fixed index.js');
