const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const transferStats = require('./transferStats');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (req.body == null) req.body = {};
  next();
});

// In-memory session store (for prototype/demo only)
// sessionId -> { status, pending: { files: [{name,size,type}], status }, received: [{name, path, size}] }
const sessions = new Map();

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/prepare', (req, res) => {
  const { sessionId, files } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });
  if (!Array.isArray(files)) return res.status(400).json({ error: 'missing files array' });

  sessions.set(sessionId, { status: 'waiting', pending: { files, status: 'waiting' }, received: [] });
  transferStats.markPrepared(sessionId, files);
  console.log(`Prepared transfer for session ${sessionId}:`, files);
  return res.json({ ok: true });
});

app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id) || null;
  return res.json({ session: s });
});

app.post('/session/:id/accept', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s || !s.pending) return res.status(404).json({ error: 'no pending transfer' });
  s.pending.status = 'accepted';
  s.status = 'accepted';
  sessions.set(id, s);
  transferStats.markAccepted(id);
  console.log(`Session ${id} accepted`);
  return res.json({ ok: true });
});

app.post('/session/:id/reject', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s || !s.pending) return res.status(404).json({ error: 'no pending transfer' });
  // Remove pending transfer entirely when rejected
  s.pending = null;
  s.status = 'rejected';
  s.received = [];
  sessions.set(id, s);
  transferStats.markRejected(id);
  console.log(`Session ${id} rejected`);
  return res.json({ ok: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.post('/upload', upload.array('files'), (req, res) => {
  const sessionId = req.query.sessionId || (req.body || {}).sessionId;
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });
  const s = sessions.get(sessionId);
  if (!s || !s.pending) return res.status(400).json({ error: 'no prepared transfer' });
  if (s.pending.status !== 'accepted') return res.status(403).json({ error: 'transfer not accepted' });

  const saved = (req.files || []).map(f => ({ originalName: f.originalname, path: f.path, size: f.size }));
  // store received files for session
  s.received = (s.received || []).concat(saved);
  s.status = 'uploaded';
  // clear pending after successful upload
  delete s.pending;
  sessions.set(sessionId, s);
  transferStats.markUploadCompleted(sessionId, saved);
  console.log(`Received files for session ${sessionId}:`, saved);
  return res.json({ message: 'files saved', files: saved });
});

// List received files for a session
app.get('/session/:id/files', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const files = s.received || [];
  return res.json({ files });
});

// Product showcase metrics for demos, dashboards, and reports
app.get('/stats', (req, res) => {
  return res.json(transferStats.getSummary());
});

// Download a file from a session (by filename)
app.get('/session/:id/download/:filename', (req, res) => {
  const id = req.params.id;
  const filename = req.params.filename;
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  
  const file = (s.received || []).find(f => f.originalName === filename);
  if (!file) return res.status(404).json({ error: 'file not found' });
  
  // send file with correct content-disposition for download
  res.download(file.path, file.originalName, (err) => {
    if (err) {
      console.error(`Error downloading file ${filename}:`, err);
      return;
    }
    // Delete file after successful download
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.error(`Error deleting file ${file.path}:`, unlinkErr);
      } else {
        console.log(`File deleted after download: ${file.path}`);
        transferStats.markDownloaded(file);
        // Remove from received list
        s.received = (s.received || []).filter(f => f.path !== file.path);
        if (s.received.length === 0) {
          s.status = 'completed';
        }
        sessions.set(id, s);
      }
    });
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://0.0.0.0:${PORT}`));
}

module.exports = app;
