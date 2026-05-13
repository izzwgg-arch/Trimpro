/**
 * Spreadsheet-style vertical navigation for line-item grids
 * (estimates, invoices, purchase orders, proposals, reusable line-item editors).
 *
 * The single rule this module enforces:
 *   Shift+Enter inside a line-item input must focus the SAME COLUMN in the
 *   NEXT ROW. If the next row does not exist, exactly one new row is created
 *   and the same column on that new row receives focus.
 *
 * Deliberate non-goals:
 *   - Never falls back to the first field / description picker on focus failure.
 *   - Never delegates to generic "next line" / "add item" helpers.
 *   - Never reuses horizontal Enter-as-Tab logic.
 *
 * Required DOM contract in caller pages:
 *   - Each line-item row container element MUST have:
 *       data-line-item-row="<index>"
 *   - Each non-description input MUST have:
 *       data-col="quantity" | "unitPrice" | "unitCost" | "notes"
 *   - The description picker input MUST have:
 *       data-picker-input="true"   (FastPicker already sets this)
 *
 * The helper uses live DOM queries (not React refs) so it works correctly
 * after React commits a newly added row, regardless of callback-ref timing.
 */

export type LineItemColumn =
  | 'description'
  | 'quantity'
  | 'unitPrice'
  | 'unitCost'
  | 'notes'

export interface FocusSameColumnNextRowOptions {
  /**
   * Called when the next row does not exist yet. Must add exactly one new row
   * synchronously (e.g. via setLineItems(prev => [...prev, defaultRow])).
   * The helper will then wait for React to commit and focus the new row.
   */
  onCreateRow?: () => void
  /**
   * Maximum number of animation frames to wait for the target element to
   * appear in the DOM. Defaults to 12 (~200ms at 60fps).
   */
  maxAttempts?: number
}

function selectorForColumn(col: LineItemColumn): string {
  return col === 'description'
    ? '[data-picker-input="true"]'
    : `[data-col="${col}"]`
}

function findRowEl(rowIndex: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-line-item-row="${rowIndex}"]`,
  )
}

function findTargetInput(
  rowIndex: number,
  col: LineItemColumn,
): HTMLInputElement | null {
  const row = findRowEl(rowIndex)
  if (!row) return null
  return row.querySelector<HTMLInputElement>(selectorForColumn(col))
}

function focusInput(input: HTMLInputElement): void {
  input.focus()
  // Select existing contents on numeric/text inputs so the user can overtype.
  const t = input.type
  if (t === 'number' || t === 'text' || t === '' || t === undefined) {
    try {
      input.select()
    } catch {
      // Some browsers/inputs throw on select(); safe to ignore.
    }
  }
}

/**
 * Move focus to the SAME column on the NEXT row, creating a new row if needed.
 *
 * Safe to call from any input's keyboard handler. The caller is responsible for
 * preventDefault()/stopPropagation() on the originating event.
 */
export function focusSameColumnNextRow(
  rowIndex: number,
  col: LineItemColumn,
  options: FocusSameColumnNextRowOptions = {},
): void {
  const targetIndex = rowIndex + 1
  const maxAttempts = options.maxAttempts ?? 12

  const tryFocus = (attemptsLeft: number) => {
    const target = findTargetInput(targetIndex, col)
    if (target && document.body.contains(target)) {
      focusInput(target)
      return
    }
    if (attemptsLeft <= 0) return
    requestAnimationFrame(() => tryFocus(attemptsLeft - 1))
  }

  const rowAlreadyExists = !!findRowEl(targetIndex)

  if (rowAlreadyExists) {
    // Existing row: try immediately, with a couple of frames of safety net
    // in case the row re-rendered between keydown and focus.
    tryFocus(3)
    return
  }

  // No next row → ask caller to create exactly one, then poll for it.
  if (!options.onCreateRow) return
  options.onCreateRow()
  requestAnimationFrame(() => tryFocus(maxAttempts))
}
