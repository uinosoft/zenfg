import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const brand = resolve(root, 'assets/brand');
const mark = await readFile(resolve(brand, 'zenfg-mark.svg'), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  await mkdir(resolve(root, 'apps/site/public/brand'), { recursive: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [width, height, file] of [[1200, 630, 'zenfg-social'], [1280, 640, 'zenfg-github']]) {
    const markup = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ZenFG social preview</title><style>*{box-sizing:border-box}body{margin:0;background:#24283b;color:#c0caf5;font-family:Arial,Helvetica,sans-serif;width:' + width + 'px;height:' + height + 'px;padding:58px 64px;position:relative;overflow:hidden}.brand{display:flex;align-items:center;gap:20px;font-size:64px;font-weight:700;letter-spacing:-3px}.brand svg{width:82px;height:82px}.brand em{color:#7aa2f7;font-style:normal}h1{font-size:39px;line-height:1.25;font-weight:600;margin:32px 0 12px;letter-spacing:-1px}p{font-size:20px;color:#a9b1d6;margin:0}.flow{display:flex;align-items:center;gap:15px;margin-top:46px}.node{border:1px solid #7aa2f7;border-radius:8px;padding:20px 23px;font-size:18px;background:#292e42}.external{border-style:dashed}.arrow{color:#a9b1d6}.foot{position:absolute;bottom:40px;left:64px;right:64px;display:flex;justify-content:space-between;color:#a9b1d6;font-size:16px}</style></head><body><div class="brand">' + mark + '<span>Zen<em>FG</em></span></div><h1>A composable FrameGraph<br>for WebGPU and wgpu.</h1><p>Build rendering features. Compose GPU systems. Understand every frame.</p><div class="flow"><div class="node">Compute</div><span class="arrow">→</span><div class="node external">External renderer</div><span class="arrow">→</span><div class="node">Render / composite</div><span class="arrow">→</span><div class="node">Output</div></div><div class="foot"><span>TypeScript / Rust · Snapshot / Inspector</span><span>github.com/uinosoft/zenfg</span></div></body></html>';
    await writeFile(resolve(brand, file + '.html'), markup + '\n');
    await page.setViewportSize({ width, height });
    await page.setContent(markup);
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.screenshot();
    await writeFile(resolve(brand, 'exports', file + '.png'), bytes);
    if (file === 'zenfg-social') await writeFile(resolve(root, 'apps/site/public/brand/zenfg-social.png'), bytes);
    if ((await stat(resolve(brand, 'exports', file + '.png'))).size >= 1000000) throw new Error('Social card exceeds 1 MB');
    console.log(file + ': ' + width + '×' + height + ', ' + bytes.length + ' bytes');
  }
} finally { await browser.close(); }
