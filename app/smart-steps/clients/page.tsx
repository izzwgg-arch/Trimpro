'use client'
import { redirect } from 'next/navigation'
// /smart-steps/clients redirects to the main dashboard which IS the client list
export default function ClientsPage() {
  redirect('/smart-steps')
}
