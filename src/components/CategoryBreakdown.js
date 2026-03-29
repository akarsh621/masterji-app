'use client';

import { useState } from 'react';
import { GROUP_LABELS, GROUP_COLORS } from '@/lib/ui-utils';

const GROUP_ORDER = ['women', 'men', 'kids', 'other'];

function groupData(categories) {
  const groups = {};
  for (const cat of categories) {
    const g = cat.group_name || 'other';
    if (!groups[g]) groups[g] = { revenue: 0, quantity: 0, categories: [] };
    groups[g].revenue += cat.revenue;
    groups[g].quantity += cat.quantity;
    groups[g].categories.push(cat);
  }
  return GROUP_ORDER
    .filter(g => groups[g])
    .map(g => ({ key: g, ...groups[g] }));
}

export default function CategoryBreakdown({ data }) {
  const [expanded, setExpanded] = useState(null);

  if (!data || data.length === 0) return null;

  const groups = groupData(data);
  const maxRevenue = Math.max(...groups.map(g => g.revenue));
  const fmt = n => Math.round(n).toLocaleString('en-IN');

  return (
    <div className="card mb-4">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Category Breakdown</h3>
      {groups.map(g => {
        const colors = GROUP_COLORS[g.key] || GROUP_COLORS.other;
        const pct = maxRevenue > 0 ? (g.revenue / maxRevenue) * 100 : 0;
        const isOpen = expanded === g.key;

        return (
          <div key={g.key} className="mb-3 last:mb-0">
            <button
              onClick={() => setExpanded(isOpen ? null : g.key)}
              className="w-full text-left"
            >
              <div className="flex justify-between text-sm mb-1">
                <span className={`font-semibold ${colors.text}`}>
                  {isOpen ? '▾' : '▸'} {GROUP_LABELS[g.key] || g.key}
                </span>
                <span className="font-medium">
                  ₹{fmt(g.revenue)} · {g.quantity} items
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${colors.bg}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>

            {isOpen && (
              <div className="mt-2 ml-4 space-y-1.5">
                {g.categories
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((cat, i) => {
                    const catPct = g.revenue > 0 ? (cat.revenue / g.revenue) * 100 : 0;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>{cat.category_name}</span>
                          <span>₹{fmt(cat.revenue)} · {cat.quantity} items</span>
                        </div>
                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-0.5">
                          <div
                            className={`h-full rounded-full ${colors.bg} opacity-60`}
                            style={{ width: `${catPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
