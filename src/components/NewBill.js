'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/auth';
import { api, newRequestId } from '@/lib/api-client';
import { loadDraft, saveDraft, clearDraft } from '@/lib/bill-draft';
import LoadError from '@/components/LoadError';
import { normalizePhone, isValidPhone } from '@/lib/phone';
import { todayIST, isQuarterLocked } from '@/lib/date-utils';
import { MAX_MRP } from '@/lib/limits';
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

const BACKDATE_MAX_DAYS = 30;

// Earliest date a bill can be backdated to: 30 days back, but never into a
// quarter already closed for GST filing.
function earliestBackdate() {
  let d = ymdOffsetDays(todayIST(), -BACKDATE_MAX_DAYS);
  while (isQuarterLocked(d)) d = ymdOffsetDays(d, 1);
  return d;
}

function ymdOffsetDays(baseYmd, deltaDays) {
  const base = new Date(baseYmd + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatBackdateLabel(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${monthNames[dt.getUTCMonth()]} ${y}`;
}

export default function NewBill({ prefillData, onPrefillConsumed, onDraftChange, newBillRequest = 0 }) {
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
  const [editingItemIdx, setEditingItemIdx] = useState(null);
  const [editPriceInput, setEditPriceInput] = useState('');

  const [screen, setScreen] = useState('items');
  const [saleByOpen, setSaleByOpen] = useState(false);

  const [backdateOpen, setBackdateOpen] = useState(false);
  const [backdateValue, setBackdateValue] = useState('');

  const [primaryMode, setPrimaryMode] = useState(null);
  const [paymentModeMissing, setPaymentModeMissing] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMode, setSplitMode] = useState('upi');
  const [splitAmount, setSplitAmount] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [discountMode, setDiscountMode] = useState('none');
  const [editingTotal, setEditingTotal] = useState(false);
  // Set while correcting a saved bill via "Edit Bill": { id, bill_number }.
  const [replacesBill, setReplacesBill] = useState(null);
  // Optional customer (builds the customer list). Never required.
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerLookup, setCustomerLookup] = useState(null); // { customer, phone } once looked up
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  // In-app confirmation ('new' | 'cancel'). Phone browsers can silently skip
  // window.confirm, so starting over never relies on it.
  const [confirmReset, setConfirmReset] = useState(null);
  const [printStatus, setPrintStatus] = useState(null);
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  // One id per version of this bill: a plain retry reuses it (so a lost
  // response can't create a duplicate); any edit to the bill gets a fresh one.
  const billRequestId = useRef(newRequestId());
  const [draftRestored, setDraftRestored] = useState(false);
  const draftLoaded = useRef(false);

  const [categoriesError, setCategoriesError] = useState('');
  const loadCategories = () => {
    setCategoriesError('');
    api.getCategories().then(d => {
      setCategories(d.grouped);
      const flat = [];
      for (const group of Object.keys(d.grouped)) {
        for (const cat of d.grouped[group]) {
          flat.push({ ...cat, group_name: group });
        }
      }
      setFlatCategories(flat);
    }).catch(err => setCategoriesError(err.message));
  };

  useEffect(() => {
    loadCategories();
    api.getSalesmen().then(d => {
      setSalesmen(d.salesmen || []);
      if (!isAdmin && user?.id) {
        setSelectedSalesmanId(user.id);
      }
    }).catch(() => {});
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
      if (prefillData.notes) { setNotes(prefillData.notes); setShowNotes(true); }
      setReplacesBill(prefillData.replaces || null);
      setCustomerPhone(prefillData.customer_phone || '');
      setCustomerName(prefillData.customer_name || '');
      if (prefillData.salesman_id) setSelectedSalesmanId(prefillData.salesman_id);
      if (prefillData.final_price) {
        setDiscountMode('final');
        setDiscountInput(String(prefillData.final_price));
      } else {
        setDiscountMode('none');
        setDiscountInput('');
      }
      setDraftRestored(false);
      setScreen('items');
      if (onPrefillConsumed) onPrefillConsumed();
    }
  }, [prefillData, flatCategories]);

  useEffect(() => {
    if (draftLoaded.current || !user?.id) return;
    draftLoaded.current = true;
    if (prefillData) return;
    const d = loadDraft(user.id);
    if (!d || !d.items?.length) return;
    setItems(d.items);
    setDiscountInput(d.discountInput || '');
    setDiscountMode(d.discountMode || 'none');
    setPrimaryMode(d.primaryMode || null);
    setSplitEnabled(!!d.splitEnabled);
    setSplitMode(d.splitMode || 'upi');
    setSplitAmount(d.splitAmount || '');
    setNotes(d.notes || '');
    setShowNotes(!!d.notes);
    if (d.selectedSalesmanId) setSelectedSalesmanId(d.selectedSalesmanId);
    setBackdateValue(d.backdateValue || '');
    setReplacesBill(d.replacesBill || null);
    setCustomerPhone(d.customerPhone || '');
    setCustomerName(d.customerName || '');
    setDraftRestored(true);
  }, [user?.id, prefillData]);

  useEffect(() => {
    if (!draftLoaded.current || !user?.id) return;
    if (items.length === 0) {
      clearDraft(user.id);
    } else {
      saveDraft(user.id, {
        items, discountInput, discountMode, primaryMode, splitEnabled, splitMode,
        splitAmount, notes, selectedSalesmanId, backdateValue, replacesBill, customerPhone, customerName,
      });
    }
    if (onDraftChange) onDraftChange(items.length > 0);
  }, [user?.id, items, discountInput, discountMode, primaryMode, splitEnabled, splitMode, splitAmount, notes, selectedSalesmanId, backdateValue, replacesBill, customerPhone, customerName, onDraftChange]);

  const normalizedCustomerPhone = normalizePhone(customerPhone);
  const customerPhoneValid = isValidPhone(normalizedCustomerPhone);
  const customerPhoneInvalid = customerPhone.trim() !== '' && !customerPhoneValid;
  useEffect(() => {
    if (!customerPhoneValid) { setCustomerLookup(null); return; }
    let cancelled = false;
    api.lookupCustomer(normalizedCustomerPhone)
      .then(d => {
        if (cancelled) return;
        setCustomerLookup(d);
        if (d.customer?.name) setCustomerName(prev => prev || d.customer.name);
      })
      .catch(() => { if (!cancelled) setCustomerLookup(null); }); // lookup is a convenience only
    return () => { cancelled = true; };
  }, [normalizedCustomerPhone, customerPhoneValid]);

  // Android Back on the Payment step goes back to the items, not out of the app.
  useEffect(() => {
    if (screen !== 'payment') return;
    window.history.pushState({ mjPayment: true }, '');
    const onPop = () => setScreen('items');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.mjPayment) window.history.back();
    };
  }, [screen]);

  // Warn before closing / reloading the page with an unsaved bill.
  useEffect(() => {
    if (items.length === 0) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [items.length]);

  const getSelectedCategory = () => flatCategories.find(c => c.id === selectedCategoryId);

  // Live calculation from MRP + Discount %
  const parsedMrp = parseFloat(mrpInput) || 0;
  const parsedDiscPerc = parseFloat(discPercInput) || 0;
  const discountInvalid = parsedDiscPerc < 0 || parsedDiscPerc >= 100;
  const mrpTooHigh = parsedMrp > MAX_MRP;
  // Rounded to whole rupees, but never above the MRP (e.g. MRP 499.5 at 0% stays 499.5).
  const computedSellingPrice = parsedMrp > 0 && !discountInvalid && !mrpTooHigh
    ? Math.min(Math.round(parsedMrp * (1 - parsedDiscPerc / 100)), parsedMrp)
    : 0;

  // The amount has changed, so anything chosen for the old amount must be chosen
  // again: final price, split amount and payment mode. Customer and note stay.
  const itemsChanged = () => {
    setDiscountMode('none');
    setDiscountInput('');
    setEditingTotal(false);
    setSplitEnabled(false);
    setSplitAmount('');
    setPrimaryMode(null);
    setPaymentModeMissing(false);
  };

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
    itemsChanged();

    setMrpInput('');
    setDiscPercInput('');
    setQtyInput('1');
    setSelectedCategoryId(null);
  };

  const removeItem = (index) => {
    // Removing the last item ends this bill: nothing from it carries into the next one.
    // (While editing a bill (Edit Bill), stay in that mode.)
    if (items.length <= 1 && !replacesBill) {
      resetBill();
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
    itemsChanged();
  };

  const cancelBill = () => setConfirmReset('cancel');

  // Tapping "Naya Bill" in the bottom bar while already here starts a fresh bill.
  const lastNewBillRequest = useRef(newBillRequest);
  useEffect(() => {
    if (newBillRequest === lastNewBillRequest.current) return;
    lastNewBillRequest.current = newBillRequest;
    if (success) {
      setSuccess(null);
      setPrintStatus(null);
      return;
    }
    if (items.length > 0) setConfirmReset('new');
    else resetBill();
  }, [newBillRequest]);

  // The tapped number is the line total, so the edit is the new line total.
  const commitPriceEdit = (index) => {
    const newTotal = Math.round(parseFloat(editPriceInput) || 0);
    const item = items[index];
    setEditingItemIdx(null);
    setEditPriceInput('');
    if (!item || !editPriceInput) return;
    if (newTotal <= 0) {
      setError('Price 0 se zyada hona chahiye');
      return;
    }
    if (newTotal > item.mrp * item.quantity) {
      setError(`Price MRP (₹${(item.mrp * item.quantity).toLocaleString('en-IN')}) se zyada nahi ho sakta`);
      return;
    }
    setError('');
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const perPiece = Math.round((newTotal / it.quantity) * 100) / 100;
      const discPerc = it.mrp > 0 ? Math.round((1 - perPiece / it.mrp) * 100) : 0;
      return { ...it, price_per_piece: perPiece, discount_percent: discPerc, amount: newTotal };
    }));
    if (newTotal !== item.amount) itemsChanged();
  };

  const mrpTotal = items.reduce((s, i) => s + (i.mrp * i.quantity), 0);
  const sellingTotal = items.reduce((s, i) => s + i.amount, 0);
  const totalPieces = items.reduce((s, i) => s + i.quantity, 0);
  const itemDiscount = mrpTotal - sellingTotal;
  const itemDiscountPercent = mrpTotal > 0 ? Math.round((itemDiscount / mrpTotal) * 100) : 0;

  let billDiscountAmount = 0;
  let billDiscountPercent = 0;
  const rawBillDiscount = parseFloat(discountInput) || 0;

  if (discountMode === 'final' && rawBillDiscount > 0 && rawBillDiscount < sellingTotal) {
    billDiscountAmount = Math.round(sellingTotal - rawBillDiscount);
    billDiscountPercent = sellingTotal > 0 ? Math.round((billDiscountAmount / sellingTotal) * 100) : 0;
  }

  const total = sellingTotal - billDiscountAmount;
  // One-tap round figures below the price: nearest ₹10, ₹50 and ₹100 below.
  const roundOffOptions = [...new Set([10, 50, 100].map(step => Math.floor((sellingTotal - 1) / step) * step))]
    .filter(v => v > 0);
  const totalDiscount = itemDiscount + billDiscountAmount;
  const totalDiscountPercent = mrpTotal > 0 ? Math.round((totalDiscount / mrpTotal) * 100) : 0;

  const isCashOnly = primaryMode === 'cash' && !splitEnabled;
  const cashRounded = total < 10 ? total : Math.floor(total / 10) * 10;
  const displayTotal = isCashOnly ? cashRounded : total;
  const cashRoundOff = isCashOnly ? total - cashRounded : 0;

  useEffect(() => {
    billRequestId.current = newRequestId();
  }, [items, discountInput, discountMode, primaryMode, splitEnabled, splitMode, splitAmount, notes, selectedSalesmanId, backdateValue, customerPhone, customerName]);

  const splitAmountNumber = Math.round((parseFloat(splitAmount) || 0) * 100) / 100;
  const splitInvalid = splitEnabled && splitAmount !== '' && (splitAmountNumber <= 0 || splitAmountNumber >= total);

  const buildPayments = () => {
    if (!splitEnabled || !splitAmount) {
      return [{ mode: primaryMode, amount: displayTotal }];
    }
    const splitAmt = splitAmountNumber;
    const primaryAmt = Math.round((total - splitAmt) * 100) / 100;
    return [
      { mode: primaryMode, amount: primaryAmt },
      { mode: splitMode, amount: splitAmt },
    ];
  };

  const resetBill = () => {
    setItems([]);
    setDiscountInput('');
    setDiscountMode('none');
    setEditingTotal(false);
    setNotes('');
    setShowNotes(false);
    setPrimaryMode(null);
    setPaymentModeMissing(false);
    setSplitEnabled(false);
    setSplitAmount('');
    setBackdateValue('');
    setBackdateOpen(false);
    setSelectedCategoryId(null);
    setError('');
    setScreen('items');
    setDraftRestored(false);
    setReplacesBill(null);
    setCustomerPhone('');
    setCustomerName('');
    setCustomerLookup(null);
    clearDraft(user?.id);
  };

  const submitBill = async () => {
    if (items.length === 0 || submitLock.current) return;
    if (!primaryMode) {
      setPaymentModeMissing(true);
      return;
    }
    if (customerPhoneInvalid) {
      setError('Customer ka mobile number 10 digit ka hona chahiye — ya khaali chhodo');
      return;
    }
    if (splitInvalid) {
      setError(`Split amount ₹${total} se kam hona chahiye`);
      return;
    }
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
        discount_amount: billDiscountAmount + cashRoundOff,
        notes,
        client_request_id: billRequestId.current,
      };
      if (replacesBill) {
        billPayload.replaces_bill_id = replacesBill.id;
      }
      if (customerPhoneValid) {
        billPayload.customer_phone = normalizedCustomerPhone;
        billPayload.customer_name = customerName.trim();
      }
      if (selectedSalesmanId) {
        billPayload.salesman_id = selectedSalesmanId;
      }
      if (!replacesBill && backdateValue && backdateValue !== todayIST()) {
        billPayload.bill_date = backdateValue;
      }
      const result = await api.createBill(billPayload);
      setSuccess(result);
      resetBill();
      setTimeout(() => { submitLock.current = false; }, 2000);
    } catch (err) {
      setError(err.status === 0
        ? 'Internet ki wajah se pata nahi chala bill save hua ya nahi. "Bill Save Karo" dobara dabao — bill do baar nahi banega.'
        : err.message);
      submitLock.current = false;
    } finally {
      setSubmitting(false);
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
        {success.replaces_bill_number && (
          <p className="text-sm text-amber-700 mb-1">{success.replaces_bill_number} ki jagah</p>
        )}
        {success.is_backdated && success.bill_date && (
          <div className="mb-2 inline-block px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-semibold">
            Backdated: {formatBackdateLabel(success.bill_date)}
          </div>
        )}
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
    if (categoriesError) return <LoadError message={categoriesError} onRetry={loadCategories} />;
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  const selectedCat = getSelectedCategory();
  const availableSplitModes = PAYMENT_MODES.filter(m => m.id !== primaryMode);
  const canAdd = parsedMrp > 0 && computedSellingPrice > 0 && selectedCategoryId;

  const confirmBox = confirmReset && (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
        <p className="text-base font-semibold text-gray-900 mb-1">
          {confirmReset === 'new' ? 'Naya bill shuru karein?' : 'Ye bill cancel karein?'}
        </p>
        <p className="text-sm text-gray-600 mb-4">
          Abhi wale bill ke {totalPieces} {totalPieces === 1 ? 'item' : 'items'} (₹{sellingTotal.toLocaleString('en-IN')}) hat jayenge.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setConfirmReset(null)} className="btn-secondary flex-1 py-3">
            Nahi
          </button>
          <button
            onClick={() => { setConfirmReset(null); resetBill(); }}
            className="flex-1 py-3 rounded-lg bg-red-600 text-white font-medium"
          >
            {confirmReset === 'new' ? 'Haan, naya bill' : 'Haan, cancel karo'}
          </button>
        </div>
      </div>
    </div>
  );

  // ==================== SCREEN 1: ITEM BUILDING ====================
  if (screen === 'items') {
    return (
      <div>
        {confirmBox}
        <h2 className="text-lg font-bold mb-3">{replacesBill ? 'Edit Bill' : 'Naya Bill'}</h2>

        {replacesBill && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-sm text-amber-900">
              Bill <span className="font-semibold">{replacesBill.bill_number}</span> edit kar rahe ho — save karne par purana bill cancel ho jayega.
            </div>
            <button
              onClick={resetBill}
              className="mt-2 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-3 py-2 min-h-[40px]"
            >
              Cancel editing
            </button>
          </div>
        )}

        {draftRestored && !replacesBill && items.length > 0 && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-3">
            <span className="text-sm text-blue-800">Pichla bill abhi bacha hai</span>
            <button
              onClick={cancelBill}
              className="text-sm font-medium text-blue-700 border border-blue-300 bg-white rounded-lg px-3 py-2 min-h-[40px]"
            >
              Naya Bill
            </button>
          </div>
        )}

        {error && (
          <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {/* Category bar */}
        {Object.entries(categories).map(([group, cats]) => (
          <div key={group} className="mb-2">
            <div className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-1">
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
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-all active:scale-95 ${
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
              <span className="text-base font-semibold text-gray-900">
                Adding: <strong>{selectedCat.name}</strong>
              </span>
              <span className="text-sm text-gray-500 ml-1">
                ({GROUP_LABELS[selectedCat.group_name] || selectedCat.group_name})
              </span>
            </div>

            <div className="card space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm text-gray-500 mb-0.5">MRP (₹)</label>
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
                  <label className="block text-sm text-gray-500 mb-0.5">Discount %</label>
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
              <div className="text-base font-semibold text-orange-600 min-h-[24px]">
                {mrpTooHigh && (
                  <span className="text-red-600">MRP bahut zyada hai — check karo (max ₹{MAX_MRP.toLocaleString('en-IN')})</span>
                )}
                {!mrpTooHigh && discountInvalid && (
                  <span className="text-red-600">Discount 0 se 99% ke beech hona chahiye</span>
                )}
                {!mrpTooHigh && parsedMrp > 0 && parsedDiscPerc > 0 && !discountInvalid && (
                  <>₹{parsedMrp} - {parsedDiscPerc}% = ₹{computedSellingPrice}</>
                )}
                {!mrpTooHigh && parsedMrp > 0 && parsedDiscPerc === 0 && (
                  <>₹{parsedMrp} (no discount)</>
                )}
              </div>

              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-sm text-gray-500 mb-0.5">Qty</label>
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
            <div className="flex items-center text-base font-medium text-gray-500 mb-2">
              <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mr-1.5">
                {totalPieces}
              </span>
              {totalPieces === 1 ? 'item' : 'items'}
            </div>

            {/* Item rows */}
            {items.map((item, idx) => (
              <div key={idx} className="py-2 border-b border-gray-50 last:border-0">
                {/* Line 1: number + category + qty ... Hatao */}
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm text-gray-400 font-medium">{idx + 1}.</span>
                    <span className="text-base font-bold text-gray-900">{item.category_name}</span>
                    <span className="text-sm text-gray-500 font-medium">×{item.quantity}</span>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-2 -my-2 -mr-3"
                  >
                    Hatao
                  </button>
                </div>
                {/* Line 2: calculation ... final price */}
                <div className="flex items-center justify-between mt-1.5 pl-6">
                  <span className="text-sm text-gray-700">
                    {item.discount_percent > 0 ? (
                      item.quantity > 1
                        ? <>₹{item.mrp} - <span className="font-bold">{item.discount_percent}%</span> = ₹{item.price_per_piece} × {item.quantity}</>
                        : <>₹{item.mrp} - <span className="font-bold">{item.discount_percent}%</span></>
                    ) : (
                      item.quantity > 1
                        ? <>₹{item.mrp} × {item.quantity}</>
                        : <>₹{item.mrp}</>
                    )}
                  </span>
                  {editingItemIdx === idx ? (
                    <input
                      type="number"
                      value={editPriceInput}
                      onChange={e => setEditPriceInput(e.target.value)}
                      onBlur={() => commitPriceEdit(idx)}
                      onKeyDown={e => { if (e.key === 'Enter') commitPriceEdit(idx); }}
                      className="w-20 text-right text-lg font-bold text-gray-900 border border-blue-400 rounded px-1 py-0 bg-blue-50 outline-none"
                      autoFocus
                      min="1"
                      max={String(item.mrp * item.quantity)}
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingItemIdx(idx); setEditPriceInput(String(item.amount)); }}
                      className="text-lg font-bold text-gray-900 border-b border-dashed border-gray-400 cursor-pointer"
                    >
                      ₹{item.amount.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Summary */}
            <div className="pt-2 mt-2 border-t-2 border-gray-200 space-y-0.5">
              <div className="flex justify-between text-base">
                <span className="text-gray-500">MRP Total</span>
                <span className="text-gray-500">₹{mrpTotal.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-base">
                <span className="font-bold">Selling Total</span>
                <span className="font-bold">₹{sellingTotal.toLocaleString('en-IN')}</span>
              </div>
              {itemDiscount > 0 && (
                <div className="flex justify-between text-base">
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
      {confirmBox}
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
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bill Preview</span>
          <span className="text-sm font-bold text-gray-900">{totalPieces} {totalPieces === 1 ? 'item' : 'items'}</span>
        </div>
        <BillPreview
          items={items.map(i => ({ name: i.category_name, qty: i.quantity, mrp: i.mrp, amount: i.amount }))}
          mrpTotal={mrpTotal}
          sellingTotal={sellingTotal}
          total={total}
          totalDiscount={totalDiscount}
          totalDiscountPercent={totalDiscountPercent}
        />
      </div>

      {/* Salesman selector -- compact */}
      {salesmen.length > 0 && (
        <div className="mb-3">
          {!saleByOpen ? (
            <button
              onClick={() => setSaleByOpen(true)}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <span className="text-gray-400">Sale by:</span>
              <span className="font-medium">
                {selectedSalesmanId
                  ? salesmen.find(s => s.id === selectedSalesmanId)?.name || 'Unknown'
                  : (isAdmin ? 'Owner' : user?.name || 'Me')}
              </span>
              <span className="text-xs text-blue-500">✎</span>
            </button>
          ) : (
            <div className="p-2.5 bg-gray-50 rounded-lg">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Sale by</div>
              <div className="flex flex-wrap gap-1.5">
                {isAdmin && (
                  <button
                    onClick={() => { setSelectedSalesmanId(null); setSaleByOpen(false); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      !selectedSalesmanId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    Owner
                  </button>
                )}
                {salesmen.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSalesmanId(s.id); setSaleByOpen(false); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedSalesmanId === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Backdated entry (admin only) */}
      {isAdmin && (
        <div className="mb-3">
          {!backdateOpen && !backdateValue ? (
            <button
              onClick={() => setBackdateOpen(true)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <span className="text-gray-400">Date:</span>
              <span className="font-medium">Aaj</span>
              <span className="text-xs text-blue-500">✎</span>
            </button>
          ) : (
            <div className="p-2.5 bg-gray-50 rounded-lg">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Bill Date</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={backdateValue || todayIST()}
                  min={earliestBackdate()}
                  max={todayIST()}
                  onChange={(e) => setBackdateValue(e.target.value)}
                  className="input text-sm"
                />
                {backdateValue && backdateValue !== todayIST() && (
                  <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-semibold">
                    Backdated: {formatBackdateLabel(backdateValue)}
                  </span>
                )}
                <button
                  onClick={() => { setBackdateValue(''); setBackdateOpen(false); }}
                  className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-2 -my-2"
                >
                  Hatao
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Customer (optional) */}
      <div className="card mb-3 space-y-2">
        <label className="text-sm text-gray-500" htmlFor="customer-phone">Customer mobile (optional)</label>
        <input
          id="customer-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={customerPhone}
          onChange={e => setCustomerPhone(e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 16))}
          placeholder="98765 43210"
          className="input"
        />
        {customerPhoneInvalid && normalizedCustomerPhone.length >= 10 && (
          <div className="text-sm text-red-600">Ye number sahi nahi lag raha</div>
        )}
        {customerPhoneValid && (
          <>
            {customerLookup?.customer && (
              <div className="text-sm text-green-700">
                Pehle aa chuke hain · {customerLookup.customer.visits} {customerLookup.customer.visits === 1 ? 'bill' : 'bills'}
              </div>
            )}
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value.slice(0, 60))}
              placeholder="Customer name (optional)"
              className="input"
            />
          </>
        )}
      </div>

      <div className="card space-y-3">
        {/* Total — tap to set a final price (same gesture as editing an item price) */}
        <div>
          {editingTotal ? (
            <div className="space-y-2">
              <div className="text-sm text-gray-500">Final price kitna? (₹{sellingTotal.toLocaleString('en-IN')} se kam)</div>
              <input
                type="number"
                inputMode="numeric"
                value={discountInput}
                onChange={e => { setDiscountMode('final'); setDiscountInput(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') setEditingTotal(false); }}
                className="input text-2xl font-bold"
                autoFocus
              />
              {parseFloat(discountInput) > sellingTotal && (
                <div className="text-sm text-red-600">₹{sellingTotal.toLocaleString('en-IN')} se zyada nahi ho sakta</div>
              )}
              <div className="flex gap-2">
                {roundOffOptions.map(v => (
                  <button
                    key={v}
                    onClick={() => { setDiscountMode('final'); setDiscountInput(String(v)); setEditingTotal(false); }}
                    className={`flex-1 py-2.5 min-h-[44px] rounded-lg border text-base font-medium ${
                      Number(discountInput) === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'
                    }`}
                  >
                    ₹{v.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>
              <button onClick={() => setEditingTotal(false)} className="btn-secondary w-full py-2.5">
                Theek hai
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDiscountMode('final');
                setDiscountInput(String(billDiscountAmount > 0 ? total : sellingTotal));
                setEditingTotal(true);
              }}
              className="w-full flex items-baseline justify-between text-left"
            >
              <span className="text-3xl font-bold">
                Total: <span className="border-b-2 border-dashed border-gray-400">₹{displayTotal.toLocaleString('en-IN')}</span>
              </span>
              <span className="text-sm font-medium text-blue-600">✎ Badlo</span>
            </button>
          )}
          {!editingTotal && (billDiscountAmount > 0 || cashRoundOff > 0) && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-gray-600">
                {billDiscountAmount > 0 && <>₹{sellingTotal.toLocaleString('en-IN')} se ₹{billDiscountAmount.toLocaleString('en-IN')} kam kiya</>}
                {billDiscountAmount > 0 && cashRoundOff > 0 && ' · '}
                {cashRoundOff > 0 && <>₹{cashRoundOff} round off</>}
              </span>
              {billDiscountAmount > 0 && (
                <button
                  onClick={() => { setDiscountMode('none'); setDiscountInput(''); }}
                  className="text-sm font-medium text-red-600 px-3 py-2 min-h-[36px]"
                >
                  Hatao
                </button>
              )}
            </div>
          )}
        </div>

        {/* Payment buttons */}
        <div className="flex gap-2">
          {PAYMENT_MODES.map(pm => (
            <button
              key={pm.id}
              onClick={() => {
                setPrimaryMode(pm.id);
                setPaymentModeMissing(false);
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
        {paymentModeMissing && (
          <p className="text-sm font-medium text-red-600 text-center">Payment mode chuno</p>
        )}

        {/* Split + Note (compact chip row) */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={() => {
                setSplitEnabled(!splitEnabled);
                if (!splitEnabled) {
                  const alt = PAYMENT_MODES.find(m => m.id !== primaryMode);
                  setSplitMode(alt.id);
                  setSplitAmount('');
                }
              }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                splitEnabled
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {splitEnabled ? '✓ Split: On' : '+ Split Payment'}
            </button>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                showNotes || notes
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {notes ? '✓ Note: Added' : '+ Note'}
            </button>
          </div>

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
          disabled={submitting || displayTotal <= 0}
          className="btn-primary w-full text-lg py-4"
        >
          {submitting ? 'Saving...' : `✓ Bill Save Karo — ₹${displayTotal.toLocaleString('en-IN')}`}
        </button>
        {!replacesBill && (
          <div className="text-center">
            <button onClick={cancelBill} disabled={submitting} className="text-sm font-medium text-red-600 px-3 py-2">
              Bill cancel karo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
