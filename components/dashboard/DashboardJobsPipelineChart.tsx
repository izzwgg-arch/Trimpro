'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { EmptyState } from '@/components/charts/EmptyState'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8']

export function DashboardJobsPipelineChart() {
  const [data, setData] = useState<Array<{ name: string; value: number }>>([])
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
          const chartData = Object.entries(activeJobs).map(([name, value]) => ({
            name,
            value: Number(value) || 0,
          }))
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

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          outerRadius={80}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}
