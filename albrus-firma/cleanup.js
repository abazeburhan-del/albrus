const { execSync } = require('child_process');
const dir = 'C:\\Users\\user\\Desktop\\ALBRUS\\albrus-firma\\node_modules\\electron';
try {
  execSync('rmdir /s /q "' + dir + '"', { shell: 'cmd.exe', stdio: 'inherit' });
  console.log('Silindi');
} catch(e) {
  console.error('Hata:', e.message);
}
