'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { EmptyState } from '@/components/charts/EmptyState'

// Status color mapping
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: '#0EA5E9', // Sky blue
  IN_PROGRESS: '#F59E0B', // Amber
  ON_HOLD: '#EF4444', // Red
  COMPLETED: '#10B981', // Green
  CANCELLED: '#6B7280', // Gray
  QUOTE: '#8B5CF6', // Purple
  INVOICED: '#14B8A6', // Teal
}

// Format status names for display
const formatStatusName = (status: string): string => {
  return status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

// Custom tooltip
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="font-semibold text-gray-900">{data.name}</p>
        <p className="text-sm text-gray-600">
          <span className="font-medium">{data.value}</span> {data.value === 1 ? 'job' : 'jobs'}
        </p>
        <p className="text-xs text-gray-500">
          {((data.payload.percent || 0) * 100).toFixed(1)}% of total
        </p>
      </div>
    )
  }
  return null
}

export function DashboardJobsPipelineChart() {
  const [data, setData] = useState<Array<{ name: string; value: number; originalName: string; displayName: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) return

      const endDate = new Date()
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      const response = await fetch(
        `/api/analytics/overview?range=30d&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      if (response.ok) {
        const result = await response.json()
        const activeJobs = result?.metrics?.kpis?.activeJobsByStatus || {}
        if (activeJobs && typeof activeJobs === 'object') {
          const chartData = Object.entries(activeJobs)
            .map(([name, value]) => ({
              name: formatStatusName(name),
              displayName: formatStatusName(name),
              originalName: name,
              value: Number(value) || 0,
            }))
            .filter((item) => item.value > 0) // Filter out zero values
            .sort((a, b) => b.value - a.value) // Sort by value descending

          setData(chartData)
        }
      } else {
        console.error('Failed to fetch jobs pipeline data:', response.status)
      }
    } catch (error) {
      console.error('Failed to fetch jobs data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="h-[200px] flex items-center justify-center text-gray-500">Loading...</div>
  }

  if (data.length === 0) {
    return <EmptyState title="No active jobs" message="No active jobs to display." />
  }

  const total = data.reduce((sum, item) => sum + item.value, 0)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={false} // Remove labels from pie chart to prevent overlap
          outerRadius={70}
          innerRadius={30}
          fill="#8884d8"
          dataKey="value"
          paddingAngle={3}
        >
          {data.map((entry) => (
            <Cell
              key={`cell-${entry.originalName}`}
              fill={STATUS_COLORS[entry.originalName] || '#94A3B8'}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          verticalAlign="bottom"
          height={50}
          iconType="circle"
          wrapperStyle={{ paddingTop: '10px' }}
          formatter={(value: string) => {
            const item = data.find((d) => d.displayName === value)
            if (!item) return value
            const percent = ((item.value / total) * 100).toFixed(0)
            return `${value} (${item.value}) - ${percent}%`
          }}
          style={{
            fontSize: '12px',
            lineHeight: '18px',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
