// Trivy's Transfer System (TTS) Server
// This server handles file transfer sessions between devices.
// It provides endpoints for preparing transfers, accepting/rejecting,
// uploading files, and downloading them.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const transferStats = require('./transferStats');

// Ensure the uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Helper function to summarize session status for logging
function summarizeSession(session) {
  if (!session) {
    return null;
  }

  return {
    status: session.status || null,
    pendingStatus: session.pending?.status || null,
    pendingFiles: Array.isArray(session.pending?.files) ? session.pending.files.length : 0,
    receivedFiles: Array.isArray(session.received) ? session.received.length : 0,
  };
}

// Logging function for tracking server steps
function logStep(step, details = {}) {
  console.log(`[TTS] ${step}`, details);
}

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (req.body == null) req.body = {};
  next();
});
// Middleware to log all requests
app.use((req, res, next) => {
  logStep('request', {
    method: req.method,
    path: req.path,
    sessionId: req.params?.id || req.query?.sessionId || req.body?.sessionId || null,
  });
  next();
});

// In-memory storage for transfer sessions
const sessions = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  return res.json({ ok: true, activeSessions: sessions.size });
});

// Debug endpoint to list all sessions (for development)
app.get('/debug/sessions', (req, res) => {
  const data = Array.from(sessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    ...summarizeSession(session),
  }));

  return res.json({ sessions: data });
});

// Prepare a new transfer session
app.post('/prepare', (req, res) => {
  const { sessionId, files } = req.body || {};
  if (!sessionId) {
    logStep('prepare_failed', { reason: 'missing sessionId' });
    return res.status(400).json({ error: 'missing sessionId' });
  }
  if (!Array.isArray(files)) {
    logStep('prepare_failed', { sessionId, reason: 'missing files array' });
    return res.status(400).json({ error: 'missing files array' });
  }

  sessions.set(sessionId, { status: 'waiting', pending: { files, status: 'waiting' }, received: [] });
  transferStats.markPrepared(sessionId, files);
  logStep('prepare_ok', {
    sessionId,
    files: files.map(file => ({ name: file.name, size: file.size })),
    session: summarizeSession(sessions.get(sessionId)),
  });
  return res.json({ ok: true });
});

// Get session details
app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id) || null;
  return res.json({ session: s });
});

// Accept a pending transfer
app.post('/session/:id/accept', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s || !s.pending) {
    logStep('accept_failed', { sessionId: id, reason: 'no pending transfer' });
    return res.status(404).json({ error: 'no pending transfer' });
  }
  s.pending.status = 'accepted';
  s.status = 'accepted';
  sessions.set(id, s);
  transferStats.markAccepted(id);
  logStep('accept_ok', { sessionId: id, session: summarizeSession(s) });
  return res.json({ ok: true });
});

// Reject a pending transfer
app.post('/session/:id/reject', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s || !s.pending) {
    logStep('reject_failed', { sessionId: id, reason: 'no pending transfer' });
    return res.status(404).json({ error: 'no pending transfer' });
  }
  s.pending = null;
  s.status = 'rejected';
  s.received = [];
  sessions.set(id, s);
  transferStats.markRejected(id);
  logStep('reject_ok', { sessionId: id, session: summarizeSession(s) });
  return res.json({ ok: true });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Upload files for an accepted session
app.post('/upload', upload.array('files'), (req, res) => {
  const sessionId = req.query.sessionId || (req.body || {}).sessionId;
  if (!sessionId) {
    logStep('upload_failed', { reason: 'missing sessionId' });
    return res.status(400).json({ error: 'missing sessionId' });
  }
  const s = sessions.get(sessionId);
  if (!s || !s.pending) {
    logStep('upload_failed', { sessionId, reason: 'no prepared transfer' });
    return res.status(400).json({ error: 'no prepared transfer' });
  }
  if (s.pending.status !== 'accepted') {
    logStep('upload_failed', { sessionId, reason: 'transfer not accepted', session: summarizeSession(s) });
    return res.status(403).json({ error: 'transfer not accepted' });
  }

  const saved = (req.files || []).map(f => ({ originalName: f.originalname, path: f.path, size: f.size }));
  s.received = (s.received || []).concat(saved);
  s.status = 'uploaded';
  delete s.pending;
  sessions.set(sessionId, s);
  transferStats.markUploadCompleted(sessionId, saved);
  logStep('upload_ok', {
    sessionId,
    files: saved.map(file => ({ name: file.originalName, size: file.size })),
    session: summarizeSession(s),
  });
  return res.json({ message: 'files saved', files: saved });
});

// Get list of uploaded files for a session
app.get('/session/:id/files', (req, res) => {
  const id = req.params.id;
  const s = sessions.get(id);
  if (!s) {
    logStep('files_failed', { sessionId: id, reason: 'session not found' });
    return res.status(404).json({ error: 'session not found' });
  }
  const files = s.received || [];
  return res.json({ files });
});

// Get transfer statistics
app.get('/stats', (req, res) => {
  return res.json(transferStats.getSummary());
});

// Download a specific file from a session
app.get('/session/:id/download/:filename', (req, res) => {
  const id = req.params.id;
  const filename = req.params.filename;
  const s = sessions.get(id);
  if (!s) {
    logStep('download_failed', { sessionId: id, filename, reason: 'session not found' });
    return res.status(404).json({ error: 'session not found' });
  }
  
  const file = (s.received || []).find(f => f.originalName === filename);
  if (!file) {
    logStep('download_failed', { sessionId: id, filename, reason: 'file not found' });
    return res.status(404).json({ error: 'file not found' });
  }
  
  res.download(file.path, file.originalName, (err) => {
    if (err) {
      console.error('[TTS] download_failed', { sessionId: id, filename, error: err.message || err });
      return;
    }
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.error('[TTS] cleanup_failed', { sessionId: id, path: file.path, error: unlinkErr.message || unlinkErr });
      } else {
        transferStats.markDownloaded(file);
        s.received = (s.received || []).filter(f => f.path !== file.path);
        if (s.received.length === 0) {
          s.status = 'completed';
        }
        sessions.set(id, s);
        logStep('download_ok', { sessionId: id, filename, session: summarizeSession(s) });
      }
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

// Start the server if this file is run directly
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://0.0.0.0:${PORT}`));
}

// Export the app for testing or external use
module.exports = app;
