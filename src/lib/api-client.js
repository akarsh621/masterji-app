'use client';

const API_BASE = '/api';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('masterji_token');
}

export async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (options.rawResponse) return res;

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Kuch gadbad ho gayi');
  }

  return data;
}

export const api = {
  login: (body) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => apiRequest('/auth/me'),
  getSalesmen: () => apiRequest('/auth/salesmen'),

  getCategories: (all) => apiRequest(`/categories${all ? '?all=true' : ''}`),
  createCategory: (body) => apiRequest('/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id, body) => apiRequest(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  createBill: (body) => apiRequest('/bills', { method: 'POST', body: JSON.stringify(body) }),
  returnBill: (id, body) => apiRequest(`/bills/${id}/return`, { method: 'POST', body: JSON.stringify(body) }),
  getBills: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/bills?${qs}`);
  },
  deleteBill: (id) => apiRequest(`/bills/${id}`, { method: 'DELETE' }),

  getDashboard: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/dashboard?${qs}`);
  },

  getUsers: () => apiRequest('/users'),
  createUser: (body) => apiRequest('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) => apiRequest(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteUser: (id) => apiRequest(`/users/${id}`, { method: 'DELETE' }),

  getHisaab: () => apiRequest('/hisaab'),

  getCashDrawer: () => apiRequest('/cash-drawer'),
  setCashDrawer: (amount) => apiRequest('/cash-drawer', { method: 'PUT', body: JSON.stringify({ amount }) }),

  getCashOut: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/cash-out?${qs}`);
  },
  createCashOut: (body) => apiRequest('/cash-out', { method: 'POST', body: JSON.stringify(body) }),

  queuePrint: (billId) => apiRequest('/print-queue', { method: 'POST', body: JSON.stringify({ bill_id: billId }) }),

  exportCSV: (params) => {
    const token = getToken();
    const qs = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/export?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};
