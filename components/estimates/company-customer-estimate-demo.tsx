'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Trash2,
  RefreshCw,
  Building2,
  User,
  Link2,
  Eye,
  EyeOff,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchableClientSelect } from '@/components/ui/searchable-client-select'
import { FastPicker, type FastPickerItem } from '@/components/items/FastPicker'
import { fetchAllPickerClients, type PickerClient } from '@/lib/clients/fetch-all-picker-clients'
import {
  type CompanyItem,
  type CompanyLine,
  type CustomerLine,
  applyCustomerEdit,
  companyLineTotal,
  companyLinesToApiPayload,
  createBlankCompanyItem,
  createDemoCompanyLines,
  formatMoney,
  lineItemTotal,
  syncCustomerLines,
} from '@/lib/estimates/company-customer-sync'

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function VisibilityEye({
  visible,
  onToggle,
  titleOn,
  titleOff,
}: {
  visible: boolean
  onToggle: () => void
  titleOn: string
  titleOff: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      tabIndex={-1}
      onClick={onToggle}
      title={visible ? titleOn : titleOff}
      className="visibility-toggle-btn h-6 px-1"
    >
      {visible ? (
        <Eye className="h-3 w-3 text-gray-600" />
      ) : (
        <EyeOff className="h-3 w-3 text-gray-400" />
      )}
    </Button>
  )
}

export function CompanyCustomerEstimateDemo() {
  const router = useRouter()
  const [companyLines, setCompanyLines] = useState<CompanyLine[]>(() => createDemoCompanyLines())
  const [customerLines, setCustomerLines] = useState<CustomerLine[]>(() =>
    syncCustomerLines(createDemoCompanyLines(), [])
  )
  const [lastSyncNote, setLastSyncNote] = useState(
    'Loaded example with full estimate line fields (name, description, qty, price, cost, tax, visibility).'
  )
  const [activeTab, setActiveTab] = useState('company')
  const [clients, setClients] = useState<PickerClient[]>([])
  const [pickerItems, setPickerItems] = useState<FastPickerItem[]>([])
  const [pickerBundles, setPickerBundles] = useState<FastPickerItem[]>([])
  const [clientId, setClientId] = useState('')
  const [title, setTitle] = useState('Kitchen + bath dual estimate demo')
  const [taxRate, setTaxRate] = useState('8.875')
  const [discount, setDiscount] = useState('0')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) return

    fetchAllPickerClients()
      .then((list) => {
        setClients(list)
        if (list[0]?.id) setClientId((prev) => prev || list[0].id)
      })
      .catch(() => setClients([]))

    fetch('/api/items/picker', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setPickerItems(Array.isArray(data.items) ? data.items : [])
        setPickerBundles(Array.isArray(data.bundles) ? data.bundles : [])
      })
      .catch(() => {
        setPickerItems([])
        setPickerBundles([])
      })
  }, [])

  const companyGrandTotal = companyLines.reduce((sum, line) => sum + companyLineTotal(line), 0)
  const customerGrandTotal = customerLines.reduce((sum, line) => sum + (Number(line.total) || 0), 0)
  const discountNum = parseFloat(discount || '0') || 0
  const taxRateNum = (parseFloat(taxRate || '0') || 0) / 100
  const subtotalAfterDiscount = Math.max(0, companyGrandTotal - discountNum)
  const taxAmount = Math.round(subtotalAfterDiscount * taxRateNum * 100) / 100
  const estimateTotal = Math.round((subtotalAfterDiscount + taxAmount) * 100) / 100

  const touchCompanyLine = (
    lineId: string,
    updater: (lines: CompanyLine[]) => CompanyLine[]
  ) => {
    setCompanyLines((prev) => {
      const next = updater(prev)
      setCustomerLines((prevCustomer) => syncCustomerLines(next, prevCustomer, [lineId]))
      const line = next.find((l) => l.id === lineId)
      setLastSyncNote(
        line
          ? `Company Line #${line.lineNumber} edited → customer line rebuilt from item descriptions + summed totals.`
          : 'Company line removed → customer estimate updated.'
      )
      return next
    })
  }

  const addCustomerLine = () => {
    const lineNumber = companyLines.length + 1
    const id = uid('line')
    const newLine: CompanyLine = {
      id,
      lineNumber,
      title: '',
      items: [createBlankCompanyItem()],
    }
    setCompanyLines((prev) => {
      const next = [...prev, newLine]
      setCustomerLines((prevCustomer) => syncCustomerLines(next, prevCustomer, [id]))
      setLastSyncNote(`Added Line #${lineNumber}.`)
      return next
    })
  }

  const removeCompanyLine = (lineId: string) => {
    setCompanyLines((prev) => {
      const next = prev
        .filter((l) => l.id !== lineId)
        .map((l, i) => ({ ...l, lineNumber: i + 1 }))
      setCustomerLines((prevCustomer) => syncCustomerLines(next, prevCustomer, [lineId]))
      setLastSyncNote('Removed a company line → matching customer bundle removed.')
      return next
    })
  }

  const updateLineTitle = (lineId: string, nextTitle: string) => {
    touchCompanyLine(lineId, (prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, title: nextTitle } : l))
    )
  }

  const addItem = (lineId: string) => {
    touchCompanyLine(lineId, (prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, items: [...l.items, createBlankCompanyItem()] } : l
      )
    )
  }

  const updateItem = (lineId: string, itemId: string, patch: Partial<CompanyItem>) => {
    touchCompanyLine(lineId, (prev) =>
      prev.map((l) =>
        l.id !== lineId
          ? l
          : {
              ...l,
              items: l.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
      )
    )
  }

  const removeItem = (lineId: string, itemId: string) => {
    touchCompanyLine(lineId, (prev) =>
      prev.map((l) =>
        l.id !== lineId
          ? l
          : { ...l, items: l.items.filter((item) => item.id !== itemId) }
      )
    )
  }

  const applyPickerSelection = (lineId: string, itemId: string, selected: FastPickerItem) => {
    updateItem(lineId, itemId, {
      description: selected.name || '',
      notes: selected.description || selected.notes || '',
      unitPrice: String(selected.defaultUnitPrice ?? 0),
      unitCost: selected.defaultUnitCost != null ? String(selected.defaultUnitCost) : '',
      sourceItemId: selected.kind === 'BUNDLE' ? undefined : selected.id,
      sourceBundleId: selected.kind === 'BUNDLE' ? selected.bundleId || selected.id : undefined,
      taxable: selected.taxable !== false,
      taxRate: selected.taxRate != null ? String(selected.taxRate) : '',
      vendorId: selected.vendorId || undefined,
      vendorName: selected.vendorName || undefined,
    })
  }

  const editCustomer = (
    lineId: string,
    patch: Partial<Pick<CustomerLine, 'description' | 'total' | 'title'>>
  ) => {
    setCustomerLines((prev) => applyCustomerEdit(prev, lineId, patch))
    setLastSyncNote(
      'Customer edit saved and will stick until this same line is edited on the company estimate.'
    )
  }

  const resetExample = () => {
    const demo = createDemoCompanyLines()
    setCompanyLines(demo)
    setCustomerLines(syncCustomerLines(demo, []))
    setTitle('Kitchen + bath dual estimate demo')
    setTaxRate('8.875')
    setDiscount('0')
    setSaveError(null)
    setLastSyncNote('Example reset with full line-item fields.')
    setActiveTab('company')
  }

  const handleSave = async () => {
    setSaveError(null)
    if (!clientId) {
      setSaveError('Select a client before saving.')
      return
    }
    if (!title.trim()) {
      setSaveError('Enter an estimate title before saving.')
      return
    }
    if (companyLines.length === 0 || companyLines.every((l) => l.items.length === 0)) {
      setSaveError('Add at least one company line item before saving.')
      return
    }

    const token = localStorage.getItem('accessToken')
    if (!token) {
      setSaveError('Not signed in. Use Dev Login first.')
      return
    }

    setSaving(true)
    try {
      const { groups, lineItems } = companyLinesToApiPayload(companyLines, customerLines)
      const response = await fetch('/api/estimates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId,
          title: title.trim(),
          subtotal: companyGrandTotal,
          taxRate: taxRateNum,
          taxAmount,
          discount: discountNum,
          total: estimateTotal,
          notes:
            'Created from company/customer dual-estimate demo. Customer bundles are derived from Line # groups.',
          isNotesVisibleToClient: false,
          lineItems,
          optionalItems: [],
          groups,
          // Pass customer snapshot for the after-save view (stored in session)
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create estimate' }))
        setSaveError(errorData.error || 'Failed to create estimate')
        return
      }

      const data = await response.json()
      const estimateId = data.estimate?.id as string
      try {
        sessionStorage.setItem(
          `dual-estimate-customer:${estimateId}`,
          JSON.stringify(customerLines)
        )
      } catch {
        // ignore storage failures
      }
      router.push(`/dashboard/estimates/company-customer-demo/saved/${estimateId}`)
      // Hard navigate if client transition stalls in dev
      window.setTimeout(() => {
        if (!window.location.pathname.includes(`/saved/${estimateId}`)) {
          window.location.assign(`/dashboard/estimates/company-customer-demo/saved/${estimateId}`)
        }
      }, 400)
    } catch (error) {
      console.error(error)
      setSaveError('Failed to create estimate. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Dev demo — dual estimate (company + customer)</p>
        <p className="mt-1 text-amber-900/90">
          Company items use the same fields as the real estimate (name, description, qty, price,
          cost, tax, eye toggles). Customer page shows one bundle per Line #. Save creates a real
          draft estimate, then opens the after-save view.
        </p>
        <p className="mt-2 text-amber-800">{lastSyncNote}</p>
      </div>

      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Client</Label>
          <SearchableClientSelect
            clients={clients}
            value={clientId}
            onSelect={setClientId}
            placeholder="Select client"
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Tax rate %</Label>
          <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Discount $</Label>
          <Input value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end text-sm sm:col-span-2">
          <span>
            Subtotal {formatMoney(companyGrandTotal)} · Tax {formatMoney(taxAmount)} · Total{' '}
            <strong>{formatMoney(estimateTotal)}</strong>
          </span>
          <span className="text-xs text-muted-foreground">
            Customer bundles total {formatMoney(customerGrandTotal)} (before estimate tax/discount)
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={resetExample}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reset example
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={addCustomerLine}>
          <Plus className="mr-2 h-4 w-4" />
          Add Line #{companyLines.length + 1}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save estimate'}
        </Button>
        {saveError && <span className="text-sm text-red-600">{saveError}</span>}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="company" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            Company estimate
          </TabsTrigger>
          <TabsTrigger value="customer" className="gap-1.5">
            <User className="h-4 w-4" />
            Customer estimate
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link2 className="h-4 w-4" />
            Same fields as create estimate · Line # groups become customer bundles · QB sync uses
            these rows
          </div>

          {companyLines.map((line) => {
            const customer = customerLines.find((c) => c.id === line.id)
            return (
              <div key={line.id} className="rounded-lg border border-slate-300 bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                    Line #{line.lineNumber}
                  </span>
                  <Input
                    className="h-8 max-w-xs bg-white"
                    placeholder="Bundle title (e.g. Kitchen remodel)"
                    value={line.title}
                    onChange={(e) => updateLineTitle(line.id, e.target.value)}
                  />
                  {customer?.customerEdited && (
                    <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Customer has manual edits (overwrite if you change items here)
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {formatMoney(companyLineTotal(line))}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => removeCompanyLine(line.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  {line.items.map((item) => (
                    <CompanyItemRow
                      key={item.id}
                      item={item}
                      pickerItems={pickerItems}
                      pickerBundles={pickerBundles}
                      onChange={(patch) => updateItem(line.id, item.id, patch)}
                      onPick={(selected) => applyPickerSelection(line.id, item.id, selected)}
                      onRemove={() => removeItem(line.id, item.id)}
                      canRemove={line.items.length > 1}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addItem(line.id)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add item under Line #{line.lineNumber}
                  </Button>
                </div>
              </div>
            )
          })}
        </TabsContent>

        <TabsContent value="customer" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            Bundled customer view — editable; sticks until matching company line changes
          </div>

          {customerLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-slate-300 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-emerald-50/80 px-3 py-2">
                <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs font-semibold text-white">
                  Line #{line.lineNumber}
                </span>
                <Input
                  className="h-8 max-w-xs bg-white"
                  value={line.title}
                  onChange={(e) => editCustomer(line.id, { title: e.target.value })}
                />
                {line.customerEdited ? (
                  <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    Manual edit — sticky
                  </span>
                ) : (
                  <span className="rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                    Synced from company
                  </span>
                )}
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-[1fr_160px]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Description (each company item description on its own row)
                  </label>
                  <Textarea
                    className="min-h-[110px] font-mono text-sm"
                    value={line.description}
                    onChange={(e) => editCustomer(line.id, { description: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Line total
                  </label>
                  <Input
                    type="number"
                    step={0.01}
                    value={line.total}
                    onChange={(e) =>
                      editCustomer(line.id, { total: Number(e.target.value) || 0 })
                    }
                  />
                  <p className="mt-2 text-lg font-semibold">{formatMoney(line.total)}</p>
                </div>
              </div>
            </div>
          ))}

          <div className="flex justify-end border-t pt-3 text-base font-semibold">
            Customer estimate total: {formatMoney(customerGrandTotal)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CompanyItemRow({
  item,
  pickerItems,
  pickerBundles,
  onChange,
  onPick,
  onRemove,
  canRemove,
}: {
  item: CompanyItem
  pickerItems: FastPickerItem[]
  pickerBundles: FastPickerItem[]
  onChange: (patch: Partial<CompanyItem>) => void
  onPick: (selected: FastPickerItem) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div
      data-line-item-row
      className={`flex flex-wrap gap-2 items-start rounded border p-2 ${
        item.isVisibleToClient === false ? 'border-gray-300 opacity-80' : 'border-gray-300'
      }`}
    >
      <div className="flex flex-col gap-1 items-center shrink-0 pt-1">
        <VisibilityEye
          visible={item.isVisibleToClient !== false}
          onToggle={() =>
            onChange({ isVisibleToClient: item.isVisibleToClient === false ? true : false })
          }
          titleOn="Hide entire line from customer"
          titleOff="Show line to customer"
        />
      </div>

      <div className="line-item-field-wide flex-1 min-w-[220px] space-y-1">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-gray-500">Name</Label>
          <VisibilityEye
            visible={item.showDescriptionToCustomer}
            onToggle={() =>
              onChange({ showDescriptionToCustomer: !item.showDescriptionToCustomer })
            }
            titleOn="Hide item name from customer"
            titleOff="Show item name to customer"
          />
        </div>
        <FastPicker
          value={item.description}
          onChange={(value) => onChange({ description: value })}
          onSelect={onPick}
          items={pickerItems}
          bundles={pickerBundles}
          placeholder="Type to search items..."
          className="w-full"
        />
        <div className="flex items-center gap-1">
          <Label className="text-xs text-gray-500">Description</Label>
          <VisibilityEye
            visible={item.showNotesToCustomer}
            onToggle={() => onChange({ showNotesToCustomer: !item.showNotesToCustomer })}
            titleOn="Hide description from customer"
            titleOff="Show description to customer"
          />
        </div>
        <textarea
          value={item.notes || ''}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Description (optional)"
          rows={1}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
        />
      </div>

      <div className="line-item-field-numeric">
        <Label className="mb-1 block text-xs text-gray-500">Quantity</Label>
        <Input
          type="number"
          step="0.01"
          value={item.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
        />
      </div>

      <div className="line-item-field-numeric">
        <div className="mb-1 flex items-center gap-1">
          <Label className="text-xs text-gray-500">Price</Label>
          <VisibilityEye
            visible={item.showPriceToCustomer}
            onToggle={() => onChange({ showPriceToCustomer: !item.showPriceToCustomer })}
            titleOn="Hide price from customer"
            titleOff="Show price to customer"
          />
        </div>
        <Input
          type="number"
          step="0.01"
          value={item.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
        />
      </div>

      <div className="line-item-field-numeric">
        <div className="mb-1 flex items-center gap-1">
          <Label className="text-xs text-gray-500">Cost</Label>
          <VisibilityEye
            visible={item.showCostToCustomer}
            onToggle={() => onChange({ showCostToCustomer: !item.showCostToCustomer })}
            titleOn="Hide cost from customer"
            titleOff="Show cost to customer"
          />
        </div>
        <Input
          type="number"
          step="0.01"
          min="0"
          className="bg-gray-50"
          value={item.unitCost}
          onChange={(e) => onChange({ unitCost: e.target.value })}
        />
      </div>

      <div className="line-item-field-numeric">
        <div className="mb-1 flex items-center gap-1">
          <Label className="text-xs text-gray-500">Tax</Label>
          <VisibilityEye
            visible={item.showTaxToCustomer}
            onToggle={() => onChange({ showTaxToCustomer: !item.showTaxToCustomer })}
            titleOn="Hide tax from customer"
            titleOff="Show tax to customer"
          />
        </div>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={item.taxable}
            onChange={(e) => onChange({ taxable: e.target.checked })}
            className="h-4 w-4"
            title="Taxable"
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="%"
            className="w-16 text-xs"
            value={item.taxRate}
            onChange={(e) => onChange({ taxRate: e.target.value })}
          />
        </div>
      </div>

      <div className="line-item-field-numeric">
        <Label className="mb-1 block text-xs text-gray-500">Total</Label>
        <div className="rounded border bg-gray-50 px-3 py-2 text-right font-medium">
          {formatMoney(lineItemTotal(item))}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-red-600 shrink-0"
        onClick={onRemove}
        disabled={!canRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
