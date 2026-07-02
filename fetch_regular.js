/**
 * fetch_regular.js — Child process script for fetching regular URLs
 * Usage: node fetch_regular.js <url>
 * Output: JSON { title, text, images, url } to stdout
 */

const puppeteer = require('puppeteer');

const targetUrl = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });

  // Remove noise
  await page.evaluate(() => {
    document.querySelectorAll('script, style, nav, footer, header, .ad, .sidebar, .comment, .related, .share, .copyright')
      .forEach(el => el.remove());
  });

  const title = await page.title();

  const text = await page.evaluate(() => {
    const contentEl =
      document.querySelector('article') ||
      document.querySelector('.article-content') ||
      document.querySelector('.post-content') ||
      document.querySelector('#article-content') ||
      document.querySelector('#js_content') ||
      document.querySelector('main') ||
      document.body;
    return (contentEl?.innerText || '').trim();
  });

  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .map(img => img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '')
      .filter(src => src.startsWith('http') && src.length > 50)
      .filter(src => !src.includes('emoji') && !src.includes('icon') && !src.includes('logo')
                  && !src.includes('qrcode') && !src.includes('avatar'))
      .slice(0, 20)
  );

  await browser.close();

  const result = { title, text: text.substring(0, 8000), images, url: targetUrl };
  process.stdout.write(JSON.stringify(result));
})();
