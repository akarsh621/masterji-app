import './globals.css';
import { AuthProvider } from '@/context/auth';

export const metadata = {
  title: 'Master Ji Fashion House',
  description: 'Sales tracking app - Master Ji Fashion House, Shastri Nagar, Ghaziabad',
  manifest: '/manifest.json',
  // Hinglish in Latin script makes Chrome offer "Translate this page?", and
  // accepting it breaks the app. Tell browsers not to translate.
  other: { google: 'notranslate' },
};

// No maximumScale: staff must be able to pinch-zoom. Inputs are 16px+ so iOS
// doesn't auto-zoom on focus.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2563eb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" translate="no">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="min-h-screen">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
