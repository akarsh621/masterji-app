'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import LoadError from '@/components/LoadError';

const fmt = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');

function formatDate(dt) {
  if (!dt) return '—';
  const [y, m, d] = dt.slice(0, 10).split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

// Admin: everyone who gave a mobile number at billing, with visits, spend
// (net of returns) and last visit. Tap a customer to see their bills.
export default function Customers() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [bills, setBills] = useState({});
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  const load = (page = 1, q = query) => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError('');
    api.getCustomers({ page, ...(q.trim() ? { q: q.trim() } : {}) })
      .then(d => { if (mine === seq.current) setData(d); })
      .catch(err => { if (mine === seq.current) setLoadError(err.message); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  };

  useEffect(() => { load(1, ''); }, []);

  const toggle = (c) => {
    if (openId === c.id) { setOpenId(null); return; }
    setOpenId(c.id);
    if (!bills[c.id]) {
      api.getBills({ customer_id: c.id, limit: 50 })
        .then(d => setBills(prev => ({ ...prev, [c.id]: d.bills })))
        .catch(err => setBills(prev => ({ ...prev, [c.id]: { error: err.message } })));
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.customersCSV();
      if (!res.ok) throw new Error('Export nahi hua — dobara try karo');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'masterji-customers.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); load(1); }} className="flex gap-2 mb-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Customer name ya mobile"
          className="input"
        />
        <button type="submit" className="btn-primary text-sm">Search</button>
      </form>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">{data ? `${data.pagination.total} ${data.pagination.total === 1 ? 'customer' : 'customers'}` : ''}</span>
        <button onClick={exportCsv} disabled={exporting} className="text-sm text-green-700 font-medium">
          {exporting ? 'Export ho raha hai...' : '⬇ CSV Download'}
        </button>
      </div>

      {loadError && <LoadError message={loadError} onRetry={() => load(data?.pagination.page || 1)} />}
      {loading && !data && <div className="text-center py-8 text-gray-500">Loading...</div>}
      {data && data.customers.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-400">
          {query.trim() ? 'Koi customer nahi mila' : 'Abhi tak kisi bill par mobile number nahi daala gaya'}
        </div>
      )}

      <div className="space-y-2">
        {data?.customers.map(c => (
          <div key={c.id} className="card">
            <button onClick={() => toggle(c)} className="w-full text-left flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{c.name || 'Name nahi pata'}</div>
                <div className="text-xs text-gray-500">{c.phone}</div>
              </div>
              <div className="text-right">
                <div className="font-bold">{fmt(c.spend)}</div>
                <div className="text-xs text-gray-500">{c.visits} {c.visits === 1 ? 'bill' : 'bills'} · {formatDate(c.last_visit)}</div>
              </div>
            </button>
            {openId === c.id && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                {!bills[c.id] && <div className="text-sm text-gray-500">Loading...</div>}
                {bills[c.id]?.error && <div className="text-sm text-red-600">{bills[c.id].error}</div>}
                {Array.isArray(bills[c.id]) && bills[c.id].map(b => (
                  <div key={b.id} className="flex justify-between text-sm">
                    <span className={b.type === 'return' ? 'text-red-600' : ''}>
                      {b.type === 'return' ? 'Return ' : ''}{b.bill_number} · {formatDate(b.created_at)}
                      {b.customer_name ? ` · ${b.customer_name}` : ''}
                    </span>
                    <span className={b.type === 'return' ? 'text-red-600' : 'font-medium'}>
                      {b.type === 'return' ? '-' : ''}{fmt(b.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            onClick={() => load(data.pagination.page - 1)}
            disabled={data.pagination.page <= 1}
            className="px-4 min-h-[44px] rounded-lg bg-gray-100 font-medium disabled:opacity-40"
          >← Pichla</button>
          <span className="text-sm text-gray-600">Page {data.pagination.page} / {data.pagination.pages}</span>
          <button
            onClick={() => load(data.pagination.page + 1)}
            disabled={data.pagination.page >= data.pagination.pages}
            className="px-4 min-h-[44px] rounded-lg bg-gray-100 font-medium disabled:opacity-40"
          >Agla →</button>
        </div>
      )}
    </div>
  );
}
