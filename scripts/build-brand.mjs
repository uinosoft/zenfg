import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Maintain geometry only in assets/brand/zenfg-mark.svg. Outputs are committed.
const root = resolve(import.meta.dirname, '..');
const brand = resolve(root, 'assets/brand');
const publicDir = resolve(root, 'apps/site/public');
const blue = '#7aa2f7';
const navy = '#24283b';
const source = await readFile(resolve(brand, 'zenfg-mark.svg'), 'utf8');
const body = source.replace(/^[\s\S]*?<title>ZenFG<\/title>/, '').replace(/<\/svg>\s*$/, '').trim();
const recolor = color => body.replaceAll(blue, color);
const svg = (width, height, content, color = blue) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" fill="' + color + '"><title>ZenFG</title>' + content.replace(/[ \t]+$/gm, '') + '</svg>\n';
const mark = color => svg(128, 128, recolor(color), color);
const tile = svg(160, 160, '<rect width="160" height="160" rx="32" fill="' + navy + '"/><g transform="translate(16 16)">' + body + '</g>');
const touch = svg(160, 160, '<rect width="160" height="160" fill="' + navy + '"/><g transform="translate(16 16)">' + body + '</g>');
// Optical small-size variant: omit partial side strokes; retain all five nodes.
const smallBody = body.replace(/<path d="M14 36H26V78L14 90ZM102 50L114 38V92H102Z"\/>/, '');
const favicon = svg(128, 128, '<rect width="128" height="128" rx="24" fill="' + navy + '"/><g transform="translate(4 4) scale(.9375)">' + smallBody + '</g>');
const wordmark = (textColor, accent) => svg(490, 128, '<g fill="' + accent + '">' + recolor(accent) + '</g><text x="152" y="99" fill="' + textColor + '" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700" letter-spacing="-4">Zen<tspan fill="' + accent + '">FG</tspan></text>');
const files = {
    'zenfg-mark-dark.svg': mark(navy),
    'zenfg-mark-white.svg': mark('#ffffff'),
    'zenfg-icon.svg': tile,
    'zenfg-lockup-light.svg': wordmark(navy, '#416bc4'),
    'zenfg-lockup-dark.svg': wordmark('#c0caf5', blue),
};
await mkdir(resolve(publicDir, 'brand'), { recursive: true });
await mkdir(resolve(brand, 'exports'), { recursive: true });
for (const [name, content] of Object.entries(files)) await writeFile(resolve(brand, name), content);
await writeFile(resolve(publicDir, 'brand/zenfg-mark.svg'), source);
await writeFile(resolve(publicDir, 'favicon.svg'), favicon);
await writeFile(resolve(publicDir, 'brand/zenfg-icon.svg'), tile);
await writeFile(resolve(publicDir, 'site.webmanifest'), JSON.stringify({ name: 'ZenFG', short_name: 'ZenFG', icons: [192, 512].map(size => ({ src: 'icon-' + size + '.png', sizes: size + 'x' + size, type: 'image/png', purpose: 'any' })), theme_color: navy, background_color: navy, display: 'browser' }, null, 2) + '\n');

const browser = await chromium.launch({ headless: true, channel: process.env.BRAND_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) });
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    async function raster(content, width, height) {
        await page.setViewportSize({ width, height });
        await page.setContent('<html><head><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>' + content + '</body></html>');
        await page.evaluate(() => document.fonts.ready);
        return page.screenshot({ omitBackground: true });
    }
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
        await writeFile(resolve(brand, 'exports/zenfg-icon-' + size + '.png'), await raster(size <= 32 ? favicon : tile, size, size));
    }
    await writeFile(resolve(brand, 'exports/zenfg-mark-512.png'), await raster(source, 512, 512));
    for (const mode of ['light', 'dark']) {
        await writeFile(resolve(brand, 'exports/zenfg-lockup-' + mode + '.png'), await raster(files['zenfg-lockup-' + mode + '.svg'], 980, 256));
    }
    await writeFile(resolve(publicDir, 'apple-touch-icon.png'), await raster(touch, 180, 180));
    for (const size of [192, 512]) await writeFile(resolve(publicDir, 'icon-' + size + '.png'), await raster(tile, size, size));
    await writeFile(resolve(publicDir, 'favicon-32.png'), await raster(favicon, 32, 32));
    // ICO directory with PNG frames, supported by modern browsers and Windows.
    const sizes = [16, 32, 48];
    const frames = [];
    for (const size of sizes) frames.push(await raster(favicon, size, size));
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
        const at = 6 + i * 16;
        header[at] = size; header[at + 1] = size;
        header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
        header.writeUInt32LE(frames[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
        offset += frames[i].length;
    });
    await writeFile(resolve(publicDir, 'favicon.ico'), Buffer.concat([header, ...frames]));
    const display = (content, width) => '<div style="width:' + width + 'px;max-width:100%">' + content + '</div>';
    const preview = '<!doctype html><html lang="en"><meta charset="utf-8"><title>ZenFG brand proof</title><style>body{margin:0;padding:48px;font:16px Arial,sans-serif;color:' + navy + ';background:#f5f6fa}h1{margin:0 0 12px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px}section{background:white;padding:32px;border-radius:16px;min-width:0}svg{width:100%;display:block}.dark{background:' + navy + ';color:white}.sizes{display:flex;align-items:end;gap:24px}.sizes div{text-align:center}small{display:block;margin-top:12px}.sizes img{display:block;margin:auto}</style><h1>ZenFG / Connected Z</h1><p>Five nodes · one shared vector master</p><main><section class="dark">' + display(source, 240) + '</section><section>' + display(files['zenfg-lockup-light.svg'], 490) + '</section><section>' + display(files['zenfg-mark-dark.svg'], 128) + '</section><section class="dark">' + display(files['zenfg-lockup-dark.svg'], 490) + '</section><section><div class="sizes">' + [16,24,32,48,64,128].map(size => '<div><img src="exports/zenfg-icon-' + size + '.png" width="' + size + '" height="' + size + '" alt="ZenFG ' + size + 'px"><small>' + size + 'px</small></div>').join('') + '</div><p>16–32px: simplified side frame, all five nodes retained.</p></section><section>' + display(tile, 160) + '</section></main></html>';
    await writeFile(resolve(brand, 'preview.html'), preview);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(pathToFileURL(resolve(brand, 'preview.html')).href);
    await page.screenshot({ path: resolve(brand, 'preview.png'), fullPage: true });
} finally {
    await browser.close();
}
const docsPublic = resolve(root, 'apps/docs/public');
await mkdir(resolve(docsPublic, 'brand'), { recursive: true });
for (const name of ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest', 'brand/zenfg-mark.svg', 'brand/zenfg-icon.svg']) {
    await writeFile(resolve(docsPublic, name), await readFile(resolve(publicDir, name)));
}
console.log('Generated ZenFG brand SVGs, PNGs, ICO and preview from the vector master.');
