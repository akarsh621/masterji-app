'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';

export default function CashOutForm({ onSuccess }) {
  const [showManual, setShowManual] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleManual = async (e) => {
    e.preventDefault();
    const amt = parseFloat(manualAmount);
    if (!amt || amt <= 0) { setError('Amount daalo'); return; }
    if (!manualNote.trim()) { setError('Note zaroori hai'); return; }
    setManualSubmitting(true);
    setError('');
    try {
      await api.createCashOut({ amount: amt, reason: 'manual', note: manualNote.trim() });
      setShowManual(false);
      setManualAmount('');
      setManualNote('');
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setManualSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="p-2 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <button
        onClick={() => setShowManual(!showManual)}
        className={`w-full py-3 rounded-lg font-medium transition-colors ${
          showManual
            ? 'bg-gray-100 text-gray-600 border border-gray-300'
            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
        }`}
      >
        {showManual ? 'Cancel' : '- Cash Out Record Karo'}
      </button>

      {showManual && (
        <form onSubmit={handleManual} className="card space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kitna nikala (₹)</label>
            <input
              type="number"
              value={manualAmount}
              onChange={e => setManualAmount(e.target.value)}
              placeholder="Amount"
              className="input"
              min="1"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kisliye (zaroori hai)</label>
            <input
              type="text"
              value={manualNote}
              onChange={e => setManualNote(e.target.value)}
              placeholder="Jaise: Electrician, Chai, Courier..."
              className="input"
            />
          </div>
          <button type="submit" disabled={manualSubmitting} className="btn-primary w-full">
            {manualSubmitting ? 'Saving...' : 'Save Cash Out'}
          </button>
        </form>
      )}
    </div>
  );
}
