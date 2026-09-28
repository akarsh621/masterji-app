// Next.js runs this once at server start. Server-only work lives in its own
// file and is imported only on the Node.js runtime, so it's never compiled for
// the edge runtime (where the database library can't load).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackupScheduler } = await import('./backup-scheduler');
    await startBackupScheduler();
  }
}
