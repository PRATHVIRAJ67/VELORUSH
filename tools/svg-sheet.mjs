// Dev tool: render SVG track previews side by side. Usage: node tools/svg-sheet.mjs <dir> <out.png> a.svg b.svg ...
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, out, ...files] = process.argv.slice(2);
const html = `<html><body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(3,420px);gap:6px">${files
  .map((f) => `<div style="position:relative"><img style="width:420px;height:380px;object-fit:contain" src="data:image/svg+xml;base64,${readFileSync(join(dir, f)).toString('base64')}"><b style="position:absolute;left:4px;top:2px;font:16px sans-serif">${f}</b></div>`)
  .join('')}</body></html>`;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1272, height: Math.ceil(files.length / 3) * 386 });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
