'use client'

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react'
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
  inputRef?: (el: HTMLInputElement | null) => void // Callback to expose input ref
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
  inputRef: inputRefCallback,
}: FastPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredItems, setFilteredItems] = useState<FastPickerItem[]>([])
  
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const isSelectingRef = useRef(false) // Prevent race conditions

  // Expose input ref to parent
  useEffect(() => {
    if (inputRefCallback && inputRef.current) {
      inputRefCallback(inputRef.current)
    }
    return () => {
      if (inputRefCallback) {
        inputRefCallback(null)
      }
    }
  }, [inputRefCallback])

  // Combine items and bundles
  const allItems = useRef<FastPickerItem[]>([])
  
  useEffect(() => {
    allItems.current = [
      ...items.map(item => ({ ...item, kind: 'SINGLE' as const })),
      ...bundles.map(bundle => ({ ...bundle, kind: 'BUNDLE' as const })),
    ]
    // Always update filtered items when items/bundles change
    setFilteredItems(allItems.current)
    setSelectedIndex(0)
  }, [items, bundles])

  // Debounced search filter
  const debouncedFilter = useDebouncedCallback((query: string) => {
    if (!query.trim()) {
      setFilteredItems(allItems.current)
      setSelectedIndex(0)
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
        setSelectedIndex(0)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen])

  const handleSelect = useCallback((item: FastPickerItem) => {
    if (isSelectingRef.current) return // Prevent duplicate selections
    isSelectingRef.current = true

    // Close dropdown first to prevent any visual glitches
    setIsOpen(false)
    setSearchQuery('')
    setSelectedIndex(0)

    // Update the input value immediately so user sees the selection
    onChange(item.name)
    
    // Call onSelect to populate all line item data
    // onSelect may be async, so handle it properly
    const selectResult = onSelect(item)
    
    // Auto-advance to next line after ensuring state updates complete
    if (onNextLine) {
      // If onSelect returns a promise, wait for it
      if (selectResult && typeof selectResult.then === 'function') {
        selectResult.then(() => {
          // Wait a bit more to ensure React has processed the state update
          setTimeout(() => {
            onNextLine()
            isSelectingRef.current = false
          }, 50)
        }).catch((err) => {
          console.error('Error in onSelect:', err)
          // Even if there's an error, still move to next line
          setTimeout(() => {
            onNextLine()
            isSelectingRef.current = false
          }, 50)
        })
      } else {
        // onSelect is synchronous, use a delay to ensure React state updates
        setTimeout(() => {
          onNextLine()
          isSelectingRef.current = false
        }, 150)
      }
    } else {
      isSelectingRef.current = false
    }
  }, [onChange, onSelect, onNextLine])

  // Handle committing current text as custom entry (no item selected)
  const handleCommitCustom = useCallback(() => {
    if (isSelectingRef.current) return
    isSelectingRef.current = true

    // Get the current input value
    const currentValue = inputRef.current?.value || value
    
    // Ensure the current value is committed via onChange
    if (currentValue.trim()) {
      onChange(currentValue.trim())
    }

    // Close dropdown
    setIsOpen(false)
    setSearchQuery('')
    setSelectedIndex(0)
    
    // Auto-advance to next line after ensuring state is committed
    if (onNextLine) {
      // Give time for the onChange state update to complete
      setTimeout(() => {
        onNextLine()
        isSelectingRef.current = false
      }, 100)
    } else {
      isSelectingRef.current = false
    }
  }, [onNextLine, onChange, value])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        if (!isOpen) {
          setIsOpen(true)
          setSelectedIndex(0)
        } else {
          setSelectedIndex(prev => 
            prev < filteredItems.length - 1 ? prev + 1 : prev
          )
        }
        break

      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        if (isOpen) {
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
        }
        break

      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        if (isOpen) {
          // Dropdown is open
          if (filteredItems.length > 0) {
            // There are filtered items - select the highlighted one (or first if index is invalid)
            const indexToSelect = (selectedIndex >= 0 && selectedIndex < filteredItems.length) 
              ? selectedIndex 
              : 0
            const selected = filteredItems[indexToSelect]
            if (selected) {
              handleSelect(selected)
            } else {
              // Fallback: select first item
              handleSelect(filteredItems[0])
            }
          } else {
            // No items found, commit current text as custom entry
            handleCommitCustom()
          }
        } else {
          // Dropdown is closed - open it first
          setIsOpen(true)
          setSelectedIndex(0)
        }
        break

      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
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
        if (!isOpen && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          setIsOpen(true)
        }
        break
    }
  }, [isOpen, filteredItems, selectedIndex, disabled, handleSelect])

  // Handle input focus - opens dropdown immediately
  const handleInputFocus = useCallback(() => {
    if (!disabled) {
      setIsOpen(true)
      // Reset search when opening
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [disabled])

  // Handle input click - ensures dropdown opens
  const handleInputClick = useCallback(() => {
    if (!disabled && !isOpen) {
      setIsOpen(true)
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [disabled, isOpen])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setSearchQuery(newValue)
    if (!isOpen) {
      setIsOpen(true)
    }
  }, [onChange, isOpen])

  // Handle item click
  const handleItemClick = useCallback((item: FastPickerItem) => {
    handleSelect(item)
  }, [handleSelect])

  // Handle mouse enter on item (update selected index)
  const handleItemMouseEnter = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onClick={handleInputClick}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
        data-picker-input="true"
      />
      
      {/* Dropdown */}
      {isOpen && filteredItems.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-[100] w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-[400px] overflow-y-auto mt-1"
          style={{ maxHeight: `${VISIBLE_ITEMS * ITEM_HEIGHT}px` }}
        >
          {filteredItems.map((item, index) => {
            const isSelected = index === selectedIndex
            const isBundle = item.kind === 'BUNDLE'

            return (
              <div
                key={`${item.id}-${item.kind}-${index}`}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                className={`px-4 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-100 border-l-2 border-blue-500'
                    : 'hover:bg-gray-50'
                }`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleItemClick(item)
                }}
                onMouseEnter={() => handleItemMouseEnter(index)}
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
          })}
        </div>
      )}
      
      {/* No items found */}
      {isOpen && filteredItems.length === 0 && (
        <div className="absolute z-[100] w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1">
          <div className="px-4 py-8 text-center text-gray-500">
            No items found
          </div>
        </div>
      )}
    </div>
  )
}
