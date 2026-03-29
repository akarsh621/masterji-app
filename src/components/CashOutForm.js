'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';

const REASON_OPTIONS = [
  { id: 'expense', label: 'Roz ka Kharcha' },
  { id: 'supplier', label: 'Supplier ko diya' },
  { id: 'owner', label: 'Cash / Sale Withdrawal' },
  { id: 'other', label: 'Other' },
];

export default function CashOutForm({ onSuccess }) {
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('expense');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Amount daalo'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.createCashOut({ amount: amt, reason, note });
      setShowForm(false);
      setAmount('');
      setNote('');
      setReason('expense');
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setShowForm(!showForm)}
        className={`w-full py-3 rounded-lg font-medium transition-colors ${
          showForm
            ? 'bg-gray-100 text-gray-600 border border-gray-300'
            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
        }`}
      >
        {showForm ? 'Cancel' : '- Cash Out Record Karo'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="card mt-3 space-y-3">
          {error && <div className="p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kitna nikala (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount"
              className="input"
              min="1"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kisliye</label>
            <div className="grid grid-cols-2 gap-2">
              {REASON_OPTIONS.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReason(r.id)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors text-left ${
                    reason === r.id
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Jaise: Electrician ko diya"
              className="input"
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Saving...' : 'Save Cash Out'}
          </button>
        </form>
      )}
    </div>
  );
}
