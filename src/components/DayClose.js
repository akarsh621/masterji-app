'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api-client';
import CashOutForm from './CashOutForm';
import { REASON_LABELS } from '@/lib/ui-utils';

function formatTime(value) {
  if (!value || typeof value !== 'string') return '';
  const parsed = new Date(value.replace(' ', 'T') + '+05:30');
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

export default function DayClose() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingDrawer, setEditingDrawer] = useState(false);
  const [drawerInput, setDrawerInput] = useState('');
  const [editingPetty, setEditingPetty] = useState(false);
  const [pettyInput, setPettyInput] = useState('');

  const fetchData = () => {
    setLoading(true);
    api.getHisaab()
      .then(d => {
        setData(d);
        setDrawerInput(String(Math.round(d.cash_drawer)));
        setPettyInput(String(Math.round(d.petty_cash_target)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleSaveDrawer = async () => {
    const amt = parseFloat(drawerInput);
    if (!Number.isFinite(amt) || amt < 0) return;
    try {
      await api.setCashDrawer(amt);
      setEditingDrawer(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSavePetty = async () => {
    const amt = parseFloat(pettyInput);
    if (!Number.isFinite(amt) || amt < 0) return;
    try {
      await api.setPettyCashTarget(amt);
      setEditingPetty(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading && !data) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }
  if (!data) return null;

  const { cash_drawer, petty_cash_target, cash_in, cash_refunds, cash_out, cash_out_entries, payment_split, sales } = data;

  const sweepTotal = cash_out.sweep_total || 0;
  const manualTotal = (cash_out.manual_total || 0) + (cash_out.expense_total || 0)
    + (cash_out.supplier_total || 0) + (cash_out.owner_total || 0) + (cash_out.other_total || 0);
  const hasCashFlow = cash_in > 0 || cash_refunds > 0 || sweepTotal > 0 || manualTotal > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Aaj ka Hisaab</h2>
        <button onClick={fetchData} className="text-sm text-blue-600">Refresh ↻</button>
      </div>

      {/* Drawer balance */}
      <div className="card mb-4 text-center py-6">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Cash Drawer</div>
        <div className={`text-4xl font-bold ${cash_drawer >= 0 ? 'text-green-700' : 'text-red-600'}`}>
          ₹{Math.round(cash_drawer).toLocaleString('en-IN')}
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditingDrawer(true); setDrawerInput(String(Math.round(cash_drawer))); }}
            className="mt-2 text-xs text-blue-600 hover:underline"
          >
            Correct Karo
          </button>
        )}
      </div>

      {editingDrawer && isAdmin && (
        <div className="card mb-4 space-y-2">
          <label className="block text-xs text-gray-500">Drawer mein kitna hai? (count karke daalo)</label>
          <input
            type="number"
            value={drawerInput}
            onChange={e => setDrawerInput(e.target.value)}
            placeholder="Actual cash in drawer"
            className="input"
            min="0"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleSaveDrawer} className="btn-primary text-sm px-4">Save</button>
            <button onClick={() => setEditingDrawer(false)} className="text-sm text-gray-500 px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Cash flow */}
      <div className="card mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Aaj ka Cash Flow</h3>
        <div className="space-y-1.5">
          {cash_in > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Sales (cash)</span>
              <span className="text-sm font-medium text-green-700">+₹{Math.round(cash_in).toLocaleString('en-IN')}</span>
            </div>
          )}

          {cash_refunds > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Returns</span>
              <span className="text-sm font-medium text-red-600">-₹{Math.round(cash_refunds).toLocaleString('en-IN')}</span>
            </div>
          )}

          {sweepTotal > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Sweep Out</span>
              <span className="text-sm font-medium text-red-600">-₹{Math.round(sweepTotal).toLocaleString('en-IN')}</span>
            </div>
          )}

          {manualTotal > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Manual Cash Out</span>
              <span className="text-sm font-medium text-red-600">-₹{Math.round(manualTotal).toLocaleString('en-IN')}</span>
            </div>
          )}

          {!hasCashFlow && (
            <div className="text-sm text-gray-400 text-center py-2">Aaj koi cash movement nahi abhi tak</div>
          )}
        </div>

        {/* Petty cash target + drawer */}
        <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">Petty Cash Target</span>
              {isAdmin && !editingPetty && (
                <button
                  onClick={() => { setEditingPetty(true); setPettyInput(String(Math.round(petty_cash_target))); }}
                  className="text-xs text-blue-500"
                >
                  ✎
                </button>
              )}
            </div>
            <span className="text-sm font-medium text-gray-600">₹{Math.round(petty_cash_target).toLocaleString('en-IN')}</span>
          </div>
          {editingPetty && isAdmin && (
            <div className="flex gap-2 items-center pb-1">
              <input
                type="number"
                value={pettyInput}
                onChange={e => setPettyInput(e.target.value)}
                className="input flex-1 text-sm"
                min="0"
                autoFocus
              />
              <button onClick={handleSavePetty} className="text-xs font-medium text-white bg-blue-600 rounded px-2.5 py-1.5">Save</button>
              <button onClick={() => setEditingPetty(false)} className="text-xs text-gray-500">Cancel</button>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">Drawer Balance</span>
            <span className={`text-sm font-bold ${cash_drawer >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              ₹{Math.round(cash_drawer).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>

      {/* Cash out actions */}
      <div className="mb-4">
        <CashOutForm
          onSuccess={fetchData}
          cashDrawer={cash_drawer}
          pettyCashTarget={petty_cash_target}
          isAdmin={isAdmin}
        />
      </div>

      {/* Payment breakdown */}
      <div className="card mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Payment Breakdown</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center py-3 bg-green-50 rounded-lg">
            <div className="text-lg font-bold text-green-700">₹{Math.round(payment_split.cash_total).toLocaleString('en-IN')}</div>
            <div className="text-xs text-gray-500 mt-1">Cash</div>
          </div>
          <div className="text-center py-3 bg-purple-50 rounded-lg">
            <div className="text-lg font-bold text-purple-700">₹{Math.round(payment_split.upi_total).toLocaleString('en-IN')}</div>
            <div className="text-xs text-gray-500 mt-1">UPI</div>
          </div>
          <div className="text-center py-3 bg-teal-50 rounded-lg">
            <div className="text-lg font-bold text-teal-700">₹{Math.round(payment_split.card_total).toLocaleString('en-IN')}</div>
            <div className="text-xs text-gray-500 mt-1">Card</div>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between text-sm">
          <span className="text-gray-500">{sales.sale_count} sales{sales.return_count > 0 ? `, ${sales.return_count} returns` : ''} · {sales.total_items} pcs</span>
          <span className="font-medium">₹{Math.round(sales.net_revenue).toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Cash out entries log */}
      {cash_out_entries.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Aaj ke Cash Out</h3>
          <div className="space-y-2">
            {cash_out_entries.map(entry => (
              <div key={entry.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <span className="text-sm font-medium">{REASON_LABELS[entry.reason] || entry.reason}</span>
                  {entry.note && entry.reason !== 'sweep' && (
                    <span className="text-xs text-gray-400 ml-2">— {entry.note}</span>
                  )}
                  <div className="text-xs text-gray-400">{entry.recorded_by_name} · {formatTime(entry.created_at)}</div>
                </div>
                <span className="text-sm font-bold text-red-600">-₹{Math.round(entry.amount).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sales.total_bills === 0 && cash_out_entries.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          Aaj koi bhi bill nahi bana abhi tak.
        </div>
      )}
    </div>
  );
}
