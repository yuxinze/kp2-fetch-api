/**
 * kp2-fetch-api — Node.js + Puppeteer URL content fetcher (Render deployment)
 * Uses child_process to isolate Puppeteer (Chromium kills the parent Node process)
 * 
 * GET /api/fetch?url=<encoded_url>&keyword=<optional_keyword>
 * Returns: { title, text, images[], url }
 */

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'kp2-fetch-api' });
});

app.get('/api/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  const keyword = req.query.keyword || '';
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });
  try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const isWeChat = /weixin\.qq\.com|mp\.weixin/i.test(targetUrl);

  // Run Puppeteer in a child process — prevents Chromium from killing our server
  const scriptPath = path.join(__dirname, isWeChat ? 'fetch_wechat.mjs' : 'fetch_regular.mjs');
  const args = isWeChat && keyword ? [scriptPath, targetUrl, keyword] : [scriptPath, targetUrl];
  
  execFile(
    'node',
    args,
    {
      timeout: 40000,
      maxBuffer: 1024 * 1024, // 1MB buffer for large responses
    },
    (err, stdout, stderr) => {
      if (err) {
        console.error('Child process error:', err.message);
        return res.status(500).json({ error: err.message.substring(0, 200), url: targetUrl });
      }
      if (stderr) console.error('Child stderr:', stderr.substring(0, 200));

      try {
        const result = JSON.parse(stdout);
        if (!result.text || result.text.length < 20) {
          result.note = result.note || '提取到的内容过少，建议复制文章内容粘贴';
        }
        res.json(result);
      } catch (parseErr) {
        res.status(500).json({ error: 'Parse error: ' + stdout.substring(0, 100), url: targetUrl });
      }
    }
  );
});

process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => console.log(`kp2-fetch-api running on port ${PORT}`));
