/**
 * fetch_regular.mjs — Child process script for fetching regular URLs (ESM)
 * Usage: node fetch_regular.mjs <url>
 * Output: JSON { title, text, images, url } to stdout
 *
 * Optimized for slow/JS-heavy sites like focus.cn:
 * - Block all unnecessary resources (images, fonts, CSS, media)
 * - Use domcontentloaded first (fast), then networkidle2 fallback
 * - Aggressive timeout handling: grab whatever's loaded even if timeout
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
      '--single-process',        // reduce memory on constrained servers
      '--disable-web-security',  // allow cross-origin content
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

  // Block ALL unnecessary resources to speed up page load dramatically
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet', 'websocket', 'manifest', 'texttrack', 'eventsource'].includes(type)) {
      req.abort();
    } else if (req.url().includes('/analytics') || req.url().includes('/track') || req.url().includes('/ad') || req.url().includes('/pixel')) {
      req.abort(); // block tracking/ad requests
    } else {
      req.continue();
    }
  });

  // Try loading page — be very aggressive about timeouts
  let pageContent = null;
  try {
    // Fast attempt: domcontentloaded (just wait for HTML, not all JS)
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Give JS a brief moment to render content
    await new Promise(r => setTimeout(r, 2000));

    // Check if we already have enough content
    pageContent = await page.evaluate(() => {
      const el = document.querySelector('article') ||
                 document.querySelector('.article-content') ||
                 document.querySelector('.news-content') ||
                 document.querySelector('.detail-content') ||
                 document.querySelector('.content') ||
                 document.querySelector('#js_content') ||
                 document.querySelector('main');
      return el ? el.innerText.trim().length : 0;
    });

    if (pageContent < 50) {
      // Content not rendered yet, wait for networkidle2
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (gotoErr) {
    // Even if goto timed out, try to grab whatever's on the page
    console.error('goto timeout, grabbing partial content');
    try {
      await page.waitForSelector('body', { timeout: 3000 });
    } catch (_) {
      await browser.close();
      process.stdout.write(JSON.stringify({ title: '', text: '', images: [], url: targetUrl }));
      return;
    }
  }

  // Remove noise elements
  await page.evaluate(() => {
    const noise = 'script, style, nav, footer, header, .ad, .sidebar, .comment, .related, .share, .copyright, .banner, .popup, .modal, .recommend, .hot-list, .nav-bar, .breadcrumb';
    document.querySelectorAll(noise).forEach(el => el.remove());
  });

  const title = await page.title();

  const text = await page.evaluate(() => {
    const selectors = [
      'article',
      '.article-content', '.post-content', '.news-content',
      '.detail-content', '.content-body', '#article-content',
      '#js_content', '.detail_box', '.content',
      'main', '.main-content',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 50) return el.innerText.trim();
    }
    return document.body?.innerText?.trim() || '';
  });

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
