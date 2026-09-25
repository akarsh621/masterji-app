'use client';

// Shown when a screen's data couldn't load, instead of a blank screen or an
// endless "Loading...", so staff know to retry rather than assume "no data".
export default function LoadError({ message, onRetry }) {
  return (
    <div className="my-4 p-4 bg-red-50 border border-red-200 rounded-lg text-center">
      <p className="text-sm text-red-700 mb-3">{message || 'Data load nahi hua'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 min-h-[44px] bg-white border border-red-300 text-red-700 rounded-lg font-medium"
        >
          Dobara try karo
        </button>
      )}
    </div>
  );
}
