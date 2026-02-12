import { z } from 'zod'

/**
 * Common validation schemas for API endpoints
 */

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).optional(),
})

// Date range
export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
})

// Job assignment
export const jobAssignmentSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().optional().nullable(),
  scheduledStart: z.string().datetime().optional().nullable(),
  scheduledEnd: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// Job status update
export const jobStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']),
  notes: z.string().optional().nullable(),
})

// Report creation
export const reportSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  type: z.string().min(1),
  dataset: z.string().optional().nullable(),
  columns: z.any().optional().nullable(),
  filters: z.any().optional().nullable(),
  groupBy: z.any().optional().nullable(),
  aggregates: z.any().optional().nullable(),
  sorting: z.any().optional().nullable(),
})

// Mobile location update
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime().optional(),
})

// Job note
export const jobNoteSchema = z.object({
  content: z.string().min(1).max(5000),
})

// Client creation
export const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().optional().nullable(),
  companyName: z.string().max(255).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  website: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : val),
    z.string().url().nullable().optional()
  ),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  billingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string().optional().default('US'),
  }).optional().nullable(),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string().optional().default('US'),
  }).optional().nullable(),
})

// Job creation
export const createJobSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(['QUOTE', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']).optional(),
  priority: z.union([
    z.number().int().min(1).max(5),
    z.string().transform((val) => {
      // Try to parse as number
      const num = parseInt(val)
      if (!isNaN(num) && num >= 1 && num <= 5) return num
      return 3 // default
    })
  ]).optional(),
  scheduledStart: z.union([
    z.string().datetime(),
    z.string().transform((val) => {
      if (!val || val.trim() === '') return null
      const date = new Date(val)
      return isNaN(date.getTime()) ? null : date.toISOString()
    }),
    z.null()
  ]).optional().nullable(),
  scheduledEnd: z.union([
    z.string().datetime(),
    z.string().transform((val) => {
      if (!val || val.trim() === '') return null
      const date = new Date(val)
      return isNaN(date.getTime()) ? null : date.toISOString()
    }),
    z.null()
  ]).optional().nullable(),
  estimateAmount: z.string().or(z.number()).optional().nullable(),
  jobSite: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string().optional().default('US'),
    notes: z.string().optional().nullable(),
  }).optional().nullable(),
})

// Invoice creation
export const createInvoiceSchema = z.object({
  clientId: z.string().min(1),
  jobId: z.string().optional().nullable(),
  estimateId: z.string().optional().nullable(),
  title: z.string().min(1).max(255),
  lineItems: z.array(z.object({
    description: z.string(),
    quantity: z.union([z.string(), z.number()]).transform((val) => typeof val === 'string' ? parseFloat(val) : val),
    unitPrice: z.union([z.string(), z.number()]).transform((val) => typeof val === 'string' ? parseFloat(val) : val),
  })).min(1).optional(),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1).optional(),
  taxRate: z.union([z.string(), z.number()]).optional().nullable(),
  discount: z.union([z.string(), z.number()]).optional().nullable(),
  invoiceDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  terms: z.string().max(1000).optional().nullable(),
  memo: z.string().max(1000).optional().nullable(),
}).refine((data) => (data.lineItems && data.lineItems.length > 0) || (data.items && data.items.length > 0), {
  message: 'At least one line item is required',
})

/**
 * Parse and validate request body
 */
export async function validateRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: string; status: number }> {
  try {
    const body = await request.json()
    const data = schema.parse(body)
    return { success: true, data }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        status: 400,
      }
    }
    return {
      success: false,
      error: 'Invalid request body',
      status: 400,
    }
  }
}

/**
 * Parse and validate query parameters
 */
export function validateQuery<T>(
  searchParams: URLSearchParams,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string; status: number } {
  try {
    const params = Object.fromEntries(searchParams.entries())
    const data = schema.parse(params)
    return { success: true, data }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        status: 400,
      }
    }
    return {
      success: false,
      error: 'Invalid query parameters',
      status: 400,
    }
  }
}
