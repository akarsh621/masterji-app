'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api-client';

export default function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState('sales');
  const [salesmen, setSalesmen] = useState([]);
  const [selectedSalesman, setSelectedSalesman] = useState(null);
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getSalesmen().then(d => setSalesmen(d.salesmen)).catch(() => {});
  }, []);

  const handlePinInput = (digit) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4 && selectedSalesman) {
        handleSalesmanLogin(selectedSalesman, newPin);
      }
    }
  };

  const handlePinDelete = () => {
    setPin(pin.slice(0, -1));
  };

  const handleSalesmanLogin = async (salesman, pinCode) => {
    setError('');
    setLoading(true);
    try {
      await login({ salesman_id: salesman.id, pin: pinCode });
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username, password });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 bg-gradient-to-b from-blue-50 to-white">
      <div className="flex justify-end pt-2">
        {mode === 'sales' ? (
          <button
            onClick={() => { setMode('admin'); setError(''); setPin(''); setSelectedSalesman(null); }}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-4 py-1.5 rounded-lg transition-colors"
          >
            Admin
          </button>
        ) : (
          <button
            onClick={() => { setMode('sales'); setError(''); setPin(''); }}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-4 py-1.5 rounded-lg transition-colors"
          >
            ← Sales Team
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-blue-700">Master Ji Fashion House</h1>
            <p className="text-xs text-gray-400 mt-1">Shastri Nagar, Ghaziabad</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {mode === 'sales' ? (
            <div className="card">
              <div className="grid grid-cols-1 gap-2 mb-4">
                {salesmen.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSalesman(s); setPin(''); setError(''); }}
                    className={`p-3 rounded-lg text-left font-medium transition-colors ${
                      selectedSalesman?.id === s.id
                        ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>

              {selectedSalesman && (
                <>
                  <p className="text-sm text-gray-600 mb-2">PIN daalo:</p>
                  <div className="flex justify-center gap-2 mb-4">
                    {[0, 1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${
                          i < pin.length
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200'
                        }`}
                      >
                        {i < pin.length ? '●' : ''}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((d, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (d === 'del') handlePinDelete();
                          else if (d !== null) handlePinInput(String(d));
                        }}
                        disabled={d === null || loading}
                        className={`h-14 rounded-lg text-lg font-medium transition-colors ${
                          d === null
                            ? 'invisible'
                            : d === 'del'
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-gray-50 text-gray-800 hover:bg-gray-100 active:bg-gray-200'
                        }`}
                      >
                        {d === 'del' ? '⌫' : d}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={handleAdminLogin} className="card space-y-4">
              <h3 className="font-medium text-gray-700 text-center">Admin Login</h3>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="input"
                  required
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                  required
                  autoComplete="current-password"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Loading...' : 'Login'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
