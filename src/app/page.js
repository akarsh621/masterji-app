'use client';

import { useAuth } from '@/context/auth';
import LoginPage from '@/components/LoginPage';
import AppShell from '@/components/AppShell';

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600 mb-2">Master Ji</div>
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <AppShell />;
}
