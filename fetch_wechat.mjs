/**
 * fetch_wechat.mjs — Child process script for fetching WeChat articles via 搜狗微信搜索 (ESM)
 * Strategy: ALWAYS use 搜狗微信搜索 intermediary (direct WeChat access is unreliable)
 * Usage: node fetch_wechat.mjs <url> [keyword]
 * Output: JSON { title, text, images, url, note? } to stdout
 */

import puppeteer from 'puppeteer';

const targetUrl = process.argv[2];
const keyword = process.argv[3] || '';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

  try {
    let searchKeyword = keyword;
    if (!searchKeyword) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await new Promise(r => setTimeout(r, 1500));
        const pageTitle = await page.title();
        if (pageTitle && !pageTitle.includes('参数错误') && !pageTitle.includes('环境验证') && pageTitle.length > 2) {
          searchKeyword = pageTitle.substring(0, 30);
        }
      } catch (_) {}
    }

    if (!searchKeyword) {
      await browser.close();
      process.stdout.write(JSON.stringify({
        title: '', text: '', images: [], url: targetUrl,
        note: '需要提供文章标题关键词才能搜索，请在输入框中填写关键词后重试'
      }));
      return;
    }

    console.error(`Searching 搜狗 with keyword: "${searchKeyword}"`);

    await page.goto(
      `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(searchKeyword)}&ie=utf8&s_from=input`,
      { waitUntil: 'domcontentloaded', timeout: 10000 }
    );

    await new Promise(r => setTimeout(r, 1500));

    const sogouLinks = await page.evaluate(() => {
      const selectors = [
        '.news-box .news-list li h3 a',
        '.news-list li h3 a',
        '.txt-box h3 a',
        'ul.news-list2 li h3 a',
      ];
      for (const sel of selectors) {
        const links = Array.from(document.querySelectorAll(sel))
          .slice(0, 5)
          .map(a => ({ title: (a.innerText || '').trim(), href: a.href }));
        if (links.length > 0) return links;
      }
      return [];
    });

    console.error(`Found ${sogouLinks.length} 搜狗 results`);

    if (sogouLinks.length === 0) {
      await browser.close();
      process.stdout.write(JSON.stringify({
        title: '', text: '', images: [], url: targetUrl,
        note: `搜狗未找到"${searchKeyword}"的相关文章，请尝试换个关键词`
      }));
      return;
    }

    for (const link of sogouLinks) {
      try {
        console.error(`Trying: "${link.title}" → ${link.href}`);
        await page.goto(link.href, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        const finalUrl = page.url();
        if (!finalUrl.includes('mp.weixin.qq.com') && !finalUrl.includes('weixin.sogou.com')) continue;

        const artTitle = await page.title();
        const artText = await page.evaluate(() => {
          document.querySelectorAll('script, style, .qr_code_pc, .rich_media_tool, .rich_media_area_extra, #js_pc_qr_code').forEach(el => el.remove());
          const el = document.querySelector('#js_content') || document.querySelector('.rich_media_content') || document.querySelector('.article-content') || document.body;
          return (el?.innerText || '').trim();
        });

        if (artText.length < 50 || artText.includes('参数错误') || artText.includes('环境验证') || artText.includes('账号已迁移')) continue;

        const images = await page.evaluate(() =>
          Array.from(document.querySelectorAll('#js_content img, .rich_media_content img'))
            .map(i => i.src || i.getAttribute('data-src') || i.getAttribute('data-original') || '')
            .filter(s => s && !s.includes('emoji') && !s.includes('icon') && !s.includes('qrcode') && !s.includes('profile'))
            .slice(0, 20)
        );

        console.error(`Success! Got ${artText.length} chars, ${images.length} images`);

        await browser.close();
        process.stdout.write(JSON.stringify({
          title: artTitle || link.title,
          text: artText.substring(0, 8000),
          images,
          url: finalUrl
        }));
        return;
      } catch (linkErr) {
        console.error(`Link failed: ${linkErr.message}`);
        continue;
      }
    }

    await browser.close();
    process.stdout.write(JSON.stringify({
      title: '', text: '', images: [], url: targetUrl,
      note: `搜狗找到了${sogouLinks.length}条结果但都无法打开，请直接复制文章内容粘贴`
    }));

  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    await browser.close();
    process.stdout.write(JSON.stringify({
      error: err.message.substring(0, 200),
      url: targetUrl,
      note: '抓取过程出错，请复制文章内容粘贴'
    }));
  }
})();
