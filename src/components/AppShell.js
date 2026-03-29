'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/context/auth';
import NewBill from '@/components/NewBill';
import TodaySummary from '@/components/TodaySummary';
import Dashboard from '@/components/Dashboard';
import SalesHistory from '@/components/SalesHistory';
import DayClose from '@/components/DayClose';
import Settings from '@/components/Settings';

const SALES_TABS = [
  { id: 'new-bill', label: 'Naya Bill', icon: '＋' },
  { id: 'today', label: 'Aaj', icon: '📊' },
  { id: 'history', label: 'Bill Book', icon: '📋' },
];

const ADMIN_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📈' },
  { id: 'new-bill', label: 'Naya Bill', icon: '＋' },
  { id: 'hisaab', label: 'Hisaab', icon: '💰' },
  { id: 'history', label: 'Bill Book', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function AppShell() {
  const { user, logout, dbMode } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? ADMIN_TABS : SALES_TABS;
  const [activeTab, setActiveTab] = useState(isAdmin ? 'dashboard' : 'new-bill');
  const [prefillData, setPrefillData] = useState(null);

  const handleVoidAndRecreate = useCallback((data) => {
    setPrefillData(data);
    setActiveTab('new-bill');
  }, []);

  const handlePrefillConsumed = useCallback(() => {
    setPrefillData(null);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'new-bill': return <NewBill prefillData={prefillData} onPrefillConsumed={handlePrefillConsumed} />;
      case 'today': return <TodaySummary />;
      case 'dashboard': return <Dashboard />;
      case 'hisaab': return <DayClose />;
      case 'history': return <SalesHistory onVoidAndRecreate={handleVoidAndRecreate} />;
      case 'settings': return <Settings />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen pb-20">
      {dbMode === 'dev' && (
        <div className="bg-amber-400 text-amber-900 text-center text-xs font-bold py-1 tracking-wider">
          DEV MODE — testing data, prod safe hai
        </div>
      )}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold text-blue-700">{user.name}</h1>
          <p className="text-xs text-gray-400">{isAdmin ? 'Admin' : 'Sales'} · Master Ji Fashion House</p>
        </div>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-red-600">
          Logout
        </button>
      </header>

      <main className="p-4 max-w-2xl mx-auto">
        {renderContent()}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-10">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-center transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-600 font-medium'
                  : 'text-gray-400'
              }`}
            >
              <div className="text-lg">{tab.icon}</div>
              <div className="text-xs mt-0.5">{tab.label}</div>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
