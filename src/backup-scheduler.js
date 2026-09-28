// Started once when the server starts (from src/instrumentation.js). Daily
// bucket backup: checks every 10 minutes and backs up once per IST day after
// 11:30 pm, or straight away if the last good backup is over a day old.
// Off in local dev and tests (no bucket variables, or DB_MODE=dev).
export async function startBackupScheduler() {
  if (process.env.DB_MODE === 'dev') return;

  const { bucketConfig, backupStatus, isBackupDue, runBackup } = await import('./lib/backup.js');
  if (!bucketConfig()) {
    console.log('[backup] BUCKET_* variables not set -- automatic bucket backups are off');
    return;
  }
  const { getDb } = await import('./lib/db/index.js');

  const tick = async () => {
    try {
      const db = getDb();
      if (!isBackupDue(backupStatus(db))) return;
      const result = await runBackup(db);
      console.log(result.ok
        ? `[backup] uploaded ${result.uploaded.join(', ')}; removed ${result.deleted.length} old copies`
        : `[backup] FAILED: ${result.error}`);
    } catch (err) {
      console.error('[backup] scheduler error:', err);
    }
  };

  setTimeout(tick, 60 * 1000); // shortly after start
  setInterval(tick, 10 * 60 * 1000).unref();
  console.log('[backup] automatic bucket backups on (daily after 11:30 pm IST)');
}
