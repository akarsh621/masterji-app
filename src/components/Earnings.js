'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CATEGORY_META = {
  stock_purchase: { label: 'Stock Purchase', tip: 'Wholesaler ko diya paisa — naya maal khareedne ke liye', labelField: 'Supplier Name', hasDate: true },
  salaries:       { label: 'Salaries',       tip: 'Staff ki tankhwah',                                        labelField: 'Person Name',   hasDate: false },
  shop_utilities: { label: 'Shop & Utilities', tip: 'Bijli, paani, bags, safai, chai — chhota mota kharcha', labelField: null,            hasDate: false },
  other:          { label: 'Other',          tip: 'Koi aur kharcha jo upar ke categories mein nahi aata',     labelField: null,            hasDate: false },
};
const CATEGORIES = Object.keys(CATEGORY_META);

const TOOLTIPS = {
  revenue: 'Is mahine mein app se bane saare bills ka total — jo bhi becha woh',
  expenses: 'Dukaan chalane mein jo paisa bahar gaya — maal, tankhwah, bijli sab',
  net_profit: 'Revenue mein se saare kharche nikalo — jo bacha woh Net Profit. Yeh ghar aata hai',
  profit_margin: 'Har ₹100 ki sale mein se kitna profit bacha — zyada % matlab zyada healthy business',
  stock_pct: 'Har ₹100 ki sale mein se kitna maal khareedne mein gaya — kam % matlab zyada margin',
  avg_bill: 'Ek bill ka average kitne ka banta hai',
  revenue_day: 'Roz average kitne ki sale ho rahi hai',
  items_bill: 'Ek bill mein average kitne items hote hain',
};

function getISTMonth() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  if (mo === 1) return `${y - 1}-12`;
  return `${y}-${String(mo - 1).padStart(2, '0')}`;
}
function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  if (mo === 12) return `${y + 1}-01`;
  return `${y}-${String(mo + 1).padStart(2, '0')}`;
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}
function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function fmt(n) {
  if (n == null || isNaN(n)) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <button onClick={() => setOpen(!open)} className="text-gray-400 hover:text-gray-600 text-xs align-middle">ⓘ</button>
      {open && (
        <div className="absolute z-20 left-0 top-5 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 w-56 shadow-lg" onClick={() => setOpen(false)}>
          {text}
        </div>
      )}
    </span>
  );
}

function marginColor(pct) {
  if (pct >= 25) return 'text-green-600';
  if (pct >= 15) return 'text-orange-500';
  return 'text-red-600';
}
function stockColor(pct) {
  if (pct <= 50) return 'text-green-600';
  if (pct <= 65) return 'text-orange-500';
  return 'text-red-600';
}

export default function Earnings() {
  const currentMonth = getISTMonth();
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [expenseData, setExpenseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [copying, setCopying] = useState(false);

  const canGoNext = month < currentMonth;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [earningsRes, expensesRes] = await Promise.all([
        api.getEarnings(month),
        api.getExpenses(month),
      ]);
      setData(earningsRes);
      setExpenseData(expensesRes);
    } catch (err) {
      console.error('Earnings load error:', err);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async (expense) => {
    if (deleting) return;
    if (!confirm(`Delete karna hai? ${fmt(expense.amount)}${expense.label ? ' — ' + expense.label : ''}`)) return;
    setDeleting(expense.id);
    try {
      await api.deleteExpense(expense.id);
      await loadData();
    } catch (err) {
      alert(err.message);
    }
    setDeleting(null);
  };

  const handleCopyLastMonth = async () => {
    const prev = prevMonth(month);
    if (!confirm(`${monthLabel(prev)} ke saare expenses copy karein ${monthLabel(month)} mein?`)) return;
    setCopying(true);
    try {
      const res = await api.copyExpenses({ from_month: prev, to_month: month });
      alert(`${res.copied} expenses copy ho gaye!`);
      await loadData();
    } catch (err) {
      alert(err.message);
    }
    setCopying(false);
  };

  if (loading && !data) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>;
  }

  const rev = data?.revenue || {};
  const exp = data?.expenses || {};
  const pnl = data?.pnl || {};
  const prev = data?.previous;
  const expenses = expenseData?.expenses || [];
  const totals = expenseData?.totals || {};
  const hasExpenses = expenses.length > 0;

  const prevHasExpenses = prev?.expenses?.total > 0 || false;
  const showCopyButton = !hasExpenses && prevHasExpenses;

  const profitDelta = prev ? pnl.net_profit - (prev.pnl?.net_profit || 0) : null;
  const profitDeltaPct = prev?.pnl?.net_profit ? Math.round((profitDelta / Math.abs(prev.pnl.net_profit)) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-center gap-4 py-2">
        <button onClick={() => setMonth(prevMonth(month))} className="text-xl text-blue-600 px-2">←</button>
        <h2 className="text-lg font-bold text-gray-800 min-w-[180px] text-center">{monthLabel(month)}</h2>
        <button
          onClick={() => canGoNext && setMonth(nextMonth(month))}
          className={`text-xl px-2 ${canGoNext ? 'text-blue-600' : 'text-gray-300 cursor-not-allowed'}`}
          disabled={!canGoNext}
        >→</button>
      </div>

      {/* P&L Statement Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="font-bold text-gray-700 text-sm">Profit & Loss — {monthLabel(month)}</h3>

        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Revenue <InfoTip text={TOOLTIPS.revenue} /></div>
          {rev.total_returns > 0 ? (
            <div className="space-y-0.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Total Sales</span><span className="font-medium">{fmt(rev.total_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Returns</span><span className="font-medium text-red-500">-{fmt(rev.total_returns)}</span></div>
              <div className="flex justify-between border-t border-gray-100 pt-1"><span className="font-medium text-gray-700">Net Revenue</span><span className="font-bold">{fmt(rev.net_revenue)}</span></div>
            </div>
          ) : (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Revenue</span>
              <span className="font-bold">{fmt(rev.net_revenue)}</span>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Expenses <InfoTip text={TOOLTIPS.expenses} /></div>
          {hasExpenses || exp.total > 0 ? (
            <div className="space-y-0.5 text-sm">
              {CATEGORIES.map(cat => (
                <div key={cat} className="flex justify-between">
                  <span className={exp[cat] > 0 ? 'text-gray-600' : 'text-gray-300'}>{CATEGORY_META[cat].label} <InfoTip text={CATEGORY_META[cat].tip} /></span>
                  <span className={`font-medium ${exp[cat] > 0 ? '' : 'text-gray-300'}`}>{fmt(exp[cat])}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-gray-100 pt-1">
                <span className="font-medium text-gray-700">Total Expenses</span>
                <span className="font-bold">{fmt(exp.total)}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic py-1">Koi expenses nahi dale — neeche se add karein ↓</div>
          )}
        </div>

        <div className="border-t-2 border-gray-300 pt-2 space-y-1">
          <div className="flex justify-between text-base">
            <span className="font-bold text-gray-800">Net Profit <InfoTip text={TOOLTIPS.net_profit} /></span>
            <span className={`font-bold ${pnl.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(pnl.net_profit)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Profit Margin <InfoTip text={TOOLTIPS.profit_margin} /></span>
            <span className={`font-semibold ${marginColor(pnl.profit_margin_pct)}`}>{pnl.profit_margin_pct}%</span>
          </div>
          {profitDelta !== null && prev?.revenue?.net_revenue > 0 && (
            <div className={`text-xs ${profitDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              vs {monthLabel(prev.month)}: {profitDelta >= 0 ? '↑' : '↓'}{fmt(Math.abs(profitDelta))}
              {profitDeltaPct !== null && ` (${profitDelta >= 0 ? '+' : ''}${profitDeltaPct}%)`}
            </div>
          )}
          {exp.stock_purchase > 0 && rev.net_revenue > 0 && (
            <div className={`text-xs ${stockColor(pnl.stock_pct)}`}>
              Stock: {pnl.stock_pct}% of revenue <InfoTip text={TOOLTIPS.stock_pct} />
            </div>
          )}
        </div>
      </div>

      {/* Key Numbers Grid */}
      {rev.sale_count > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <NumberCard value={fmt(Math.round(rev.net_revenue / rev.sale_count))} label="Avg Bill" tip={TOOLTIPS.avg_bill} />
          <NumberCard value={rev.sale_count} label="Total Bills" />
          <NumberCard value={rev.active_days > 0 ? fmt(Math.round(rev.net_revenue / rev.active_days)) : '—'} label="Revenue/Day" tip={TOOLTIPS.revenue_day} />
          <NumberCard value={rev.sale_count > 0 ? (rev.total_items / rev.sale_count).toFixed(1) : '—'} label="Items/Bill" tip={TOOLTIPS.items_bill} />
        </div>
      )}

      {/* Expense List */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-700 text-sm">Expenses — {monthLabel(month)}</h3>
          <div className="flex gap-2">
            {showCopyButton && (
              <button
                onClick={handleCopyLastMonth}
                disabled={copying}
                className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {copying ? 'Copying...' : 'Pichle Mahine Se Copy'}
              </button>
            )}
            <button
              onClick={() => { setEditingExpense(null); setShowForm(true); }}
              className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
            >
              + Add
            </button>
          </div>
        </div>

        {CATEGORIES.map(cat => {
          const catExpenses = expenses.filter(e => e.category === cat);
          const catTotal = totals[cat] || 0;
          const isExpanded = expanded[cat];
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat} className="border-b border-gray-50 last:border-0">
              <button
                onClick={() => setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }))}
                className="w-full flex items-center justify-between py-2.5 text-sm"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-xs">{isExpanded ? '▾' : '▸'}</span>
                  <span className={catTotal > 0 ? 'font-medium text-gray-700' : 'text-gray-400'}>{meta.label}</span>
                </span>
                <span className={catTotal > 0 ? 'font-semibold' : 'text-gray-300'}>{fmt(catTotal)}</span>
              </button>
              {isExpanded && (
                <div className="pl-5 pb-2 space-y-1">
                  {catExpenses.length === 0 ? (
                    <div className="text-xs text-gray-400 italic py-1">Koi entry nahi</div>
                  ) : catExpenses.map(exp => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between text-sm py-2 min-h-[44px] hover:bg-gray-50 rounded px-1 cursor-pointer"
                      onClick={() => { setEditingExpense(exp); setShowForm(true); }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-gray-700">{exp.label || exp.note || meta.label}</span>
                        {exp.expense_date && <span className="text-gray-400 text-xs ml-2">{shortDate(exp.expense_date)}</span>}
                        {exp.note && exp.label && <span className="text-gray-400 text-xs ml-2">· {exp.note}</span>}
                      </div>
                      <div className="flex items-center gap-3 ml-2">
                        <span className="font-medium whitespace-nowrap">{fmt(exp.amount)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(exp); }}
                          disabled={deleting === exp.id}
                          className="text-red-400 hover:text-red-600 text-xs px-2 py-1 min-h-[44px] min-w-[32px] flex items-center justify-center"
                        >{deleting === exp.id ? '...' : '✕'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="flex justify-between pt-2 border-t border-gray-200 text-sm font-bold">
          <span>Total</span>
          <span>{fmt(totals.total || 0)}</span>
        </div>
      </div>

      {/* Add/Edit Expense Form */}
      {showForm && (
        <ExpenseForm
          month={month}
          expense={editingExpense}
          onClose={() => { setShowForm(false); setEditingExpense(null); }}
          onSaved={() => { setShowForm(false); setEditingExpense(null); loadData(); }}
          saving={saving}
          setSaving={setSaving}
        />
      )}
    </div>
  );
}

function NumberCard({ value, label, tip }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <div className="text-xl font-bold text-gray-800">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label} {tip && <InfoTip text={tip} />}</div>
    </div>
  );
}

function ExpenseForm({ month, expense, onClose, onSaved, saving, setSaving }) {
  const isEdit = !!expense;
  const [category, setCategory] = useState(expense?.category || 'stock_purchase');
  const [amount, setAmount] = useState(expense?.amount?.toString() || '');
  const [label, setLabel] = useState(expense?.label || '');
  const [note, setNote] = useState(expense?.note || '');
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date || '');
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState('');

  const meta = CATEGORY_META[category];

  useEffect(() => {
    if (!meta.labelField) return;
    api.getExpenseLabels(category).then(res => setSuggestions(res.labels || [])).catch(() => {});
  }, [category, meta.labelField]);

  const handleSubmit = async () => {
    setError('');
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) { setError('Amount daalo'); return; }
    if (meta.labelField && !label.trim()) { setError(`${meta.labelField} zaroori hai`); return; }

    setSaving(true);
    try {
      if (isEdit) {
        await api.updateExpense(expense.id, {
          amount: numAmount,
          label: label.trim() || null,
          note: note.trim() || null,
          expense_date: expenseDate || null,
        });
      } else {
        await api.createExpense({
          category,
          amount: numAmount,
          label: label.trim() || null,
          note: note.trim() || null,
          expense_month: month,
          expense_date: expenseDate || null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const [y, m] = month.split('-');
  const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate();
  const minDate = `${month}-01`;
  const maxDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  return (
    <div className="bg-white rounded-xl border-2 border-blue-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-700 text-sm">{isEdit ? 'Edit Expense' : 'New Expense'}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
      </div>

      {/* Category pills (not editable in edit mode) */}
      {!isEdit && (
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => { setCategory(cat); setLabel(''); setExpenseDate(''); }}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                category === cat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{CATEGORY_META[cat].label}</button>
          ))}
        </div>
      )}

      {/* Label field */}
      {meta.labelField && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">{meta.labelField} *</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            placeholder={meta.labelField}
          />
          {suggestions.length > 0 && !label && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => setLabel(s)}
                  className="text-xs bg-gray-50 border border-gray-200 text-gray-600 px-2 py-1 rounded-full hover:bg-gray-100"
                >{s}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Amount (₹) *</label>
        <input
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          placeholder="0"
        />
      </div>

      {/* Date (stock_purchase only) */}
      {meta.hasDate && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date</label>
          <input
            type="date"
            value={expenseDate}
            min={minDate}
            max={maxDate}
            onChange={e => setExpenseDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

      {/* Note */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          placeholder="Note"
        />
      </div>

      {error && <div className="text-red-500 text-xs">{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Expense'}
      </button>
    </div>
  );
}
