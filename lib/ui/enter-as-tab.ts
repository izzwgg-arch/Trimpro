/**
 * Shift+Enter moves focus to the next field like Tab (dashboard data entry).
 * Plain Enter is left alone so item pickers and other controls can use it.
 * - In <textarea>, Enter still inserts a newline; Shift+Enter advances.
 * - Skips submit/button inputs so Shift+Enter on "Save" does not steal focus.
 * - Opt out: add data-no-enter-tab on <form>.
 */

function isEnterAsTabTarget(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement
}

function shouldIgnoreInput(input: HTMLInputElement): boolean {
  const t = input.type
  return (
    t === 'hidden' ||
    t === 'submit' ||
    t === 'button' ||
    t === 'reset' ||
    t === 'file' ||
    t === 'image'
  )
}

function collectTabbableFields(form: HTMLFormElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLElement)) continue
    if (el.hasAttribute('disabled')) continue
    if (el.getAttribute('tabindex') === '-1') continue
    if (el instanceof HTMLInputElement) {
      if (shouldIgnoreInput(el)) continue
    }
    out.push(el)
  }
  return out
}

export function tryMoveFocusToNextFormField(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter') return false
  if (e.defaultPrevented) return false
  if (e.isComposing) return false
  if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false

  const target = e.target
  if (!isEnterAsTabTarget(target)) return false

  const t = target as HTMLElement
  const hasDataCol = t.hasAttribute('data-col')
  const hasPickerInput = t.hasAttribute('data-picker-input')
  const insideLineRow = !!t.closest('[data-line-item-row="true"]')
  // eslint-disable-next-line no-console
  console.log('[SE] 2. tryMoveFocusToNextFormField entered', {
    tag: t.tagName,
    'data-col': t.getAttribute('data-col'),
    'data-picker-input': t.getAttribute('data-picker-input'),
    insideLineRow,
    willBailOut: hasDataCol || hasPickerInput || insideLineRow,
  })

  if (hasDataCol || hasPickerInput || insideLineRow) {
    return false
  }

  const form = target.closest('form')
  if (!form || form.hasAttribute('data-no-enter-tab')) return false

  if (target.isContentEditable) return false

  if (target instanceof HTMLButtonElement) return false
  if (target instanceof HTMLAnchorElement) return false

  if (target instanceof HTMLInputElement && shouldIgnoreInput(target)) return false

  const fields = collectTabbableFields(form)
  const idx = fields.indexOf(target)
  if (idx === -1) return false

  const next = fields[idx + 1]
  if (!next) return false

  e.preventDefault()
  e.stopPropagation()
  next.focus()
  return true
}
