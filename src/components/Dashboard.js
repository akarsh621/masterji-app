'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { getISTDateInputValue } from '@/lib/ui-utils';
import DeltaBadge from '@/components/DeltaBadge';
import CategoryBreakdown from '@/components/CategoryBreakdown';

export default function Dashboard() {
  const [view, setView] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [trendMode, setTrendMode] = useState('weekly');

  const fetchData = (v, from, to) => {
    setLoading(true);
    const params = {};
    if (v === 'custom' && from && to) {
      params.from = from;
      params.to = to;
    } else {
      params.view = v || view;
    }
    api.getDashboard(params)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (view === 'custom') return;
    fetchData(view);
  }, [view]);

  const changeView = (v) => {
    setView(v);
    if (v === 'custom') {
      const today = getISTDateInputValue();
      setCustomFrom(today);
      setCustomTo(today);
    }
  };

  const applyCustomRange = () => {
    if (customFrom && customTo) {
      fetchData('custom', customFrom, customTo);
    }
  };

  const handleExport = async () => {
    try {
      const params = {};
      const today = getISTDateInputValue();
      if (view === 'custom' && customFrom && customTo) {
        params.from = customFrom;
        params.to = customTo;
      } else if (view === 'week') {
        const now = new Date();
        const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        const day = ist.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        ist.setUTCDate(ist.getUTCDate() - diff);
        const y = ist.getUTCFullYear();
        const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
        const d = String(ist.getUTCDate()).padStart(2, '0');
        params.from = `${y}-${m}-${d}`;
        params.to = today;
      } else if (view === 'month') {
        const now = new Date();
        const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        params.from = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01`;
        params.to = today;
      } else {
        params.from = today;
        params.to = today;
      }
      const res = await api.exportCSV(params);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `masterji-bills-${view}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
  };

  if (loading && !data) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  if (!data) return null;

  const { summary, previous_summary, categoryBreakdown, dailyTrend, weeklyTrend, salesmanBreakdown } = data;
  const prev = previous_summary || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Dashboard</h2>
        <div className="flex gap-2">
          <button onClick={handleExport} className="text-sm text-green-600">
            ⬇ Export
          </button>
          <button onClick={() => fetchData(view, customFrom, customTo)} className="text-sm text-blue-600">
            Refresh ↻
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
        {[
          { id: 'today', label: 'Aaj' },
          { id: 'week', label: 'Hafta' },
          { id: 'month', label: 'Mahina' },
          { id: 'custom', label: 'Custom' },
        ].map(v => (
          <button
            key={v.id}
            onClick={() => changeView(v.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              view === v.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'custom' && (
        <div className="card mb-4">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input text-sm" />
            </div>
          </div>
          <button onClick={applyCustomRange} className="btn-primary w-full text-sm">Apply</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card text-center">
          <div className="text-2xl font-bold">
            ₹{Math.round(summary.total_revenue).toLocaleString('en-IN')}
            <DeltaBadge current={summary.total_revenue} previous={prev.total_revenue} />
          </div>
          <div className="text-xs text-gray-500 mt-1">Net Revenue</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold">
            {summary.total_bills}
            <DeltaBadge current={summary.total_bills} previous={prev.total_bills} />
          </div>
          <div className="text-xs text-gray-500 mt-1">Total Bills</div>
        </div>
      </div>

      {summary.return_count > 0 && (
        <div className="card mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Returns ({summary.return_count})</span>
            <span className="text-lg font-bold text-red-600">-₹{Math.round(summary.total_returns).toLocaleString('en-IN')}</span>
          </div>
          {summary.gross_revenue > 0 && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-gray-400">Gross Revenue</span>
              <span className="text-sm text-gray-500">₹{Math.round(summary.gross_revenue).toLocaleString('en-IN')}</span>
            </div>
          )}
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
        <div className="card mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Total Discount (MRP se)</span>
            <span className="text-lg font-bold text-orange-600">
              -₹{Math.round(summary.total_discount).toLocaleString('en-IN')}
              {summary.total_mrp > 0 && ` (${Math.round((summary.total_discount / summary.total_mrp) * 100)}%)`}
            </span>
          </div>
        </div>
      )}

      {summary.total_bills > 0 && (
        <div className="card mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Avg Bill Value</span>
            <span className="text-lg font-bold">
              ₹{Math.round(summary.total_revenue / summary.total_bills).toLocaleString('en-IN')}
              {prev.total_bills > 0 && (
                <DeltaBadge
                  current={summary.total_revenue / summary.total_bills}
                  previous={prev.total_revenue / prev.total_bills}
                />
              )}
            </span>
          </div>
        </div>
      )}

      {(() => {
        const showToggle = (view === 'month' || view === 'custom') && weeklyTrend && weeklyTrend.length > 0;
        const useWeekly = showToggle && trendMode === 'weekly';
        const trendData = useWeekly ? weeklyTrend : dailyTrend;

        if (!trendData || trendData.length < 2) return null;

        const maxRev = Math.max(...trendData.map(x => x.revenue));
        const BAR_AREA_HEIGHT = 96;

        return (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-500">
              {useWeekly ? 'Weekly Trend' : 'Daily Trend'}
            </h3>
            {showToggle && (
              <div className="flex bg-gray-100 rounded-md p-0.5">
                <button
                  onClick={() => setTrendMode('weekly')}
                  className={`px-2 py-0.5 text-[11px] rounded ${trendMode === 'weekly' ? 'bg-white text-blue-700 shadow-sm font-medium' : 'text-gray-500'}`}
                >
                  Weekly Trend
                </button>
                <button
                  onClick={() => setTrendMode('daily')}
                  className={`px-2 py-0.5 text-[11px] rounded ${trendMode === 'daily' ? 'bg-white text-blue-700 shadow-sm font-medium' : 'text-gray-500'}`}
                >
                  Daily Trend
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="flex items-end gap-1" style={{ minWidth: trendData.length > 10 ? `${trendData.length * 48}px` : undefined }}>
              {trendData.map((d, i) => {
                const barH = maxRev > 0 ? Math.max((d.revenue / maxRev) * BAR_AREA_HEIGHT, 4) : 4;
                let label;
                if (useWeekly) {
                  const ws = new Date(d.week_start + 'T00:00:00');
                  const we = new Date(d.week_end + 'T00:00:00');
                  const fmt = (dt) => dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  label = `${fmt(ws)}-${we.getDate()}`;
                } else {
                  label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                }
                return (
                  <div key={i} className="flex-1 flex flex-col items-center" style={{ minWidth: 40 }}>
                    <span className="text-[10px] text-gray-500 mb-1">₹{Math.round(d.revenue / 1000)}k</span>
                    <div style={{ height: BAR_AREA_HEIGHT }} className="w-full flex items-end">
                      <div
                        className={`w-full rounded-t ${useWeekly ? 'bg-indigo-500' : 'bg-blue-500'}`}
                        style={{ height: barH }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        );
      })()}

      <CategoryBreakdown data={categoryBreakdown} />

      {salesmanBreakdown.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Sales Team Performance</h3>
          {salesmanBreakdown.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <span className="font-medium">{s.salesman_name}</span>
                <span className="text-gray-400 text-sm ml-2">{s.bills} bills, {s.items} items</span>
              </div>
              <span className="font-bold">₹{Math.round(s.revenue).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}

      {summary.total_bills === 0 && (
        <div className="text-center py-8 text-gray-400">
          Is period mein koi data nahi hai.
        </div>
      )}
    </div>
  );
}
