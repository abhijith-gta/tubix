const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

let currentDownload = null; // store current process

// Get video title
app.post('/get-title', (req, res) => {
  const url = req.body.url;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const getTitle = spawn('yt-dlp', ['--get-title', url]);
  let title = '';

  getTitle.stdout.on('data', data => {
    title += data.toString();
  });

  getTitle.on('close', code => {
    if (code !== 0 || !title.trim()) {
      console.error(`yt-dlp exited with code ${code}`);
      return res.status(500).json({ error: 'Failed to fetch title' });
    }
    res.json({ title: sanitize(title.trim()) });
  });

  getTitle.stderr.on('data', data => {
    console.error(`yt-dlp error: ${data}`);
  });
});

// Download route
app.post('/download', (req, res) => {
  const url = req.body.url;
  const quality = req.body.quality || 'best';

  // Get title first
  const getTitle = spawn('yt-dlp', ['--get-title', url]);
  let title = '';

  getTitle.stdout.on('data', data => {
    title += data.toString();
  });

  getTitle.on('close', () => {
    title = sanitize(title.trim()) || `video_${Date.now()}`;
    const filename = `${title}.mp4`;
    const outputPath = path.join(__dirname, `${Date.now()}.mp4`);

    // Download single best format up to chosen quality
    currentDownload = spawn('yt-dlp', [
      '-f', `best[height<=${quality}][ext=mp4]/best[ext=mp4]`,
      '-o', outputPath,
      url
    ]);

    currentDownload.stderr.on('data', data => {
      console.error(`yt-dlp: ${data}`);
    });

    currentDownload.on('close', code => {
      currentDownload = null;
      if (code !== 0) {
        console.error(`yt-dlp exited with code ${code}`);
        return res.status(500).send('Download failed');
      }

      // Stream file to client
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'video/mp4');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('close', () => {
        fs.unlink(outputPath, () => {});
      });
    });
  });

  getTitle.stderr.on('data', data => {
    console.error(`yt-dlp error: ${data}`);
  });
});

// Cancel route
app.post('/cancel', (req, res) => {
  if (currentDownload) {
    currentDownload.kill('SIGTERM');
    currentDownload = null;
    res.json({ status: 'cancelled' });
  } else {
    res.json({ status: 'no active download' });
  }
});

app.listen(3000, () => console.log('✅ Tubix server running on http://localhost:3000'));
