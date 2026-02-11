'use client'

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Input } from '@/components/ui/input'
import { Package } from 'lucide-react'
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback'

export interface FastPickerItem {
  id: string
  name: string
  sku: string | null
  kind: 'SINGLE' | 'BUNDLE'
  defaultUnitPrice: number
  defaultUnitCost: number | null
  unit: string
  vendorId: string | null
  vendorName: string | null
  taxable: boolean
  taxRate: number | null
  notes: string | null
  // For bundles
  bundleId?: string
}

interface FastPickerProps {
  value: string
  onChange: (value: string) => void
  onSelect: (item: FastPickerItem) => void
  onNextLine?: () => void // Called after Enter to move to next line
  items: FastPickerItem[]
  bundles: FastPickerItem[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

const ITEM_HEIGHT = 48 // Height of each item in pixels
const VISIBLE_ITEMS = 8 // Number of items visible without scrolling

export function FastPicker({
  value,
  onChange,
  onSelect,
  onNextLine,
  items = [],
  bundles = [],
  placeholder = 'Type to search items...',
  disabled = false,
  className = '',
}: FastPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredItems, setFilteredItems] = useState<FastPickerItem[]>([])
  
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Combine items and bundles
  const allItems = useRef<FastPickerItem[]>([])
  
  useEffect(() => {
    allItems.current = [
      ...items.map(item => ({ ...item, kind: 'SINGLE' as const })),
      ...bundles.map(bundle => ({ ...bundle, kind: 'BUNDLE' as const })),
    ]
  }, [items, bundles])

  // Debounced search filter
  const debouncedFilter = useDebouncedCallback((query: string) => {
    if (!query.trim()) {
      setFilteredItems(allItems.current)
      return
    }

    const lowerQuery = query.toLowerCase()
    const filtered = allItems.current.filter(item => {
      const nameMatch = item.name.toLowerCase().includes(lowerQuery)
      const skuMatch = item.sku?.toLowerCase().includes(lowerQuery)
      return nameMatch || skuMatch
    })
    
    setFilteredItems(filtered)
    setSelectedIndex(0) // Reset selection when filtering
  }, 150)

  useEffect(() => {
    debouncedFilter(searchQuery)
  }, [searchQuery, debouncedFilter])

  // Initialize filtered items
  useEffect(() => {
    if (allItems.current.length > 0 && filteredItems.length === 0) {
      setFilteredItems(allItems.current)
    }
  }, [filteredItems.length])

  // Focus management
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to ensure popover is rendered
      setTimeout(() => {
        inputRef.current?.focus()
        setSearchQuery('')
        setSelectedIndex(0)
      }, 10)
    }
  }, [isOpen])

  // Scroll selected item into view
  useEffect(() => {
    if (isOpen && listRef.current && selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      const selectedElement = itemRefs.current[selectedIndex]
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        })
      }
    }
  }, [selectedIndex, isOpen])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
        } else {
          setSelectedIndex(prev => 
            prev < filteredItems.length - 1 ? prev + 1 : prev
          )
        }
        break

      case 'ArrowUp':
        e.preventDefault()
        if (isOpen) {
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
        }
        break

      case 'Enter':
        e.preventDefault()
        if (isOpen && filteredItems.length > 0 && filteredItems[selectedIndex]) {
          const selected = filteredItems[selectedIndex]
          handleSelect(selected)
        } else if (!isOpen) {
          setIsOpen(true)
        }
        break

      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearchQuery('')
        setSelectedIndex(0)
        inputRef.current?.blur()
        break

      case 'Tab':
        // Allow tab to close and move to next field
        if (isOpen) {
          setIsOpen(false)
          setSearchQuery('')
          setSelectedIndex(0)
        }
        break

      default:
        // Any other key opens the picker if it's closed
        if (!isOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
          setIsOpen(true)
        }
        break
    }
  }, [isOpen, filteredItems, selectedIndex, disabled])

  const handleSelect = useCallback((item: FastPickerItem) => {
    onChange(item.name)
    onSelect(item)
    setIsOpen(false)
    setSearchQuery('')
    setSelectedIndex(0)
    
    // Auto-advance to next line
    if (onNextLine) {
      // Small delay to ensure state updates complete
      setTimeout(() => {
        onNextLine()
      }, 50)
    }
  }, [onChange, onSelect, onNextLine])

  const handleInputFocus = useCallback(() => {
    if (!disabled) {
      setIsOpen(true)
    }
  }, [disabled])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setSearchQuery(newValue)
    if (!isOpen) {
      setIsOpen(true)
    }
  }, [onChange, isOpen])

  // Prevent duplicate selections
  const lastSelectedRef = useRef<string | null>(null)
  const handleItemClick = useCallback((item: FastPickerItem) => {
    const itemKey = `${item.id}-${Date.now()}`
    if (lastSelectedRef.current === itemKey) {
      return // Prevent duplicate
    }
    lastSelectedRef.current = itemKey
    handleSelect(item)
  }, [handleSelect])

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
          autoComplete="off"
          data-picker-input="true"
        />
      </Popover.Trigger>
      
      <Popover.Portal>
        <Popover.Content
          className="z-[100] w-[var(--radix-popover-trigger-width)] bg-white border border-gray-200 rounded-md shadow-lg max-h-[400px] overflow-hidden"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Search input inside popover */}
          <div className="p-2 border-b border-gray-200">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              className="w-full"
              autoComplete="off"
              onKeyDown={handleKeyDown}
            />
          </div>

          {/* Items list */}
          <div
            ref={listRef}
            className="overflow-y-auto max-h-[320px]"
            style={{ maxHeight: `${VISIBLE_ITEMS * ITEM_HEIGHT}px` }}
          >
            {filteredItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                No items found
              </div>
            ) : (
              filteredItems.map((item, index) => {
                const isSelected = index === selectedIndex
                const isBundle = item.kind === 'BUNDLE'

                return (
                  <div
                    key={`${item.id}-${item.kind}`}
                    ref={(el) => {
                      itemRefs.current[index] = el
                    }}
                    className={`px-4 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-100 border-l-2 border-blue-500'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <Package className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="font-medium truncate">{item.name}</span>
                        {isBundle && (
                          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded flex-shrink-0">
                            Bundle
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 flex-shrink-0 ml-2">
                        {!isBundle && item.defaultUnitPrice != null && (
                          <span>${Number(item.defaultUnitPrice).toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                    {item.sku && (
                      <div className="text-xs text-gray-500 mt-1 ml-6">
                        SKU: {item.sku}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
