import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppProviders } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Trim Pro - Field Service Management',
  description: 'Production-ready FSM platform for millwork/trim/molding companies',
  icons: {
    icon: '/favicon-tp.svg',
    shortcut: '/favicon-tp.svg',
    apple: '/favicon-tp.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full bg-gray-100">
      <body className={`${inter.className} h-full bg-gray-100`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
