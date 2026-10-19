// Prints docs/manual/user-manual.html (with its screenshots) to docs/Reconnect-user-manual.pdf.
//   npm run manual:screenshots   (optional: refresh the screenshots first)
//   npm run manual:build
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const source = path.resolve('docs/manual/user-manual.html');
const output = path.resolve('docs/Reconnect-user-manual.pdf');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  const missing = await page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute('src')));
  if (missing.length) throw new Error(`missing images: ${missing.join(', ')}`);
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="font-size:8px;width:100%;text-align:center;color:#666;font-family:Segoe UI,Arial,sans-serif;">Reconnect user manual · demo with fictional data · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });
  console.log(`manual written: ${path.relative(process.cwd(), output)}`);
} finally {
  await browser.close();
}
