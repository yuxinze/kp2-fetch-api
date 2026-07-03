/**
 * kp2-fetch-api — Node.js URL content fetcher (Render deployment)
 * ESM format (type: module)
 *
 * Strategy: 1) Lightweight HTTP fetch first (fast, reliable for most sites)
 *           2) Puppeteer browser fallback (for JS-heavy sites that need rendering)
 *
 * GET /api/fetch?url=<encoded_url>&keyword=<optional_keyword>
 * Returns: { title, text, images[], url, method }
 */

import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'kp2-fetch-api', version: '2.0' });
});

/**
 * Lightweight HTTP fetch — try to get raw HTML without a browser
 * Fast (2-5s), works for most static and semi-dynamic sites
 */
function lightFetch(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity', // no compression for simpler parsing
      },
      timeout: 12000,
    };

    const req = mod.get(urlStr, options, (res) => {
      // Handle redirects manually (max 3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const newUrl = loc.startsWith('http') ? loc : new URL(loc, urlStr).href;
        if (newUrl !== urlStr) {
          lightFetch(newUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let body = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = extractFromHtml(body, urlStr);
          if (result.text.length < 30) {
            reject(new Error('Light fetch got too little content'));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Light fetch timeout')); });
  });
}

/**
 * Extract title, text, images from raw HTML
 */
function extractFromHtml(html, urlStr) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || '').trim().replace(/&[^;]+;/g, '');

  // Find main content area selectors (ordered by priority)
  const contentPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*(?:class|id)=["'][^"']*(?:article-content|post-content|news-content|detail-content|js_content|content-body|main-content|article_content|detail_box)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*(?:class|id)=["'][^"']*(?:content|detail)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
  ];

  let contentHtml = '';
  for (const pat of contentPatterns) {
    const m = pat.exec(html);
    if (m?.[1] && m[1].length > 200) {
      contentHtml = m[1];
      break;
    }
  }
  // Fallback: use body
  if (!contentHtml || contentHtml.length < 200) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    contentHtml = bodyMatch?.[1] || html;
  }

  // Strip tags, clean text
  const text = contentHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[^;]+;/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\n\s+\n/g, '\n')
    .trim()
    .substring(0, 8000);

  // Extract image URLs
  const imgRegex = /<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi;
  const images = [];
  let imgMatch;
  while ((imgMatch = imgRegex.exec(contentHtml)) !== null) {
    const src = imgMatch[1];
    if (src.startsWith('http') && src.length > 50 &&
        !src.includes('emoji') && !src.includes('icon') && !src.includes('logo') &&
        !src.includes('qrcode') && !src.includes('avatar') && !src.includes('banner')) {
      images.push(src);
    }
  }

  return { title, text, images: images.slice(0, 20), url: urlStr, method: 'light' };
}

app.get('/api/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  const keyword = req.query.keyword || '';
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });
  try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  // Strategy 1: Light HTTP fetch (fast, no browser needed)
  try {
    const lightResult = await lightFetch(targetUrl);
    if (lightResult.text.length >= 100) {
      console.log(`[light] ${targetUrl} → ${lightResult.text.length} chars`);
      return res.json(lightResult);
    }
  } catch (lightErr) {
    console.log(`[light] ${targetUrl} failed: ${lightErr.message}`);
  }

  // Strategy 2: Puppeteer browser (slow, for JS-heavy sites)
  const isWeChat = /weixin\.qq\.com|mp\.weixin/i.test(targetUrl);
  const scriptPath = path.join(__dirname, isWeChat ? 'fetch_wechat.mjs' : 'fetch_regular.mjs');
  const args = isWeChat && keyword ? [scriptPath, targetUrl, keyword] : [scriptPath, targetUrl];

  execFile(
    'node',
    args,
    {
      timeout: 45000, // generous timeout for Puppeteer
      maxBuffer: 1024 * 1024,
    },
    (err, stdout, stderr) => {
      if (err) {
        console.error(`[puppeteer] ${targetUrl} error:`, err.message.substring(0, 200));
        return res.status(500).json({ error: err.message.substring(0, 200), url: targetUrl });
      }
      if (stderr) console.error('Child stderr:', stderr.substring(0, 200));

      try {
        const result = JSON.parse(stdout);
        result.method = 'puppeteer';
        if (!result.text || result.text.length < 20) {
          result.note = result.note || '提取到的内容过少，建议复制文章内容粘贴';
        }
        console.log(`[puppeteer] ${targetUrl} → ${(result.text||'').length} chars`);
        res.json(result);
      } catch (parseErr) {
        res.status(500).json({ error: 'Parse error: ' + stdout.substring(0, 100), url: targetUrl });
      }
    }
  );
});

process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => console.log(`kp2-fetch-api v2.0 running on port ${PORT}`));
