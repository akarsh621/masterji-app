import './globals.css';
import { AuthProvider } from '@/context/auth';

export const metadata = {
  title: 'Master Ji Fashion House',
  description: 'Sales tracking app - Master Ji Fashion House, Shastri Nagar, Ghaziabad',
  manifest: '/manifest.json',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="hi">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
