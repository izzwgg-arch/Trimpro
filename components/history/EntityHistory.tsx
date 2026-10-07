'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { History, FileText, Pencil, Trash2, Eye, Download, Send, DollarSign, Plus } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface HistoryItem {
  id: string
  source: 'activity' | 'audit'
  timestamp: string
  actor: string
  action: string | null
  text: string
  changedFields?: string[]
}

function iconFor(item: HistoryItem) {
  const a = item.action
  if (a === 'CREATE') return <Plus className="h-3.5 w-3.5 text-emerald-600" />
  if (a === 'UPDATE') return <Pencil className="h-3.5 w-3.5 text-blue-600" />
  if (a === 'DELETE') return <Trash2 className="h-3.5 w-3.5 text-red-600" />
  if (a === 'VIEW') return <Eye className="h-3.5 w-3.5 text-gray-500" />
  if (a === 'DOWNLOAD') return <Download className="h-3.5 w-3.5 text-indigo-600" />
  if (a === 'SEND') return <Send className="h-3.5 w-3.5 text-sky-600" />
  if (a === 'REFUND') return <DollarSign className="h-3.5 w-3.5 text-amber-600" />
  if (item.text.toLowerCase().includes('payment')) return <DollarSign className="h-3.5 w-3.5 text-green-600" />
  if (item.text.toLowerCase().includes('sent') || item.text.toLowerCase().includes('email')) return <Send className="h-3.5 w-3.5 text-sky-600" />
  return <FileText className="h-3.5 w-3.5 text-gray-400" />
}

export function EntityHistory({
  entityType,
  entityId,
  title = 'History',
  limit = 50,
}: {
  entityType: string
  entityId: string
  title?: string
  limit?: number
}) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    if (!entityId) return
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&limit=300`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 403) {
        setError('You do not have permission to view this history.')
        return
      }
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (e: any) {
      setError('Could not load history.')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  const shown = showAll ? items : items.slice(0, limit)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-5 w-5 text-gray-500" />
          {title}
          {items.length > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{items.length}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="py-4 text-sm text-gray-400">Loading history…</p>
        ) : error ? (
          <p className="py-4 text-sm text-gray-500">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-gray-400">No history yet.</p>
        ) : (
          <>
            <ol className="relative space-y-3 border-l border-gray-200 pl-4">
              {shown.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[22px] flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-gray-100">
                    {iconFor(item)}
                  </span>
                  <p className="text-sm text-gray-800">{item.text}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {item.actor} · {formatDateTime(item.timestamp)}
                  </p>
                </li>
              ))}
            </ol>
            {items.length > limit && (
              <button onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs font-medium text-blue-600 hover:underline">
                {showAll ? 'Show less' : `Show all ${items.length}`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
