'use client';

// Last-resort fallback if the root layout itself fails. Must render <html>.
export default function GlobalError() {
  return (
    <html lang="en" translate="no">
      <body style={{ fontFamily: 'sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ marginBottom: 16 }}>Kuch gadbad ho gayi.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', fontSize: 16 }}>
            App dobara kholo
          </button>
        </div>
      </body>
    </html>
  );
}
