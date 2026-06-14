const { _electron: electron } = require('playwright-core');
const path = require('path');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  const app = await electron.launch({ executablePath: path.resolve('./node_modules/electron/dist/electron.exe'), args: ['.'], env });
  const win = await app.firstWindow();
  win.on('dialog', d => d.accept().catch(()=>{}));
  await win.waitForTimeout(1800);
  await win.evaluate(async () => {
    await window.electronAPI.invoke('hakedis:boq:import',{proje_id:1,temizle:true,satirlar:[
      {grup:'AYDINLATMA',poz_no:'37196',tanim:'LED Panel Light uzun açıklama metni burada',birim:'No',kesif_miktar:3200,bf_iscilik:6000,bf_malzeme:0}]});
    document.getElementById('hk-proje').value='1'; await loadHakedisProje();
    const h=await window.electronAPI.invoke('hakedis:ekle',{proje_id:1,tarih:'2026-06-15'});
    await loadHakedisProje(); await openYesil(h.id);
  });
  await win.waitForTimeout(500);
  const dim = await win.evaluate(() => {
    const inp=document.getElementById('yd-0'); const td=inp.closest('td');
    const ir=inp.getBoundingClientRect(), tr=td.getBoundingClientRect();
    return { inputW:Math.round(ir.width), cellW:Math.round(tr.width), doluMu: Math.abs(ir.width-tr.width)<3 };
  });
  console.log('kutu hücreyi dolduruyor mu:', JSON.stringify(dim));
  // hücrenin SOL kenarına tıkla (eskiden boş alandı) -> input odaklanmalı
  const td = await win.evaluate(() => { const t=document.getElementById('yd-0').closest('td').getBoundingClientRect(); return {x:Math.round(t.left+5), y:Math.round(t.top+t.height/2)}; });
  await win.mouse.click(td.x, td.y);
  await win.keyboard.type('77');
  const r = await win.evaluate(() => ({ val:document.getElementById('yd-0').value, focused:document.activeElement?.id }));
  console.log('hücre sol kenarına tıkla+yaz:', JSON.stringify(r), '(beklenen val=77, focused=yd-0)');
  await win.evaluate(async () => { const l=await window.electronAPI.invoke('hakedisler:getir',1); for(const x of l) await window.electronAPI.invoke('hakedis:sil',x.id); await window.electronAPI.invoke('hakedis:poz:tumunu:sil',1); });
  await app.close();
})().catch(e => { console.error('DIŞ:', e.message.split('\n')[0]); process.exit(0); });
