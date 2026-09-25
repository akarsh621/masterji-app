'use client';

// Shown instead of a blank white screen if a screen crashes while drawing.
// Any bill being built is saved on the phone, so reopening brings it back.
export default function Error({ reset }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="text-2xl font-bold text-blue-600 mb-2">Master Ji</div>
        <p className="text-gray-700 mb-1">Kuch gadbad ho gayi.</p>
        <p className="text-sm text-gray-500 mb-5">Bill jo ban raha tha woh phone mein save hai.</p>
        <button
          onClick={() => { try { reset(); } catch { window.location.reload(); } }}
          className="btn-primary w-full py-3"
        >
          App dobara kholo
        </button>
      </div>
    </div>
  );
}
