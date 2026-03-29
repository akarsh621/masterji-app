'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api-client';
import { printReceipt } from '@/lib/print-receipt';
import BillPreview from '@/components/BillPreview';

const GROUP_LABELS = {
  women: 'Ladies',
  kids: 'Kids',
  men: 'Gents',
  other: 'Other',
};

const GROUP_COLORS = {
  women: 'bg-pink-50 text-pink-700 border-pink-200',
  kids: 'bg-amber-50 text-amber-700 border-amber-200',
  men: 'bg-blue-50 text-blue-700 border-blue-200',
  other: 'bg-gray-50 text-gray-700 border-gray-200',
};

const SELECTED_GROUP_COLORS = {
  women: 'bg-pink-600 text-white border-pink-600',
  kids: 'bg-amber-600 text-white border-amber-600',
  men: 'bg-blue-600 text-white border-blue-600',
  other: 'bg-gray-600 text-white border-gray-600',
};

const PAYMENT_MODES = [
  { id: 'cash', label: '💵 Cash', color: 'bg-green-600' },
  { id: 'upi', label: '📱 UPI', color: 'bg-purple-600' },
  { id: 'card', label: '💳 Card', color: 'bg-teal-600' },
];

export default function NewBill({ prefillData, onPrefillConsumed }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [salesmen, setSalesmen] = useState([]);
  const [selectedSalesmanId, setSelectedSalesmanId] = useState(null);

  const [categories, setCategories] = useState(null);
  const [flatCategories, setFlatCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [items, setItems] = useState([]);

  const [mrpInput, setMrpInput] = useState('');
  const [discPercInput, setDiscPercInput] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const mrpRef = useRef(null);

  const [screen, setScreen] = useState('items');

  const [primaryMode, setPrimaryMode] = useState('cash');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMode, setSplitMode] = useState('upi');
  const [splitAmount, setSplitAmount] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [discountMode, setDiscountMode] = useState('none');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [printStatus, setPrintStatus] = useState(null);
  const [error, setError] = useState('');
  const submitLock = useRef(false);

  useEffect(() => {
    api.getCategories().then(d => {
      setCategories(d.grouped);
      const flat = [];
      for (const group of Object.keys(d.grouped)) {
        for (const cat of d.grouped[group]) {
          flat.push({ ...cat, group_name: group });
        }
      }
      setFlatCategories(flat);
    }).catch(() => {});
    if (isAdmin) {
      api.getUsers().then(d => {
        const list = (d.users || []).filter(u => u.role === 'salesman' && u.active);
        setSalesmen(list);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (prefillData && flatCategories.length > 0) {
      setItems(prefillData.items || []);
      if (prefillData.payments?.length === 1) {
        setPrimaryMode(prefillData.payments[0].mode);
      } else if (prefillData.payments?.length > 1) {
        setPrimaryMode(prefillData.payments[0].mode);
        setSplitEnabled(true);
        setSplitMode(prefillData.payments[1].mode);
        setSplitAmount(String(prefillData.payments[1].amount));
      }
      if (prefillData.notes) setNotes(prefillData.notes);
      setScreen('items');
      if (onPrefillConsumed) onPrefillConsumed();
    }
  }, [prefillData, flatCategories]);

  const getSelectedCategory = () => flatCategories.find(c => c.id === selectedCategoryId);

  // Live calculation from MRP + Discount %
  const parsedMrp = parseFloat(mrpInput) || 0;
  const parsedDiscPerc = parseFloat(discPercInput) || 0;
  const computedSellingPrice = parsedMrp > 0 ? Math.round(parsedMrp * (1 - parsedDiscPerc / 100)) : 0;

  const addItem = () => {
    const cat = getSelectedCategory();
    if (!cat || parsedMrp <= 0 || computedSellingPrice <= 0) return;
    const qty = parseInt(qtyInput) || 1;

    setItems(prev => [...prev, {
      category_id: cat.id,
      category_name: cat.name,
      group_name: cat.group_name,
      mrp: parsedMrp,
      discount_percent: parsedDiscPerc,
      price_per_piece: computedSellingPrice,
      quantity: qty,
      amount: computedSellingPrice * qty,
    }]);

    setMrpInput('');
    setDiscPercInput('');
    setQtyInput('1');
    setSelectedCategoryId(null);
  };

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const mrpTotal = items.reduce((s, i) => s + (i.mrp * i.quantity), 0);
  const sellingTotal = items.reduce((s, i) => s + i.amount, 0);
  const totalPieces = items.reduce((s, i) => s + i.quantity, 0);
  const itemDiscount = mrpTotal - sellingTotal;
  const itemDiscountPercent = mrpTotal > 0 ? Math.round((itemDiscount / mrpTotal) * 100) : 0;

  let billDiscountAmount = 0;
  let billDiscountPercent = 0;
  const rawBillDiscount = parseFloat(discountInput) || 0;

  if (discountMode === 'percent') {
    billDiscountPercent = Math.min(Math.round(rawBillDiscount), 100);
    billDiscountAmount = Math.round(sellingTotal * (billDiscountPercent / 100));
  } else if (discountMode === 'final' && rawBillDiscount > 0 && rawBillDiscount < sellingTotal) {
    billDiscountAmount = Math.round(sellingTotal - rawBillDiscount);
    billDiscountPercent = sellingTotal > 0 ? Math.round((billDiscountAmount / sellingTotal) * 100) : 0;
  }

  const total = sellingTotal - billDiscountAmount;
  const totalDiscount = itemDiscount + billDiscountAmount;
  const totalDiscountPercent = mrpTotal > 0 ? Math.round((totalDiscount / mrpTotal) * 100) : 0;

  const buildPayments = () => {
    if (!splitEnabled || !splitAmount) {
      return [{ mode: primaryMode, amount: total }];
    }
    const splitAmt = Math.round(parseFloat(splitAmount) * 100) / 100;
    if (splitAmt <= 0 || splitAmt >= total) {
      return [{ mode: primaryMode, amount: total }];
    }
    const primaryAmt = Math.round((total - splitAmt) * 100) / 100;
    return [
      { mode: primaryMode, amount: primaryAmt },
      { mode: splitMode, amount: splitAmt },
    ];
  };

  const submitBill = async () => {
    if (items.length === 0 || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const payments = buildPayments();
      const billPayload = {
        items: items.map(i => ({
          category_id: i.category_id,
          mrp: i.mrp,
          quantity: i.quantity,
          amount: i.amount,
        })),
        payments,
        mrp_total: mrpTotal,
        discount_percent: billDiscountPercent,
        discount_amount: billDiscountAmount,
        notes,
      };
      if (isAdmin && selectedSalesmanId) {
        billPayload.salesman_id = selectedSalesmanId;
      }
      const result = await api.createBill(billPayload);
      setSuccess(result);
      setItems([]);
      setDiscountInput('');
      setDiscountMode('none');
      setNotes('');
      setShowNotes(false);
      setPrimaryMode('cash');
      setSplitEnabled(false);
      setSplitAmount('');
      setScreen('items');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
      setTimeout(() => { submitLock.current = false; }, 2000);
    }
  };

  if (success) {
    const handleQueuePrint = async () => {
      setPrintStatus('sending');
      try {
        await api.queuePrint(success.bill_id);
        setPrintStatus('queued');
      } catch {
        setPrintStatus('queue-failed');
      }
    };

    const handleDirectPrint = () => {
      printReceipt(success, {
        onComplete: () => setPrintStatus('printed'),
      });
      setPrintStatus('printing');
    };

    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">✓</div>
        <h2 className="text-xl font-bold text-green-700 mb-2">Bill Ban Gaya!</h2>
        <p className="text-gray-600 mb-1">{success.bill_number}</p>
        <p className="text-2xl font-bold text-gray-900 mb-4">₹{success.total}</p>

        {printStatus === 'queued' && (
          <div className="mb-4 p-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
            ✅ Printer ko bhej diya!
          </div>
        )}
        {printStatus === 'printed' && (
          <div className="mb-4 p-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
            ✅ Print Ho Gaya!
          </div>
        )}
        {printStatus === 'queue-failed' && (
          <div className="mb-4 p-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium">
            Print queue mein bhejne mein dikkat aayi
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleQueuePrint}
              disabled={printStatus === 'sending'}
              className="btn-secondary"
            >
              {printStatus === 'queued' ? '🖨 Phir Se Print Karo' : '🖨 Print Bill'}
            </button>
            <button onClick={() => { setSuccess(null); setPrintStatus(null); }} className="btn-primary">
              Naya Bill Banao
            </button>
          </div>
          <button
            onClick={handleDirectPrint}
            className="text-xs text-gray-400 underline"
          >
            Yahan Print Karo
          </button>
        </div>
      </div>
    );
  }

  if (!categories) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  const selectedCat = getSelectedCategory();
  const availableSplitModes = PAYMENT_MODES.filter(m => m.id !== primaryMode);
  const canAdd = parsedMrp > 0 && computedSellingPrice > 0 && selectedCategoryId;

  // ==================== SCREEN 1: ITEM BUILDING ====================
  if (screen === 'items') {
    return (
      <div>
        <h2 className="text-lg font-bold mb-3">Naya Bill</h2>

        {error && (
          <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {isAdmin && salesmen.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill Kiske Naam</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedSalesmanId(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  !selectedSalesmanId ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                Owner
              </button>
              {salesmen.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSalesmanId(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedSalesmanId === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-700 border-gray-200'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category bar */}
        {Object.entries(categories).map(([group, cats]) => (
          <div key={group} className="mb-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {GROUP_LABELS[group] || group}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cats.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    setTimeout(() => mrpRef.current?.focus(), 100);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 ${
                    selectedCategoryId === cat.id
                      ? SELECTED_GROUP_COLORS[group] || SELECTED_GROUP_COLORS.other
                      : GROUP_COLORS[group] || GROUP_COLORS.other
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Selected category label + input section -- only when a category is tapped */}
        {selectedCat && (
          <>
            <div className="py-2 border-t border-gray-200 mt-1 mb-1">
              <span className="text-sm font-semibold text-gray-900">
                Adding: <strong>{selectedCat.name}</strong>
              </span>
              <span className="text-xs text-gray-500 ml-1">
                ({GROUP_LABELS[selectedCat.group_name] || selectedCat.group_name})
              </span>
            </div>

            <div className="card space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-0.5">MRP (₹)</label>
                  <input
                    ref={mrpRef}
                    type="number"
                    value={mrpInput}
                    onChange={e => setMrpInput(e.target.value)}
                    placeholder="Tag price"
                    className="input"
                    min="1"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-0.5">Discount %</label>
                  <input
                    type="number"
                    value={discPercInput}
                    onChange={e => setDiscPercInput(e.target.value)}
                    placeholder="0"
                    className="input"
                    min="0"
                    max="100"
                    onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
                  />
                </div>
              </div>

              {/* Live calculation */}
              <div className="text-sm font-semibold text-orange-600 min-h-[20px]">
                {parsedMrp > 0 && parsedDiscPerc > 0 && (
                  <>₹{parsedMrp} - {parsedDiscPerc}% = ₹{computedSellingPrice}</>
                )}
                {parsedMrp > 0 && parsedDiscPerc === 0 && (
                  <>₹{parsedMrp} (no discount)</>
                )}
              </div>

              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
                  <div className="flex gap-1">
                    {[1, 2].map(n => (
                      <button
                        key={n}
                        onClick={() => setQtyInput(String(n))}
                        className={`w-9 h-10 rounded-lg text-sm font-medium transition-colors ${
                          parseInt(qtyInput) === n
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <select
                      value={parseInt(qtyInput) > 2 ? qtyInput : ''}
                      onChange={e => setQtyInput(e.target.value || '1')}
                      className={`w-10 h-10 rounded-lg text-sm font-medium text-center appearance-none cursor-pointer ${
                        parseInt(qtyInput) > 2
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      <option value="" disabled>{parseInt(qtyInput) > 2 ? qtyInput : '3+'}</option>
                      {Array.from({ length: 18 }, (_, i) => i + 3).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={addItem}
                  disabled={!canAdd}
                  className="flex-1 h-10 bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                >
                  + Add
                </button>
              </div>
            </div>
          </>
        )}

        {/* Items list */}
        {items.length === 0 && !selectedCat ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            ↑ Category chuno — phir item add karo
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Items add karo — woh yahan dikhenge
          </div>
        ) : (
          <div className="card mt-3">
            {/* Header: total count */}
            <div className="flex items-center text-sm font-medium text-gray-500 mb-2">
              <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mr-1.5">
                {totalPieces}
              </span>
              items
            </div>

            {/* Item rows */}
            {items.map((item, idx) => (
              <div key={idx} className="py-2 border-b border-gray-50 last:border-0">
                {/* Line 1: number + category + qty ... Hatao */}
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className="text-xs text-gray-400 font-medium">{idx + 1}.</span>
                    <span className="text-sm font-bold text-gray-900">{item.category_name}</span>
                    <span className="text-xs text-gray-500 font-medium">×{item.quantity}</span>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-red-500 hover:text-red-700 text-xs font-medium px-1.5 py-0.5 rounded bg-red-50 hover:bg-red-100"
                  >
                    Hatao
                  </button>
                </div>
                {/* Line 2: calculation ... final price */}
                <div className="flex items-center justify-between mt-0.5 pl-5">
                  <span className="text-xs text-gray-700">
                    {item.discount_percent > 0
                      ? `₹${item.mrp} - ${item.discount_percent}% = ₹${item.price_per_piece}${item.quantity > 1 ? ' × ' + item.quantity : ''}`
                      : `₹${item.mrp}${item.quantity > 1 ? ' × ' + item.quantity : ''}`
                    }
                  </span>
                  <span className="text-[15px] font-bold text-gray-900">
                    ₹{item.amount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            ))}

            {/* Summary */}
            <div className="pt-2 mt-2 border-t-2 border-gray-200 space-y-0.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">MRP Total</span>
                <span className="text-gray-500">₹{mrpTotal.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-bold">Selling Total</span>
                <span className="font-bold">₹{sellingTotal.toLocaleString('en-IN')}</span>
              </div>
              {itemDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-orange-600 font-semibold">Saved</span>
                  <span className="text-orange-600 font-semibold">
                    ₹{itemDiscount.toLocaleString('en-IN')} ({itemDiscountPercent}% off)
                  </span>
                </div>
              )}
            </div>

            {/* Payment Karo button */}
            <button
              onClick={() => setScreen('payment')}
              className="btn-primary w-full text-lg py-4 mt-3"
            >
              → Payment Karo — ₹{sellingTotal.toLocaleString('en-IN')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ==================== SCREEN 2: PAYMENT ====================
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Payment</h2>
        <button
          onClick={() => setScreen('items')}
          className="text-sm font-medium text-white bg-blue-600 rounded-lg px-3 py-1.5 hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          ← Items Edit Karo
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Full bill snapshot */}
      <div className="card mb-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Bill Preview</div>
        <BillPreview
          items={items.map(i => ({ name: i.category_name, qty: i.quantity, mrp: i.mrp, amount: i.amount }))}
          mrpTotal={mrpTotal}
          sellingTotal={sellingTotal}
          total={total}
          totalDiscount={totalDiscount}
          totalDiscountPercent={totalDiscountPercent}
        />
      </div>

      <div className="card space-y-3">
        {/* Bill-level discount */}
        {discountMode === 'none' ? (
          <button
            onClick={() => setDiscountMode('final')}
            className="w-full py-2.5 rounded-lg text-sm font-medium border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
          >
            Final Price Set Karo?
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Final Price Set Karo</span>
              <button
                onClick={() => { setDiscountMode('none'); setDiscountInput(''); }}
                className="text-red-500 hover:text-red-700 text-xs font-medium px-1.5 py-0.5 rounded bg-red-50 hover:bg-red-100"
              >
                Hatao
              </button>
            </div>
            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg mb-2">
              <button
                onClick={() => { setDiscountMode('final'); setDiscountInput(''); }}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  discountMode === 'final' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                Final ₹
              </button>
              <button
                onClick={() => { setDiscountMode('percent'); setDiscountInput(''); }}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  discountMode === 'percent' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                % Off
              </button>
            </div>
            {discountMode === 'final' && (
              <div className="flex gap-2">
                <input
                  type="number"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  placeholder={`Selling ₹${sellingTotal} — final kitna?`}
                  className="input flex-1"
                  min="1"
                  max={String(sellingTotal)}
                  autoFocus
                />
                <button
                  onClick={e => { e.target.closest('div').querySelector('input')?.blur(); }}
                  className="px-3 py-2 bg-orange-600 text-white rounded-lg font-medium text-xs hover:bg-orange-700 active:bg-orange-800 transition-colors"
                >
                  Lagao
                </button>
              </div>
            )}
            {discountMode === 'percent' && (
              <div className="flex gap-2">
                <input
                  type="number"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Jaise 10, 15, 20"
                  className="input flex-1"
                  min="0"
                  max="100"
                  step="1"
                  autoFocus
                />
                <button
                  onClick={e => { e.target.closest('div').querySelector('input')?.blur(); }}
                  className="px-3 py-2 bg-orange-600 text-white rounded-lg font-medium text-xs hover:bg-orange-700 active:bg-orange-800 transition-colors"
                >
                  Lagao
                </button>
              </div>
            )}
            {billDiscountAmount > 0 && (
              <div className="mt-2 p-2.5 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="text-sm text-gray-600">
                  ₹{sellingTotal.toLocaleString('en-IN')} se <span className="font-bold text-orange-700">₹{billDiscountAmount.toLocaleString('en-IN')} off</span>
                </div>
                <div className="text-lg font-bold text-green-700 mt-0.5">
                  Final: ₹{total.toLocaleString('en-IN')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Total discount + final total */}
        <div className="pt-2 border-t border-gray-200">
          {totalDiscount > 0 && (
            <div className="text-sm font-semibold text-orange-600 mb-0.5">
              Total Discount: ₹{totalDiscount.toLocaleString('en-IN')} ({totalDiscountPercent}% off MRP)
            </div>
          )}
          <div className="text-2xl font-bold">Total: ₹{total.toLocaleString('en-IN')}</div>
        </div>

        {/* Payment buttons */}
        <div className="flex gap-2">
          {PAYMENT_MODES.map(pm => (
            <button
              key={pm.id}
              onClick={() => {
                setPrimaryMode(pm.id);
                if (splitEnabled && splitMode === pm.id) {
                  const alt = PAYMENT_MODES.find(m => m.id !== pm.id);
                  setSplitMode(alt.id);
                }
              }}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                primaryMode === pm.id
                  ? `${pm.color} text-white`
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {pm.label}
            </button>
          ))}
        </div>

        {/* Split + Note */}
        <div className="space-y-2">
          <button
            onClick={() => {
              setSplitEnabled(!splitEnabled);
              if (!splitEnabled) {
                const alt = PAYMENT_MODES.find(m => m.id !== primaryMode);
                setSplitMode(alt.id);
                setSplitAmount('');
              }
            }}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors border ${
              splitEnabled
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
            }`}
          >
            {splitEnabled ? '✓ Split Payment On' : 'Split Payment?'}
          </button>

          {splitEnabled && (
            <div className="p-3 bg-gray-50 rounded-lg space-y-2">
              <div className="flex gap-2">
                {availableSplitModes.map(pm => (
                  <button
                    key={pm.id}
                    onClick={() => setSplitMode(pm.id)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      splitMode === pm.id
                        ? `${pm.color} text-white`
                        : 'bg-white text-gray-700 border border-gray-200'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  {PAYMENT_MODES.find(m => m.id === splitMode)?.label} mein kitna? (Total ₹{total})
                </label>
                <input
                  type="number"
                  value={splitAmount}
                  onChange={e => setSplitAmount(e.target.value)}
                  placeholder={`Max ₹${total - 1}`}
                  className="input"
                  min="1"
                  max={String(total - 1)}
                />
                {splitAmount && parseFloat(splitAmount) > 0 && parseFloat(splitAmount) < total && (
                  <p className="text-xs font-medium text-blue-700 mt-1">
                    {PAYMENT_MODES.find(m => m.id === primaryMode)?.label}: ₹{Math.round((total - parseFloat(splitAmount)) * 100) / 100}
                    {' + '}
                    {PAYMENT_MODES.find(m => m.id === splitMode)?.label}: ₹{parseFloat(splitAmount)}
                    {' = ₹'}{total}
                  </p>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors border ${
              showNotes || notes
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
            }`}
          >
            {notes ? '✓ Note Added' : 'Note?'}
          </button>

          {(showNotes || notes) && (
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Kuch likhna ho toh..."
              className="input"
              autoFocus
            />
          )}
        </div>

        {/* Submit */}
        <button
          onClick={submitBill}
          disabled={submitting || total <= 0}
          className="btn-primary w-full text-lg py-4"
        >
          {submitting ? 'Saving...' : `✓ Bill Save Karo — ₹${total.toLocaleString('en-IN')}`}
        </button>
      </div>
    </div>
  );
}
