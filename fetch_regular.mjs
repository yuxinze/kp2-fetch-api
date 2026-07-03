/**
 * fetch_regular.mjs — Child process script for fetching regular URLs (ESM)
 * Usage: node fetch_regular.mjs <url>
 * Output: JSON { title, text, images, url } to stdout
 */

import puppeteer from 'puppeteer';

const targetUrl = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  const page = await browser.newPage();
  // Use mobile UA for better compatibility with Chinese news sites
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

  // Block images & fonts to speed up page load
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Strategy: try domcontentloaded first (fast), fall back to networkidle2
  let loaded = false;
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    loaded = true;
    // Wait a bit for dynamic content to render
    await page.waitForTimeout(3000);
  } catch (e1) {
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 25000 });
      loaded = true;
    } catch (e2) {
      // Even if goto timed out, the page might still be partially loaded
      loaded = false;
    }
  }

  if (!loaded) {
    // Try to get whatever content is available
    try {
      await page.waitForSelector('body', { timeout: 5000 });
    } catch (_) {
      await browser.close();
      process.stdout.write(JSON.stringify({ title: '', text: '', images: [], url: targetUrl }));
      return;
    }
  }

  // Remove noise
  await page.evaluate(() => {
    document.querySelectorAll('script, style, nav, footer, header, .ad, .sidebar, .comment, .related, .share, .copyright, .banner, .popup, .modal')
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
      document.querySelector('.news-content') ||
      document.querySelector('.detail-content') ||
      document.querySelector('.content') ||
      document.querySelector('main') ||
      document.body;
    return (contentEl?.innerText || '').trim();
  });

  // Don't fetch images since we blocked them — use data-src attributes instead
  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .map(img => img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.src || '')
      .filter(src => src.startsWith('http') && src.length > 50)
      .filter(src => !src.includes('emoji') && !src.includes('icon') && !src.includes('logo')
                  && !src.includes('qrcode') && !src.includes('avatar') && !src.includes('banner'))
      .slice(0, 20)
  );

  await browser.close();

  const result = { title, text: text.substring(0, 8000), images, url: targetUrl };
  process.stdout.write(JSON.stringify(result));
})();
