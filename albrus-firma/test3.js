// Check if Electron registered its built-ins
const Module = require('module');
console.log('builtins has electron:', Module.builtinModules.includes('electron'));
console.log('builtins slice:', Module.builtinModules.filter(m => m.startsWith('electron')));

// Check process properties
console.log('process.type:', process.type);
console.log('process._linkedBinding:', typeof process._linkedBinding);

// Try to access Electron binding directly
try {
  const b = process._linkedBinding('electron_browser_app');
  console.log('app binding:', typeof b, Object.keys(b||{}).slice(0,5));
} catch(e) {
  console.log('app binding error:', e.message.substring(0,80));
}
