'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

type ClientOption = {
  id: string
  name: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
}

interface SearchableClientSelectProps {
  clients: ClientOption[]
  value: string
  onSelect: (clientId: string) => void
  placeholder?: string
}

export function SearchableClientSelect({
  clients,
  value,
  onSelect,
  placeholder = 'Select client...',
}: SearchableClientSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedClient = clients.find((c) => c.id === value) || null

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((client) => {
      const haystack = `${client.name} ${client.companyName || ''} ${client.email || ''} ${client.phone || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [clients, query])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm"
      >
        <span className={selectedClient ? 'text-foreground' : 'text-muted-foreground'}>
          {selectedClient
            ? `${selectedClient.name}${selectedClient.companyName ? ` — ${selectedClient.companyName}` : ''}`
            : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="p-2 border-b">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client..."
              className="h-9 w-full rounded-md border border-input px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E4A59]"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {filteredClients.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No clients found</div>
            ) : (
              filteredClients.map((client) => {
                const selected = client.id === value
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      onSelect(client.id)
                      setOpen(false)
                    }}
                    className={`group flex w-full items-start justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-[#2E4A59] hover:text-white ${
                      selected ? 'bg-[#2E4A59] text-white' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{client.name}</div>
                      <div
                        className={`truncate text-xs ${
                          selected ? 'text-white/90' : 'text-muted-foreground group-hover:text-white'
                        }`}
                      >
                        {[client.companyName, client.email, client.phone].filter(Boolean).join(' • ') || 'No extra details'}
                      </div>
                    </div>
                    {selected && <Check className="ml-2 h-4 w-4 shrink-0 text-white" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
