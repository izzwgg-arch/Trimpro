'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FastPickerItem } from '@/components/items/FastPicker'

/** Map the API's created Item (Decimals serialized as strings) to a FastPickerItem
 *  so it can be dropped straight into the current estimate/invoice line. */
export function createdItemToPickerItem(raw: any): FastPickerItem {
  const num = (v: any): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const numOrNull = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    id: raw.id,
    name: raw.name,
    sku: raw.sku ?? null,
    kind: raw.kind === 'BUNDLE' ? 'BUNDLE' : 'SINGLE',
    defaultUnitPrice: num(raw.defaultUnitPrice),
    defaultUnitCost: numOrNull(raw.defaultUnitCost),
    pricingMode: raw.pricingMode === 'PERCENT_OF_ABOVE' ? 'PERCENT_OF_ABOVE' : 'FIXED',
    percentOfAboveRate: numOrNull(raw.percentOfAboveRate),
    unit: raw.unit || 'ea',
    vendorId: raw.vendorId ?? null,
    vendorName: raw.vendor?.name ?? null,
    taxable: raw.taxable ?? true,
    taxRate: numOrNull(raw.taxRate),
    description: raw.description ?? null,
    notes: raw.notes ?? null,
    tag: Array.isArray(raw.tags) ? raw.tags.join(', ') : null,
  }
}

const ITEM_TYPES = ['PRODUCT', 'SERVICE', 'MATERIAL', 'FEE'] as const

/**
 * Lightweight "quick add" for the item catalog, launched from the line-item
 * picker on an estimate/invoice. Saves the item to the system (POST /api/items)
 * without leaving the current document, then hands the created item back so the
 * caller can drop it into the current line.
 */
export function QuickCreateItemModal({
  open,
  onOpenChange,
  initialName = '',
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName?: string
  onCreated: (item: FastPickerItem) => void
}) {
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<(typeof ITEM_TYPES)[number]>('PRODUCT')
  const [unit, setUnit] = useState('ea')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setType('PRODUCT')
      setUnit('ea')
      setPrice('')
      setCost('')
      setTaxable(true)
      setError(null)
      setSaving(false)
    }
  }, [open, initialName])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: trimmed,
          type,
          unit: unit.trim() || 'ea',
          defaultUnitPrice: price === '' ? 0 : Number(price),
          defaultUnitCost: cost === '' ? null : Number(cost),
          taxable,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || (res.status === 403 ? 'You do not have permission to add catalog items.' : 'Failed to create item'))
        return
      }
      const data = await res.json()
      if (data?.item) onCreated(createdItemToPickerItem(data.item))
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Failed to create item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add new item</DialogTitle>
          <DialogDescription>Saved to your item catalog and added to this line. You stay on this document.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="qc-name">Name</Label>
            <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof ITEM_TYPES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-unit">Unit</Label>
              <Input id="qc-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ea" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="qc-price">Unit price</Label>
              <Input id="qc-price" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-cost">Unit cost (optional)</Label>
              <Input id="qc-cost" type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="h-4 w-4" />
            Taxable
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
