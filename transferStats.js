const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'transfer-stats.json');
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function buildDefaultStats() {
  return {
    totals: {
      preparedTransfers: 0,
      acceptedTransfers: 0,
      rejectedTransfers: 0,
      completedTransfers: 0,
      uploadedFiles: 0,
      downloadedFiles: 0,
      uploadedBytes: 0,
      downloadedBytes: 0,
    },
    timings: {
      totalAcceptanceMs: 0,
      totalCompletionMs: 0,
      fastestCompletionMs: null,
      slowestCompletionMs: null,
    },
    peaks: {
      largestTransferBytes: 0,
      largestTransferFiles: 0,
      bestThroughputBytesPerSec: 0,
    },
    updatedAt: null,
  };
}

class TransferStats {
  constructor(filePath = STATS_FILE) {
    this.filePath = filePath;
    this.activeSessions = new Map();
    this.stats = this.load();
  }

  load() {
    ensureDir(path.dirname(this.filePath));

    if (!fs.existsSync(this.filePath)) {
      const initial = buildDefaultStats();
      this.write(initial);
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        ...buildDefaultStats(),
        ...parsed,
        totals: { ...buildDefaultStats().totals, ...(parsed.totals || {}) },
        timings: { ...buildDefaultStats().timings, ...(parsed.timings || {}) },
        peaks: { ...buildDefaultStats().peaks, ...(parsed.peaks || {}) },
      };
    } catch (error) {
      console.error('Unable to load transfer stats, resetting file:', error);
      const initial = buildDefaultStats();
      this.write(initial);
      return initial;
    }
  }

  write(nextStats = this.stats) {
    nextStats.updatedAt = new Date().toISOString();
    this.stats = nextStats;
    fs.writeFileSync(this.filePath, JSON.stringify(nextStats, null, 2));
  }

  reset() {
    this.activeSessions.clear();
    this.write(buildDefaultStats());
  }

  markPrepared(sessionId, files = []) {
    const totalBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

    this.activeSessions.set(sessionId, {
      preparedAt: Date.now(),
      fileCount: files.length,
      totalBytes,
    });

    this.stats.totals.preparedTransfers += 1;
    this.write();
  }

  markAccepted(sessionId) {
    const session = this.activeSessions.get(sessionId);
    const acceptedAt = Date.now();

    if (session) {
      session.acceptedAt = acceptedAt;
      const acceptanceMs = acceptedAt - session.preparedAt;
      this.stats.timings.totalAcceptanceMs += acceptanceMs;
    }

    this.stats.totals.acceptedTransfers += 1;
    this.write();
  }

  markRejected(sessionId) {
    this.stats.totals.rejectedTransfers += 1;
    this.activeSessions.delete(sessionId);
    this.write();
  }

  markUploadCompleted(sessionId, savedFiles = []) {
    const session = this.activeSessions.get(sessionId);
    const uploadedAt = Date.now();
    const totalBytes = savedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    const fileCount = savedFiles.length;

    this.stats.totals.completedTransfers += 1;
    this.stats.totals.uploadedFiles += fileCount;
    this.stats.totals.uploadedBytes += totalBytes;

    if (totalBytes > this.stats.peaks.largestTransferBytes) {
      this.stats.peaks.largestTransferBytes = totalBytes;
    }
    if (fileCount > this.stats.peaks.largestTransferFiles) {
      this.stats.peaks.largestTransferFiles = fileCount;
    }

    if (session) {
      const completionMs = uploadedAt - session.preparedAt;
      const throughputBytesPerSec = safeDivide(totalBytes, completionMs / 1000);

      this.stats.timings.totalCompletionMs += completionMs;
      this.stats.timings.fastestCompletionMs =
        this.stats.timings.fastestCompletionMs == null
          ? completionMs
          : Math.min(this.stats.timings.fastestCompletionMs, completionMs);
      this.stats.timings.slowestCompletionMs =
        this.stats.timings.slowestCompletionMs == null
          ? completionMs
          : Math.max(this.stats.timings.slowestCompletionMs, completionMs);
      this.stats.peaks.bestThroughputBytesPerSec = Math.max(
        this.stats.peaks.bestThroughputBytesPerSec,
        throughputBytesPerSec
      );
    }

    this.activeSessions.delete(sessionId);
    this.write();
  }

  markDownloaded(file) {
    this.stats.totals.downloadedFiles += 1;
    this.stats.totals.downloadedBytes += Number(file?.size) || 0;
    this.write();
  }

  getSummary() {
    const { totals, timings, peaks, updatedAt } = this.stats;
    const averageAcceptanceMs = safeDivide(timings.totalAcceptanceMs, totals.acceptedTransfers);
    const averageCompletionMs = safeDivide(timings.totalCompletionMs, totals.completedTransfers);
    const averageFilesPerTransfer = safeDivide(totals.uploadedFiles, totals.completedTransfers);
    const averageTransferBytes = safeDivide(totals.uploadedBytes, totals.completedTransfers);
    const completionRate = safeDivide(totals.completedTransfers, totals.preparedTransfers);
    const acceptanceRate = safeDivide(totals.acceptedTransfers, totals.preparedTransfers);
    const downloadRate = safeDivide(totals.downloadedFiles, totals.uploadedFiles);

    return {
      totals,
      metrics: {
        averageAcceptanceMs: round(averageAcceptanceMs),
        averageCompletionMs: round(averageCompletionMs),
        averageFilesPerTransfer: round(averageFilesPerTransfer),
        averageTransferBytes: round(averageTransferBytes),
        averageTransferMB: round(averageTransferBytes / (1024 * 1024)),
        acceptanceRate: round(acceptanceRate * 100),
        completionRate: round(completionRate * 100),
        downloadRate: round(downloadRate * 100),
        bestThroughputMBps: round(peaks.bestThroughputBytesPerSec / (1024 * 1024)),
      },
      highlights: {
        fastestCompletionMs: timings.fastestCompletionMs,
        slowestCompletionMs: timings.slowestCompletionMs,
        largestTransferBytes: peaks.largestTransferBytes,
        largestTransferMB: round(peaks.largestTransferBytes / (1024 * 1024)),
        largestTransferFiles: peaks.largestTransferFiles,
      },
      updatedAt,
    };
  }
}

module.exports = new TransferStats();
module.exports.TransferStats = TransferStats;
module.exports.STATS_FILE = STATS_FILE;
