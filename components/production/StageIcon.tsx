'use client'

import {
  Circle, CircleDot, PlayCircle, Ruler, ShoppingCart, Truck, Hammer, Wrench,
  CheckCircle, PauseCircle, Package, Clock, AlertCircle, Flag, Factory, Boxes,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  Circle, CircleDot, PlayCircle, Ruler, ShoppingCart, Truck, Hammer, Wrench,
  CheckCircle, PauseCircle, Package, Clock, AlertCircle, Flag, Factory, Boxes,
}

export function StageIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || Circle
  return <Icon className={className} />
}
