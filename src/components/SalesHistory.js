'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api-client';
import { printReceipt } from '@/lib/print-receipt';
import BillPreview from '@/components/BillPreview';
import { normalizeSavedBill } from '@/lib/bill-data';
import { getISTDateInputValue } from '@/lib/ui-utils';

function formatBillTime(value) {
  if (!value || typeof value !== 'string') return '--';
  const parsed = new Date(value.replace(' ', 'T') + '+05:30');
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function getBillISTDate(value) {
  if (!value || typeof value !== 'string') return '';
  // created_at is stored as 'YYYY-MM-DD HH:MM:SS' in IST; take the date portion directly.
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatDayLabel(ymd, todayYmd) {
  if (!ymd) return '';
  if (ymd === todayYmd) return 'Aaj';
  const base = new Date(todayYmd + 'T00:00:00Z');
  const yesterday = new Date(base);
  yesterday.setUTCDate(base.getUTCDate() - 1);
  const yYmd = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth()+1).padStart(2,'0')}-${String(yesterday.getUTCDate()).padStart(2,'0')}`;
  if (ymd === yYmd) return 'Kal';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_NAMES[dt.getUTCDay()]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function getMinutesSinceCreation(createdAt) {
  if (!createdAt) return Infinity;
  const parsed = new Date(createdAt.replace(' ', 'T') + '+05:30');
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return (Date.now() - parsed.getTime()) / 60000;
}

const PAYMENT_ICONS = { cash: '💵', upi: '📱', card: '💳', mixed: '💵+📱' };

export default function SalesHistory({ onVoidAndRecreate }) {
  const { user } = useAuth();
  const [bills, setBills] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(() => {
    const todayIst = getISTDateInputValue();
    return {
      from: todayIst,
      to: todayIst,
      payment_mode: '',
      salesman_id: '',
    };
  });
  const [expandedBill, setExpandedBill] = useState(null);
  const [returnBillId, setReturnBillId] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [returnMode, setReturnMode] = useState('cash');
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);
  const [printStatuses, setPrintStatuses] = useState({});

  const fetchBills = (page = 1) => {
    setLoading(true);
    const params = { page, limit: 20 };
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.payment_mode) params.payment_mode = filters.payment_mode;
    if (filters.salesman_id) params.salesman_id = filters.salesman_id;

    api.getBills(params)
      .then(d => {
        setBills(d.bills);
        setPagination(d.pagination);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBills(); }, []);
  useEffect(() => {
    if (user.role !== 'admin') return;
    api.getUsers()
      .then(d => {
        const list = (d.users || []).filter(u => u.role === 'salesman');
        setSalesmen(list);
      })
      .catch(() => {});
  }, [user.role]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchBills(1);
  };

  const handleDelete = async (bill) => {
    const msg = user.role === 'admin'
      ? `${bill.bill_number} void karna hai? Ye recover nahi hoga.`
      : `${bill.bill_number} cancel karna hai?`;
    if (!confirm(msg)) return;
    try {
      await api.deleteBill(bill.id);
      fetchBills();
      if (onVoidAndRecreate) {
        const shouldRecreate = confirm('Iske badle naya bill banao?');
        if (shouldRecreate) {
          onVoidAndRecreate({
            items: bill.items.map(i => {
              const pricePerPiece = i.quantity > 0 ? i.amount / i.quantity : 0;
              const mrp = i.mrp && i.mrp > 0 ? i.mrp : pricePerPiece;
              const discountPercent = mrp > 0 && pricePerPiece > 0
                ? Math.round((1 - pricePerPiece / mrp) * 100)
                : 0;
              return {
                category_id: i.category_id,
                category_name: i.category_name,
                group_name: i.group_name,
                mrp,
                discount_percent: discountPercent,
                price_per_piece: pricePerPiece,
                quantity: i.quantity,
                amount: i.amount,
              };
            }),
            payments: bill.payments || [],
            notes: bill.notes || '',
          });
        }
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const startReturn = (bill) => {
    setReturnBillId(bill.id);
    setReturnItems(bill.items.map(i => ({ ...i, returnQty: 0 })));
    setReturnMode('cash');
    setReturnError('');
  };

  const submitReturn = async () => {
    const returningItems = returnItems.filter(i => i.returnQty > 0);
    if (returningItems.length === 0) {
      setReturnError('Kam se kam ek item select karo');
      return;
    }
    setReturning(true);
    setReturnError('');
    try {
      await api.returnBill(returnBillId, {
        items: returningItems.map(i => ({
          category_id: i.category_id,
          quantity: i.returnQty,
          amount: Math.round((i.amount / i.quantity) * i.returnQty * 100) / 100,
        })),
        refund_mode: returnMode,
      });
      setReturnBillId(null);
      setReturnItems([]);
      fetchBills();
    } catch (err) {
      setReturnError(err.message);
    } finally {
      setReturning(false);
    }
  };

  const formatPayments = (bill) => {
    if (!bill.payments || bill.payments.length <= 1) {
      return `${PAYMENT_ICONS[bill.payment_mode] || ''} ${(bill.payment_mode || '').toUpperCase()}`;
    }
    return bill.payments.map(p =>
      `${PAYMENT_ICONS[p.mode] || ''} ₹${Math.round(p.amount)}`
    ).join(' + ');
  };

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Bill Book</h2>

      <form onSubmit={handleSearch} className="card mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="input text-sm"
            />
          </div>
        </div>
        <div className={`grid gap-2 ${user.role === 'admin' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
          {user.role === 'admin' && (
            <select
              value={filters.salesman_id}
              onChange={e => setFilters(f => ({ ...f, salesman_id: e.target.value }))}
              className="input text-sm"
            >
              <option value="">Sab Salesman</option>
              {salesmen.map(s => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          )}
          <select
            value={filters.payment_mode}
            onChange={e => setFilters(f => ({ ...f, payment_mode: e.target.value }))}
            className="input text-sm"
          >
            <option value="">Sab Payment</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="mixed">Mixed</option>
          </select>
          <button type="submit" className="btn-primary text-sm">
            Search
          </button>
        </div>
      </form>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : bills.length === 0 ? (
        <div className="text-center py-8 text-gray-400">Koi bill nahi mila</div>
      ) : (
        <div className="space-y-2">
          {(() => {
            const todayYmd = getISTDateInputValue();
            let lastDate = null;
            const nodes = [];
            for (const bill of bills) {
              const billDate = getBillISTDate(bill.created_at);
              if (billDate && billDate !== lastDate) {
                nodes.push(
                  <div
                    key={`sep-${billDate}`}
                    className="text-xs font-semibold text-gray-500 px-2 py-1 bg-gray-50 rounded border border-gray-100 mt-2 first:mt-0"
                  >
                    {formatDayLabel(billDate, todayYmd)}
                  </div>
                );
                lastDate = billDate;
              }
              const isReturn = bill.type === 'return';
              const isBackdated = typeof bill.notes === 'string' && bill.notes.includes('[Backdated]');
              const minutesOld = getMinutesSinceCreation(bill.created_at);
              const canSalesmanVoid = user.role === 'salesman' && bill.salesman_id === user.id && minutesOld <= 15;

              nodes.push(
              <div key={bill.id} className={`card ${isReturn ? 'border-l-4 border-red-400 bg-red-50/30' : ''}`}>
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedBill(expandedBill === bill.id ? null : bill.id)}
                >
                  <div>
                    <div className="font-medium flex items-center gap-1.5 flex-wrap">
                      {isReturn && <span className="text-red-600 text-xs font-semibold">RETURN</span>}
                      <span>{bill.bill_number}</span>
                      {isBackdated && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Backdated
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {bill.salesman_name} • {formatPayments(bill)}
                      {bill.mrp_total > 0 && bill.mrp_total > bill.total && (
                        <span className="text-orange-600 font-semibold"> • ₹{Math.round(bill.mrp_total - bill.total)} off</span>
                      )}
                      {!bill.mrp_total && bill.discount_percent > 0 && ` • ${bill.discount_percent}% off`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${isReturn ? 'text-red-600' : ''}`}>
                      {isReturn ? '-' : ''}₹{Math.round(bill.total).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatBillTime(bill.created_at)}
                    </div>
                  </div>
                </div>

                {expandedBill === bill.id && (() => {
                  const nb = normalizeSavedBill(bill);
                  return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <BillPreview
                      items={nb.items}
                      mrpTotal={nb.mrpTotal}
                      sellingTotal={nb.sellingTotal}
                      total={nb.total}
                      totalDiscount={nb.totalDiscount}
                      totalDiscountPercent={nb.totalDiscountPercent}
                      payments={nb.payments}
                      notes={nb.notes}
                    />

                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              setPrintStatuses(prev => ({ ...prev, [bill.id]: 'sending' }));
                              try {
                                await api.queuePrint(bill.id);
                                setPrintStatuses(prev => ({ ...prev, [bill.id]: 'queued' }));
                              } catch {
                                setPrintStatuses(prev => ({ ...prev, [bill.id]: 'failed' }));
                              }
                            }}
                            disabled={printStatuses[bill.id] === 'sending'}
                            className="text-xs font-medium text-blue-700 border border-blue-300 bg-blue-50 px-3 py-2 min-h-[44px] rounded-lg hover:bg-blue-100 active:bg-blue-200 transition-colors"
                          >
                            {printStatuses[bill.id] === 'queued' ? '✅ Bhej Diya' : printStatuses[bill.id] === 'failed' ? '❌ Retry' : '🖨 Print Bill'}
                          </button>
                        {!isReturn && (
                          <button
                            onClick={() => startReturn(bill)}
                            className="text-xs font-medium text-orange-700 border border-orange-300 bg-orange-50 px-3 py-2 min-h-[44px] rounded-lg hover:bg-orange-100 active:bg-orange-200 transition-colors"
                          >
                            Return / Exchange
                          </button>
                        )}
                        </div>
                        <button
                          onClick={() => printReceipt(bill)}
                          className="text-[10px] text-gray-400 underline"
                        >
                          Yahan Print Karo
                        </button>
                      </div>
                      {(user.role === 'admin' || canSalesmanVoid) && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-red-500">Galat hai?</span>
                          <button
                            onClick={() => handleDelete(bill)}
                            className="bg-red-600 text-white text-xs font-medium px-3 py-2 min-h-[44px] rounded-lg hover:bg-red-700 transition-colors"
                          >
                            Delete karo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}

                {returnBillId === bill.id && (
                  <div className="mt-3 pt-3 border-t border-orange-200 bg-orange-50/50 rounded-lg p-3">
                    <h4 className="text-sm font-bold text-orange-700 mb-2">Return Items Chuno</h4>
                    {returnError && <p className="text-xs text-red-600 mb-2">{returnError}</p>}
                    {returnItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5">
                        <span className="text-sm">{item.category_name} (max {item.quantity})</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setReturnItems(prev => prev.map((it, idx) =>
                              idx === i ? { ...it, returnQty: Math.max(0, it.returnQty - 1) } : it
                            ))}
                            className="w-7 h-7 rounded bg-gray-200 text-sm font-bold"
                          >-</button>
                          <span className="text-sm font-medium w-6 text-center">{item.returnQty}</span>
                          <button
                            onClick={() => setReturnItems(prev => prev.map((it, idx) =>
                              idx === i ? { ...it, returnQty: Math.min(it.quantity, it.returnQty + 1) } : it
                            ))}
                            className="w-7 h-7 rounded bg-gray-200 text-sm font-bold"
                          >+</button>
                        </div>
                      </div>
                    ))}
                    <div className="mt-2">
                      <label className="text-xs text-gray-500">Refund kaise?</label>
                      <div className="flex gap-2 mt-1">
                        {['cash', 'upi', 'card'].map(m => (
                          <button
                            key={m}
                            onClick={() => setReturnMode(m)}
                            className={`flex-1 py-1.5 rounded text-xs font-medium ${
                              returnMode === m ? 'bg-orange-600 text-white' : 'bg-white border border-gray-200'
                            }`}
                          >
                            {PAYMENT_ICONS[m]} {m.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    {returnItems.some(i => i.returnQty > 0) && (
                      <p className="text-sm font-medium text-orange-700 mt-2">
                        Refund: ₹{Math.round(returnItems.reduce((s, i) =>
                          s + (i.returnQty > 0 ? (i.amount / i.quantity) * i.returnQty : 0), 0
                        ))}
                      </p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { setReturnBillId(null); setReturnItems([]); }}
                        className="flex-1 py-2 rounded-lg text-sm border border-gray-300 text-gray-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={submitReturn}
                        disabled={returning}
                        className="flex-1 py-2 rounded-lg text-sm bg-orange-600 text-white font-medium"
                      >
                        {returning ? 'Processing...' : 'Return Confirm'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            }
            return nodes;
          })()}

          {pagination && pagination.pages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              {Array.from({ length: Math.min(pagination.pages, 10) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => fetchBills(p)}
                  className={`w-8 h-8 rounded text-sm ${
                    p === pagination.page
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
