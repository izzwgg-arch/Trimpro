'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Plus, X, Save, Play } from 'lucide-react'

interface ReportBuilderProps {
  onSave?: (report: any) => void
  onRun?: (report: any) => void
}

const AVAILABLE_DATASETS = [
  { value: 'jobs', label: 'Jobs' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'leads', label: 'Requests' },
  { value: 'clients', label: 'Clients' },
  { value: 'estimates', label: 'Estimates' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'issues', label: 'Issues' },
  { value: 'dispatch', label: 'Dispatch Events' },
]

const COMMON_COLUMNS: Record<string, Array<{ value: string; label: string }>> = {
  jobs: [
    { value: 'jobNumber', label: 'Job Number' },
    { value: 'title', label: 'Title' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'createdAt', label: 'Created Date' },
    { value: 'scheduledStart', label: 'Scheduled Start' },
    { value: 'client.name', label: 'Client Name' },
  ],
  invoices: [
    { value: 'invoiceNumber', label: 'Invoice Number' },
    { value: 'total', label: 'Total' },
    { value: 'balance', label: 'Balance' },
    { value: 'status', label: 'Status' },
    { value: 'dueDate', label: 'Due Date' },
    { value: 'createdAt', label: 'Created Date' },
    { value: 'client.name', label: 'Client Name' },
  ],
  leads: [
    { value: 'name', label: 'Name' },
    { value: 'source', label: 'Source' },
    { value: 'status', label: 'Status' },
    { value: 'createdAt', label: 'Created Date' },
    { value: 'convertedAt', label: 'Converted Date' },
  ],
  clients: [
    { value: 'name', label: 'Name' },
    { value: 'companyName', label: 'Company' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'createdAt', label: 'Created Date' },
  ],
}

export function ReportBuilder({ onSave, onRun }: ReportBuilderProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dataset, setDataset] = useState<string>('')
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<Array<{ field: string; operator: string; value: string }>>([])
  const [groupBy, setGroupBy] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const availableColumns = dataset ? (COMMON_COLUMNS[dataset] || []) : []

  const handleAddFilter = () => {
    setFilters([...filters, { field: '', operator: 'equals', value: '' }])
  }

  const handleRemoveFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index))
  }

  const handleColumnToggle = (column: string) => {
    if (selectedColumns.includes(column)) {
      setSelectedColumns(selectedColumns.filter((c) => c !== column))
    } else {
      setSelectedColumns([...selectedColumns, column])
    }
  }

  const handleSave = async () => {
    if (!name || !dataset) {
      alert('Please provide a name and select a dataset')
      return
    }

    const report = {
      name,
      description,
      type: 'CUSTOM',
      dataset,
      columns: selectedColumns,
      filters: filters.filter((f) => f.field && f.value),
      groupBy: groupBy || null,
      sorting: sortBy ? { field: sortBy, order: sortOrder } : null,
    }

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(report),
      })

      if (response.ok) {
        const data = await response.json()
        alert('Report saved successfully!')
        onSave?.(data.report)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to save report')
      }
    } catch (error) {
      console.error('Failed to save report:', error)
      alert('Failed to save report')
    }
  }

  const handleRun = async () => {
    if (!dataset) {
      alert('Please select a dataset')
      return
    }

    const report = {
      name: name || 'Quick Report',
      dataset,
      columns: selectedColumns.length > 0 ? selectedColumns : availableColumns.map((c) => c.value),
      filters: filters.filter((f) => f.field && f.value),
      groupBy: groupBy || null,
      sorting: sortBy ? { field: sortBy, order: sortOrder } : null,
    }

    onRun?.(report)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
          <CardDescription>Configure your custom report</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Report Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Monthly Jobs Report"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div>
              <Label htmlFor="dataset">Dataset *</Label>
              <Select value={dataset} onValueChange={(value) => {
                setDataset(value)
                setSelectedColumns([])
                setGroupBy('')
                setSortBy('')
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select dataset" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_DATASETS.map((ds) => (
                    <SelectItem key={ds.value} value={ds.value}>
                      {ds.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column Selection */}
          {dataset && (
            <div>
              <Label>Select Columns</Label>
              <div className="mt-2 space-y-2 max-h-48 overflow-y-auto border rounded-md p-4">
                {availableColumns.map((col) => (
                  <div key={col.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={col.value}
                      checked={selectedColumns.includes(col.value)}
                      onCheckedChange={() => handleColumnToggle(col.value)}
                    />
                    <label
                      htmlFor={col.value}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {col.label}
                    </label>
                  </div>
                ))}
              </div>
              {selectedColumns.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">Select at least one column</p>
              )}
            </div>
          )}

          {/* Filters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Filters</Label>
              <Button variant="outline" size="sm" onClick={handleAddFilter}>
                <Plus className="h-4 w-4 mr-2" />
                Add Filter
              </Button>
            </div>
            <div className="space-y-2">
              {filters.map((filter, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label>Field</Label>
                    <Select
                      value={filter.field}
                      onValueChange={(value) => {
                        const newFilters = [...filters]
                        newFilters[index].field = value
                        setFilters(newFilters)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableColumns.map((col) => (
                          <SelectItem key={col.value} value={col.value}>
                            {col.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <Label>Operator</Label>
                    <Select
                      value={filter.operator}
                      onValueChange={(value) => {
                        const newFilters = [...filters]
                        newFilters[index].operator = value
                        setFilters(newFilters)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">Equals</SelectItem>
                        <SelectItem value="notEquals">Not Equals</SelectItem>
                        <SelectItem value="contains">Contains</SelectItem>
                        <SelectItem value="greaterThan">Greater Than</SelectItem>
                        <SelectItem value="lessThan">Less Than</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label>Value</Label>
                    <Input
                      value={filter.value}
                      onChange={(e) => {
                        const newFilters = [...filters]
                        newFilters[index].value = e.target.value
                        setFilters(newFilters)
                      }}
                      placeholder="Filter value"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemoveFilter(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {filters.length === 0 && (
                <p className="text-sm text-gray-500">No filters added</p>
              )}
            </div>
          </div>

          {/* Group By */}
          {dataset && (
            <div>
              <Label htmlFor="groupBy">Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {availableColumns.map((col) => (
                    <SelectItem key={col.value} value={col.value}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Sorting */}
          {dataset && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sortBy">Sort By</Label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {availableColumns.map((col) => (
                      <SelectItem key={col.value} value={col.value}>
                        {col.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {sortBy && (
                <div>
                  <Label htmlFor="sortOrder">Order</Label>
                  <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Ascending</SelectItem>
                      <SelectItem value="desc">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} disabled={!name || !dataset}>
              <Save className="h-4 w-4 mr-2" />
              Save Report
            </Button>
            <Button variant="outline" onClick={handleRun} disabled={!dataset}>
              <Play className="h-4 w-4 mr-2" />
              Run Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
