// Dev tool: tile screenshots into one contact sheet. Usage: node tools/sheet.mjs <dir> <out.png> a.png b.png ...
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out, ...files] = process.argv.slice(2);
const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}"><figcaption>${f}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(2,640px);gap:4px">
<style>figure{margin:0;position:relative}img{width:640px;height:360px;display:block}figcaption{position:absolute;left:4px;bottom:4px;color:#ff0;font:14px monospace;background:#000a;padding:2px 4px}</style>${imgs}</body></html>`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1284, height: Math.ceil(files.length / 2) * 364 });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
