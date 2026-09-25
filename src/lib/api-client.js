'use client';

const API_BASE = '/api';

// A unique id for one save attempt. Sent with bills, returns and cash-outs so
// that retrying after a lost response can never create a duplicate.
export function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('masterji_token');
}

const TIMEOUT_MS = 20000;

// status 0 means the request never got an answer (no internet or timed out),
// so the caller can't know whether the server acted on it.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = 'masterji:unauthorized';

export async function apiRequest(endpoint, options = {}) {
  const { timeout = TIMEOUT_MS, rawResponse, ...fetchOptions } = options;
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...fetchOptions.headers,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { ...fetchOptions, headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new ApiError('Internet slow hai — jawab nahi aaya. Dobara try karo', 0);
    }
    throw new ApiError('Internet nahi mil raha — connection check karke dobara try karo', 0);
  }

  // Login expired or user deactivated: send everyone back to the login screen.
  // (Wrong PIN on the login screen itself is a normal 401, not a logout.)
  if (res.status === 401 && token && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (rawResponse) {
    clearTimeout(timer);
    return res;
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  clearTimeout(timer);

  if (!res.ok) {
    const fallback = res.status >= 500 || !isJson
      ? 'Server se jawab nahi aaya — thodi der baad try karo'
      : 'Kuch gadbad ho gayi';
    throw new ApiError(data?.error || fallback, res.status);
  }
  if (data === null) {
    throw new ApiError('Server se sahi jawab nahi aaya — dobara try karo', res.status);
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
  setPettyCashTarget: (amount) => apiRequest('/cash-drawer', { method: 'PATCH', body: JSON.stringify({ petty_cash_target: amount }) }),

  getCashOut: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/cash-out?${qs}`);
  },
  createCashOut: (body) => apiRequest('/cash-out', { method: 'POST', body: JSON.stringify(body) }),

  queuePrint: (billId) => apiRequest('/print-queue', { method: 'POST', body: JSON.stringify({ bill_id: billId }) }),

  getExpenses: (month) => apiRequest(`/expenses?month=${month}`),
  createExpense: (body) => apiRequest('/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id, body) => apiRequest(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteExpense: (id) => apiRequest(`/expenses/${id}`, { method: 'DELETE' }),
  copyExpenses: (body) => apiRequest('/expenses/copy', { method: 'POST', body: JSON.stringify(body) }),
  getExpenseLabels: (category) => apiRequest(`/expenses/labels?category=${category}`),

  getEarnings: (month) => apiRequest(`/earnings?month=${month}`),


  exportCSV: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/export?${qs}`, { rawResponse: true, timeout: 60000 });
  },
};
