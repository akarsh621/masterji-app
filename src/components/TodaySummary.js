'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import CashOutForm from './CashOutForm';
import DeltaBadge from '@/components/DeltaBadge';
import { getISTDateInputValue, REASON_LABELS } from '@/lib/ui-utils';
import CategoryBreakdown from '@/components/CategoryBreakdown';

function formatTime(value) {
  if (!value || typeof value !== 'string') return '';
  const parsed = new Date(value.replace(' ', 'T') + '+05:30');
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

export default function TodaySummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cashOutEntries, setCashOutEntries] = useState([]);

  const fetchCashOutEntries = () => {
    const today = getISTDateInputValue();
    api.getCashOut({ from: today, to: today })
      .then(d => setCashOutEntries(d.entries || []))
      .catch(() => {});
  };

  const fetchData = () => {
    setLoading(true);
    api.getDashboard({ view: 'today' })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchCashOutEntries();
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  if (!data) return null;

  const { summary, previous_summary, categoryBreakdown } = data;
  const prev = previous_summary || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Aaj ka Summary</h2>
        <button onClick={fetchData} className="text-sm text-blue-600">
          Refresh ↻
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-gray-900">
            ₹{Math.round(summary.total_revenue).toLocaleString('en-IN')}
            <DeltaBadge current={summary.total_revenue} previous={prev.total_revenue} />
          </div>
          <div className="text-xs text-gray-500 mt-1">Net Sale</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-gray-900">
            {summary.total_bills}
            <DeltaBadge current={summary.total_bills} previous={prev.total_bills} />
          </div>
          <div className="text-xs text-gray-500 mt-1">Bills</div>
        </div>
      </div>

      {summary.return_count > 0 && (
        <div className="card mb-4 text-center">
          <div className="text-lg font-bold text-red-600">-₹{Math.round(summary.total_returns).toLocaleString('en-IN')}</div>
          <div className="text-xs text-gray-500 mt-1">{summary.return_count} Returns</div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="card text-center py-2">
          <div className="text-lg font-bold text-green-700">₹{Math.round(summary.cash_total).toLocaleString('en-IN')}</div>
          <div className="text-xs text-gray-500">💵 Cash</div>
        </div>
        <div className="card text-center py-2">
          <div className="text-lg font-bold text-purple-700">₹{Math.round(summary.upi_total).toLocaleString('en-IN')}</div>
          <div className="text-xs text-gray-500">📱 UPI</div>
        </div>
        <div className="card text-center py-2">
          <div className="text-lg font-bold text-teal-700">₹{Math.round(summary.card_total).toLocaleString('en-IN')}</div>
          <div className="text-xs text-gray-500">💳 Card</div>
        </div>
      </div>

      {summary.total_discount > 0 && (
        <div className="card mb-4 text-center">
          <div className="text-lg font-bold text-orange-600">-₹{Math.round(summary.total_discount).toLocaleString('en-IN')}</div>
          <div className="text-xs text-gray-500 mt-1">
            Total Discount Diya{summary.total_mrp > 0 && ` (${Math.round((summary.total_discount / summary.total_mrp) * 100)}% off MRP)`}
          </div>
        </div>
      )}

      {/* Cash out section for salesmen */}
      <div className="mb-4">
        <CashOutForm onSuccess={fetchData} />
      </div>

      {cashOutEntries.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Aaj ke Cash Out</h3>
          <div className="space-y-2">
            {cashOutEntries.map(entry => (
              <div key={entry.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <span className="text-sm font-medium">{REASON_LABELS[entry.reason] || entry.reason}</span>
                  {entry.note && <span className="text-xs text-gray-400 ml-2">— {entry.note}</span>}
                  <div className="text-xs text-gray-400">{entry.recorded_by_name} · {formatTime(entry.created_at)}</div>
                </div>
                <span className="text-sm font-bold text-red-600">-₹{Math.round(entry.amount).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <CategoryBreakdown data={categoryBreakdown} />

      {categoryBreakdown.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          Aaj abhi tak koi bill nahi bana. Pehla bill banao!
        </div>
      )}
    </div>
  );
}
