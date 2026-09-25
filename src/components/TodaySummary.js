'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import LoadError from '@/components/LoadError';
import DeltaBadge from '@/components/DeltaBadge';
import { formatRupees } from '@/lib/ui-utils';
import CategoryBreakdown from '@/components/CategoryBreakdown';

export default function TodaySummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState('');

  const fetchData = () => {
    setLoading(true);
    api.getDashboard({ view: 'today' })
      .then(d => { setData(d); setLoadError(''); })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // Refresh every 30s, but not while the phone is on another app (saves data
    // and battery); catch up as soon as the app is visible again.
    const interval = setInterval(() => { if (!document.hidden) fetchData(); }, 30000);
    const onVisible = () => { if (!document.hidden) fetchData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (loading && !data) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  if (!data) return loadError ? <LoadError message={loadError} onRetry={fetchData} /> : null;

  const { summary, previous_summary, categoryBreakdown, salesmanBreakdown } = data;
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
            {formatRupees(summary.total_revenue)}
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
          <div className="text-lg font-bold text-green-700">{formatRupees(summary.cash_total)}</div>
          <div className="text-xs text-gray-500">💵 Cash</div>
        </div>
        <div className="card text-center py-2">
          <div className="text-lg font-bold text-purple-700">{formatRupees(summary.upi_total)}</div>
          <div className="text-xs text-gray-500">📱 UPI</div>
        </div>
        <div className="card text-center py-2">
          <div className="text-lg font-bold text-teal-700">{formatRupees(summary.card_total)}</div>
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

      {salesmanBreakdown && salesmanBreakdown.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Sales Team Performance</h3>
          {salesmanBreakdown.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <span className="font-medium">{s.salesman_name}</span>
                <span className="text-gray-400 text-sm ml-2">{s.bills} bills, {s.items} items</span>
              </div>
              <span className="font-bold">{formatRupees(s.revenue)}</span>
            </div>
          ))}
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
