'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/auth';
import { api, newRequestId } from '@/lib/api-client';
import { printReceipt } from '@/lib/print-receipt';
import BillPreview from '@/components/BillPreview';
import LoadError from '@/components/LoadError';
import { normalizeSavedBill } from '@/lib/bill-data';
import { getISTDateInputValue } from '@/lib/ui-utils';
import { isQuarterLocked, quarterLabel } from '@/lib/date-utils';
import { SALESMAN_CHANGE_MINUTES } from '@/lib/limits';

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

const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', mixed: 'Mixed' };
const PAYMENT_ICONS = { cash: '💵', upi: '📱', card: '💳', mixed: '💵+📱' };

export default function SalesHistory({ onEditBill }) {
  const { user } = useAuth();
  const [bills, setBills] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const defaultFilters = () => {
    const todayIst = getISTDateInputValue();
    return { from: todayIst, to: todayIst, payment_mode: '', salesman_id: '', q: '' };
  };
  const [filters, setFilters] = useState(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedBill, setExpandedBill] = useState(null);
  const [returnBillId, setReturnBillId] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [returnMode, setReturnMode] = useState('cash');
  // Share of the line price the customer actually paid (after any bill-level
  // discount / round-off). Refunds are worked out at this same share.
  const [returnPaidShare, setReturnPaidShare] = useState(1);
  const [returnRequestId, setReturnRequestId] = useState(null);
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);
  const [printStatuses, setPrintStatuses] = useState({});

  const [loadError, setLoadError] = useState('');
  const fetchSeq = useRef(0);

  // `f` lets a change apply immediately, before the filters state updates.
  const fetchBills = (page = 1, f = filters) => {
    // Only the latest request may update the list (fast filter/page taps).
    const seq = ++fetchSeq.current;
    setLoading(true);
    setLoadError('');
    const params = { page, limit: 20 };
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    if (f.payment_mode) params.payment_mode = f.payment_mode;
    if (f.salesman_id) params.salesman_id = f.salesman_id;
    if (f.q.trim()) params.q = f.q.trim();

    api.getBills(params)
      .then(d => {
        if (seq !== fetchSeq.current) return;
        setBills(d.bills);
        setPagination(d.pagination);
      })
      .catch(err => { if (seq === fetchSeq.current) setLoadError(err.message); })
      .finally(() => { if (seq === fetchSeq.current) setLoading(false); });
  };

  useEffect(() => { fetchBills(); }, []);
  useEffect(() => {
    if (user.role !== 'admin') return;
    api.getUsers()
      .then(d => {
        const list = (d.users || []).filter(u => u.active);
        setSalesmen(list);
      })
      .catch(() => {});
  }, [user.role]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchBills(1);
  };

  // Filters apply as soon as they change; no extra button to remember.
  const applyFilter = (change) => {
    const next = { ...filters, ...change };
    setFilters(next);
    fetchBills(1, next);
  };

  // Clearing the search (✕, or deleting the text) goes straight back to the normal list.
  const setSearch = (q) => {
    const next = { ...filters, q };
    setFilters(next);
    if (!q.trim() && filters.q.trim()) fetchBills(1, next);
  };

  const shortDate = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const filterSummary = (() => {
    const todayYmd = getISTDateInputValue();
    const parts = [];
    if (filters.from === todayYmd && filters.to === todayYmd) parts.push('Aaj');
    else if (filters.from && filters.from === filters.to) parts.push(shortDate(filters.from));
    else if (filters.from || filters.to) parts.push(`${filters.from ? shortDate(filters.from) : '…'} – ${filters.to ? shortDate(filters.to) : '…'}`);
    else parts.push('All dates');
    if (filters.salesman_id) parts.push(salesmen.find(s => String(s.id) === filters.salesman_id)?.name || 'Salesman');
    if (filters.payment_mode) parts.push(PAYMENT_LABELS[filters.payment_mode] || filters.payment_mode);
    return parts.join(' · ');
  })();
  const d0 = defaultFilters();
  const filtersChanged = filters.from !== d0.from || filters.to !== d0.to || filters.salesman_id || filters.payment_mode;

  const handleDelete = async (bill) => {
    if (!confirm(`${bill.bill_number} cancel karna hai? Ye wapas nahi hoga.`)) return;
    try {
      await api.deleteBill(bill.id);
      fetchBills(pagination?.page || 1);
    } catch (err) {
      alert(err.message);
    }
  };

  // "Edit Bill": open this bill in Naya Bill for correction. Admin edits it in
  // place (same bill number); a salesman's edit cancels it and saves a new,
  // linked bill in one step. Cancel Bill only ever cancels.
  const startEditBill = (bill) => {
    if (!onEditBill) return;
    onEditBill({
      replaces: { id: bill.id, bill_number: bill.bill_number, inPlace: user.role === 'admin' },
      customer_phone: bill.customer_phone || '',
      customer_name: bill.customer_name || '',
      salesman_id: bill.salesman_id,
      final_price: bill.discount_amount > 0 ? bill.total : null,
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
  };

  const startReturn = (bill) => {
    setReturnBillId(bill.id);
    setReturnItems(bill.items.map(i => ({
      ...i,
      returnQty: 0,
      maxQty: Math.max(0, i.quantity - (i.returned_qty || 0)),
    })));
    setReturnPaidShare(bill.subtotal > 0 ? bill.total / bill.subtotal : 1);
    setReturnRequestId(newRequestId());
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
        items: returningItems.map(i => ({ bill_item_id: i.id, quantity: i.returnQty })),
        refund_mode: returnMode,
        client_request_id: returnRequestId,
      });
      setReturnBillId(null);
      setReturnItems([]);
      fetchBills(pagination?.page || 1);
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

      <form onSubmit={handleSearch} className="card mb-4 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={filters.q}
              onChange={e => setSearch(e.target.value)}
              placeholder="Bill no., mobile, customer name"
              className="input pr-10"
            />
            {filters.q && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Search hatao"
                className="absolute right-0 top-0 h-full px-3 text-lg text-gray-400"
              >
                ✕
              </button>
            )}
          </div>
          <button type="submit" className="btn-primary text-sm px-4">
            Search
          </button>
        </div>
        {filters.q.trim() ? (
          <p className="text-xs text-gray-500">Sab dates mein search hoga — filters band</p>
        ) : (
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            className="w-full flex items-center justify-between text-sm py-1.5"
          >
            <span className="text-gray-500">Filters: <span className="font-medium text-gray-900">{filterSummary}</span></span>
            <span className="text-blue-600 text-xs font-medium">{showFilters ? 'Band karo ▲' : 'Badlo ▼'}</span>
          </button>
        )}
        {showFilters && !filters.q.trim() && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={e => applyFilter({ from: e.target.value })}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={e => applyFilter({ to: e.target.value })}
                  className="input text-sm"
                />
              </div>
            </div>
            <div className={`grid gap-2 ${user.role === 'admin' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {user.role === 'admin' && (
                <select
                  value={filters.salesman_id}
                  onChange={e => applyFilter({ salesman_id: e.target.value })}
                  className="input text-sm"
                >
                  <option value="">All salesmen</option>
                  {salesmen.map(s => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                </select>
              )}
              <select
                value={filters.payment_mode}
                onChange={e => applyFilter({ payment_mode: e.target.value })}
                className="input text-sm"
              >
                <option value="">All payments</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            {filtersChanged && (
              <button
                type="button"
                onClick={() => applyFilter({ ...defaultFilters(), q: '' })}
                className="text-sm font-medium text-blue-600 py-1"
              >
                Reset — sirf aaj ke bills
              </button>
            )}
          </div>
        )}
      </form>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : bills.length === 0 ? (
        loadError
          ? <LoadError message={loadError} onRetry={() => fetchBills(pagination?.page || 1)} />
          : <div className="text-center py-8 text-gray-400">Koi bill nahi mila</div>
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
              // Quarter already closed for GST filing: no cancel or edit, only Return.
              const quarterLocked = isQuarterLocked(bill.created_at.slice(0, 10));
              const isBackdated = typeof bill.notes === 'string' && bill.notes.includes('[Backdated]');
              const minutesOld = getMinutesSinceCreation(bill.created_at);
              const canSalesmanVoid = user.role === 'salesman' && bill.salesman_id === user.id && minutesOld <= SALESMAN_CHANGE_MINUTES;

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
                    {(bill.customer_name || bill.customer_phone) && (
                      <div className="text-xs text-gray-600">
                        👤 {[bill.customer_name, bill.customer_phone].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {isReturn && bill.original_bill_number && (
                      <div className="text-xs text-red-600">← {bill.original_bill_number} ka return</div>
                    )}
                    {bill.replaces_bill_number && (
                      <div className="text-xs text-amber-700">{bill.replaces_bill_number} ki jagah</div>
                    )}
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

                    <div className="mt-3 pt-2 border-t border-gray-100">
                      <div className="flex flex-col gap-1.5">
                        <div className="grid grid-cols-4 gap-1">
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
                            className="text-xs font-medium px-1 py-1.5 min-h-[36px] rounded-full border whitespace-nowrap transition-colors text-blue-700 border-blue-300 bg-blue-50 hover:bg-blue-100 active:bg-blue-200"
                          >
                            {printStatuses[bill.id] === 'queued' ? 'Bhej Diya ✓' : printStatuses[bill.id] === 'failed' ? 'Retry' : 'Print Bill'}
                          </button>
                        {!isReturn && (
                          <button
                            onClick={() => startReturn(bill)}
                            className="text-xs font-medium px-1 py-1.5 min-h-[36px] rounded-full border whitespace-nowrap transition-colors text-orange-700 border-orange-300 bg-orange-50 hover:bg-orange-100 active:bg-orange-200"
                          >
                            Return
                          </button>
                        )}
                        {!isReturn && !quarterLocked && (user.role === 'admin' || canSalesmanVoid) && (
                          <button
                            onClick={() => startEditBill(bill)}
                            className="text-xs font-medium px-1 py-1.5 min-h-[36px] rounded-full border whitespace-nowrap transition-colors text-gray-700 border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100"
                          >
                            Edit Bill
                          </button>
                        )}
                        {!quarterLocked && (user.role === 'admin' || canSalesmanVoid) && (
                          <button
                            onClick={() => handleDelete(bill)}
                            className="text-xs font-medium px-1 py-1.5 min-h-[36px] rounded-full border whitespace-nowrap transition-colors text-red-600 border-red-200 bg-white hover:bg-red-50 active:bg-red-100"
                          >
                            Cancel Bill
                          </button>
                        )}
                        </div>
                        {quarterLocked && user.role === 'admin' && (
                          <p className="text-xs text-gray-500">
                            {quarterLabel(bill.created_at.slice(0, 10))} quarter GST ke liye band hai — cancel/edit nahi, sirf Return.
                          </p>
                        )}
                        <button
                          onClick={() => printReceipt(bill)}
                          className="text-[10px] text-gray-400 underline"
                        >
                          Yahan Print Karo
                        </button>
                      </div>
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
                        <span className={`text-sm ${item.maxQty === 0 ? 'text-gray-400' : ''}`}>
                          {item.category_name} {item.maxQty === 0 ? '(return ho chuka)' : `(max ${item.maxQty})`}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setReturnItems(prev => prev.map((it, idx) =>
                              idx === i ? { ...it, returnQty: Math.max(0, it.returnQty - 1) } : it
                            ))}
                            className="w-10 h-10 rounded-lg bg-gray-200 text-base font-bold"
                          >-</button>
                          <span className="text-sm font-medium w-6 text-center">{item.returnQty}</span>
                          <button
                            onClick={() => setReturnItems(prev => prev.map((it, idx) =>
                              idx === i ? { ...it, returnQty: Math.min(it.maxQty, it.returnQty + 1) } : it
                            ))}
                            className="w-10 h-10 rounded-lg bg-gray-200 text-base font-bold"
                          >+</button>
                        </div>
                      </div>
                    ))}
                    <div className="mt-2">
                      <label className="text-xs text-gray-500">Refund kaise?</label>
                      <div className="flex gap-2 mt-1">
                        {['cash', 'upi'].map(m => (
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
                          s + (i.returnQty > 0 ? (i.amount / i.quantity) * i.returnQty * returnPaidShare : 0), 0
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
            <div className="flex items-center justify-center gap-3 pt-4">
              <button
                onClick={() => fetchBills(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-4 min-h-[44px] rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-40"
              >
                ← Pichla
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} / {pagination.pages}
              </span>
              <button
                onClick={() => fetchBills(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-4 min-h-[44px] rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-40"
              >
                Agla →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
