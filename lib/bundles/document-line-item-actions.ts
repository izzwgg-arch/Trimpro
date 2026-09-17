export type DocumentLineItemLike = {
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  isSubtotal?: boolean
}

/** Remove one line, or the entire bundle when removing a bundle header row. */
export function removeDocumentLineItem<T extends DocumentLineItemLike>(
  items: T[],
  index: number
): T[] {
  if (items.length <= 1) return items
  const item = items[index]
  if (item?.groupId && item.isGroupHeader) {
    return items.filter((li) => li.groupId !== item.groupId)
  }
  return items.filter((_, i) => i !== index)
}

/** Insert a blank line inside the same bundle group (after header or a child row). */
export function insertDocumentLineAfter<T extends DocumentLineItemLike>(
  items: T[],
  index: number,
  createBlank: () => T
): { items: T[]; focusIndex: number } {
  const row = items[index]
  const blank = createBlank()
  if (!row.isSubtotal && row.groupId) {
    blank.groupId = row.groupId
    blank.groupName = row.groupName
  }
  const next = [...items]
  next.splice(index + 1, 0, blank)
  return { items: next, focusIndex: index + 1 }
}

/**
 * Advance to the next editable line (used when the picker fires "next line",
 * e.g. Enter). When the current line belongs to a bundle group, the new line
 * is inserted right after it INSIDE that same group, so items added under a
 * bundle stay under the bundle instead of being appended to the end of the
 * document. Outside a group it preserves the old behavior: reuse the existing
 * next row if there is one, otherwise append a blank at the end (which joins
 * the trailing bundle, if any, so a run of items keeps flowing into it).
 */
export function addNextDocumentLine<T extends DocumentLineItemLike>(
  items: T[],
  currentIndex: number,
  createBlank: () => T
): { items: T[]; focusIndex: number } {
  const current = items[currentIndex]
  if (current?.groupId && !current.isSubtotal && !current.isGroupHeader) {
    const blank = createBlank()
    blank.groupId = current.groupId
    blank.groupName = current.groupName
    const next = [...items]
    next.splice(currentIndex + 1, 0, blank)
    return { items: next, focusIndex: currentIndex + 1 }
  }

  const nextIndex = currentIndex + 1
  if (nextIndex < items.length) return { items, focusIndex: nextIndex }

  const blank = createBlank()
  const lastHeader = [...items].reverse().find((it) => it.isGroupHeader && it.groupId)
  if (lastHeader?.groupId) {
    blank.groupId = lastHeader.groupId
    blank.groupName = lastHeader.groupName
  }
  return { items: [...items, blank], focusIndex: nextIndex }
}

/** Append a new editable row at the end of a bundle on this document only. */
export function addItemToDocumentBundle<T extends DocumentLineItemLike>(
  items: T[],
  groupId: string,
  createBlank: () => T
): { items: T[]; focusIndex: number } {
  const header = items.find((li) => li.groupId === groupId && li.isGroupHeader)
  let lastIndex = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].groupId === groupId) lastIndex = i
  }
  const insertAt = lastIndex >= 0 ? lastIndex : Math.max(0, items.length - 1)
  const blank = createBlank()
  blank.groupId = groupId
  if (header?.groupName) blank.groupName = header.groupName
  const next = [...items]
  next.splice(insertAt + 1, 0, blank)
  return { items: next, focusIndex: insertAt + 1 }
}
