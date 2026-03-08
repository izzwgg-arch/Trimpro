import React from 'react'
import { FlatList, StyleSheet } from 'react-native'
import { spacing } from '../../../theme/tokens'
import { RenderThreadItem } from '../types/message-thread-v2'

interface Props {
  listRef: React.RefObject<FlatList | null>
  items: RenderThreadItem[]
  listReserveTop: number
  renderItem: ({ item }: { item: RenderThreadItem }) => React.ReactElement | null
}

export function MessageListV2({ listRef, items, listReserveTop, renderItem }: Props) {
  return (
    <FlatList
      ref={listRef}
      style={styles.messageList}
      data={items}
      keyExtractor={(item, index) => {
        if ('type' in item && item.type === 'DATE') return `date-${item.date.toISOString()}`
        return 'id' in item ? item.id : `opt-${index}`
      }}
      contentContainerStyle={[styles.listContent, { paddingTop: listReserveTop }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      inverted
      showsVerticalScrollIndicator={false}
      renderItem={renderItem}
    />
  )
}

const styles = StyleSheet.create({
  messageList: {
    flex: 1,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
})
