import { _electron as electron } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronExe = path.join(__dirname, 'node_modules/electron/dist/electron.exe');

const app = await electron.launch({
  executablePath: electronExe,
  args: [__dirname],
  env: { ...process.env }
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 3000));

await page.screenshot({ path: path.join(__dirname, 'screenshot.png') });
console.log('screenshot kaydedildi: screenshot.png');
await app.close();
