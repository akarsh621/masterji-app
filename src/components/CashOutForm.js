'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';

export default function CashOutForm({ onSuccess, cashDrawer, pettyCashTarget, isAdmin }) {
  const sweepAmount = Math.max(0, Math.round(cashDrawer - pettyCashTarget));

  const [sweepInput, setSweepInput] = useState('');
  const [sweepSubmitting, setSweepSubmitting] = useState(false);

  const [showManual, setShowManual] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSweep = async () => {
    const amt = parseFloat(sweepInput || sweepAmount);
    if (!amt || amt <= 0) { setError('Sweep amount 0 se zyada hona chahiye'); return; }
    setSweepSubmitting(true);
    setError('');
    try {
      await api.createCashOut({ amount: amt, reason: 'sweep', note: 'Daily sweep' });
      setSweepInput('');
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSweepSubmitting(false);
    }
  };

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

      {isAdmin && sweepAmount > 0 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
          <div className="text-sm font-medium text-green-800">Aaj ka Sweep</div>
          <div className="flex justify-between text-xs text-gray-600">
            <span>Drawer: ₹{Math.round(cashDrawer).toLocaleString('en-IN')}</span>
            <span>Petty: ₹{Math.round(pettyCashTarget).toLocaleString('en-IN')}</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="number"
                value={sweepInput}
                onChange={e => setSweepInput(e.target.value)}
                placeholder={`₹${sweepAmount.toLocaleString('en-IN')}`}
                className="input text-lg font-bold"
                min="1"
              />
            </div>
            <button
              onClick={handleSweep}
              disabled={sweepSubmitting}
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 active:bg-green-800 transition-colors disabled:bg-gray-300"
            >
              {sweepSubmitting ? '...' : 'Sweep Karo'}
            </button>
          </div>
          {!sweepInput && (
            <div className="text-xs text-gray-500">
              ₹{sweepAmount.toLocaleString('en-IN')} nikalo, ₹{Math.round(pettyCashTarget).toLocaleString('en-IN')} drawer mein rahega
            </div>
          )}
        </div>
      )}

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
