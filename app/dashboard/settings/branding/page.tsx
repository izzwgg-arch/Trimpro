'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { INVOICE_TEMPLATES } from '@/lib/invoices/templates/registry'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'

type Branding = Record<string, string | null>

const BRANDING_ALLOWED_KEYS = new Set<string>([
  'primaryColor',
  'secondaryColor',
  'backgroundColor',
  'sidebarColor',
  'menuColor',
  'buttonColor',
  'buttonTextColor',
  'textPrimaryColor',
  'textSecondaryColor',
  'linkColor',
  'borderColor',
  'successColor',
  'warningColor',
  'dangerColor',
  'webLogoUrl',
  'faviconUrl',
  'mobileAppIconUrl',
  'mobileAppSplashLogoUrl',
  'invoiceStyle',
  'invoicePdfTemplateId',
  'invoiceBusinessName',
  'invoicePhone',
  'invoiceEmail',
  'invoiceAddress',
  'invoiceFooterText',
  'invoiceLogoUrl',
  'emailPrimaryColor',
  'emailButtonColor',
  'emailButtonTextColor',
  'emailBackgroundColor',
  'emailCardBackgroundColor',
  'emailHeaderBackgroundColor',
  'emailFooterBackgroundColor',
  'emailTextPrimaryColor',
  'emailTextSecondaryColor',
  'emailLinkColor',
  'emailBorderColor',
  'emailLogoUrl',
  'emailFooterText',
  'emailSignature',
  'emailCustomHeaderHTML',
  'emailCustomFooterHTML',
])

function sanitizeBrandingPayload(input: Record<string, unknown>): Branding {
  const output: Branding = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (!BRANDING_ALLOWED_KEYS.has(key)) continue
    if (value == null) {
      output[key] = null
      continue
    }
    output[key] = typeof value === 'string' ? value : String(value)
  }
  return output
}

const COLOR_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'primaryColor', label: 'Primary' },
  { key: 'secondaryColor', label: 'Secondary' },
  { key: 'backgroundColor', label: 'Background' },
  { key: 'sidebarColor', label: 'Sidebar' },
  { key: 'menuColor', label: 'Menu' },
  { key: 'buttonColor', label: 'Buttons' },
  { key: 'buttonTextColor', label: 'Button Text' },
  { key: 'textPrimaryColor', label: 'Main Text' },
  { key: 'textSecondaryColor', label: 'Secondary Text' },
  { key: 'linkColor', label: 'Link' },
  { key: 'borderColor', label: 'Border' },
  { key: 'successColor', label: 'Success' },
  { key: 'warningColor', label: 'Warning' },
  { key: 'dangerColor', label: 'Danger' },
]

const LOGO_FIELDS: Array<{ key: string; label: string; note: string }> = [
  { key: 'webLogoUrl', label: 'Web Logo', note: 'Recommended SVG, min 200x60' },
  { key: 'faviconUrl', label: 'Favicon', note: 'Recommended 32x32 PNG' },
  { key: 'mobileAppIconUrl', label: 'Mobile App Icon', note: 'Recommended 1024x1024 PNG' },
  { key: 'mobileAppSplashLogoUrl', label: 'Mobile Splash Logo', note: 'Recommended SVG or 512x512 PNG' },
]

const EMAIL_COLOR_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'emailPrimaryColor', label: 'Primary' },
  { key: 'emailButtonColor', label: 'Button Background' },
  { key: 'emailButtonTextColor', label: 'Button Text' },
  { key: 'emailBackgroundColor', label: 'Background' },
  { key: 'emailCardBackgroundColor', label: 'Card Background' },
  { key: 'emailHeaderBackgroundColor', label: 'Header Background' },
  { key: 'emailFooterBackgroundColor', label: 'Footer Background' },
  { key: 'emailTextPrimaryColor', label: 'Primary Text' },
  { key: 'emailTextSecondaryColor', label: 'Secondary Text' },
  { key: 'emailLinkColor', label: 'Link' },
  { key: 'emailBorderColor', label: 'Border' },
]

function isValidHex(value: string) {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

async function getCroppedImageFile(
  imageSrc: string,
  crop: Area,
  outputName: string
): Promise<File> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')

  canvas.width = Math.max(1, Math.round(crop.width))
  canvas.height = Math.max(1, Math.round(crop.height))

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png', 0.92)
  )
  if (!blob) throw new Error('Failed to create cropped image')

  return new File([blob], outputName, { type: 'image/png' })
}

export default function BrandingSettingsPage() {
  const [branding, setBranding] = useState<Branding>({})
  const [draft, setDraft] = useState<Branding>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null)
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false)
  const [cropFieldKey, setCropFieldKey] = useState<string | null>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)
  const [cropZoom, setCropZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [cropping, setCropping] = useState(false)

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null

  const fetchBranding = async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch('/api/branding', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      const nextBranding = sanitizeBrandingPayload(data?.branding || {})
      setBranding(nextBranding)
      setDraft(nextBranding)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchBranding()
  }, [])

  const setField = (key: string, value: string | null) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const saveBranding = async () => {
    if (!token) return

    for (const field of [...COLOR_FIELDS, ...EMAIL_COLOR_FIELDS]) {
      const val = draft[field.key]
      if (val && !isValidHex(val)) {
        alert(`Invalid HEX for ${field.label}`)
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch('/api/branding', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sanitizeBrandingPayload(draft)),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Failed to save branding' }))
        alert(payload.error || 'Failed to save branding')
        return
      }
      await fetchBranding()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('branding-updated'))
      }
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    if (!token) return
    await fetch('/api/branding/reset', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchBranding()
  }

  const resetSection = async (section: 'ui' | 'logos' | 'invoice' | 'email') => {
    if (!token) return
    await fetch('/api/branding/reset-section', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ section }),
    })
    await fetchBranding()
  }

  const uploadAsset = async (file: File, fieldKey: string) => {
    if (!token) return
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/uploads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Upload failed' }))
      alert(payload.error || 'Upload failed')
      return
    }
    const data = await response.json()
    setField(fieldKey, data.url)
  }

  const startCropUpload = async (file: File, fieldKey: string) => {
    const reader = new FileReader()
    reader.onload = () => {
      setCropFieldKey(fieldKey)
      setCropImageSrc(String(reader.result || ''))
      setCropX(0)
      setCropY(0)
      setCropZoom(1)
      setCroppedAreaPixels(null)
    }
    reader.readAsDataURL(file)
  }

  const closeCropper = () => {
    setCropFieldKey(null)
    setCropImageSrc(null)
    setCroppedAreaPixels(null)
    setCropping(false)
  }

  const confirmCropAndUpload = async () => {
    if (!cropImageSrc || !cropFieldKey || !croppedAreaPixels) return
    setCropping(true)
    try {
      const file = await getCroppedImageFile(
        cropImageSrc,
        croppedAreaPixels,
        `${cropFieldKey}-${Date.now()}.png`
      )
      await uploadAsset(file, cropFieldKey)
      closeCropper()
    } catch {
      alert('Failed to crop image')
    } finally {
      setCropping(false)
    }
  }

  const cropAspect = useMemo(() => {
    if (cropFieldKey === 'webLogoUrl') return 200 / 60
    return 1
  }, [cropFieldKey])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'branding-settings.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File) => {
    const text = await file.text()
    try {
      const parsed = JSON.parse(text)
      setDraft((prev) => ({ ...prev, ...sanitizeBrandingPayload(parsed) }))
    } catch {
      alert('Invalid JSON file')
    }
  }

  const emailPreview = useMemo(() => {
    const bg = draft.emailBackgroundColor || '#ffffff'
    const cardBg = draft.emailCardBackgroundColor || '#111827'
    const headerBg = draft.emailHeaderBackgroundColor || '#111827'
    const footerBg = draft.emailFooterBackgroundColor || '#111827'
    const textPrimary = draft.emailTextPrimaryColor || 'rgba(255,255,255,0.92)'
    const textSecondary = draft.emailTextSecondaryColor || 'rgba(255,255,255,0.68)'
    const button = draft.emailButtonColor || '#12344d'
    const buttonText = draft.emailButtonTextColor || '#ffffff'
    return { bg, cardBg, headerBg, footerBg, textPrimary, textSecondary, button, buttonText }
  }, [draft])

  const selectedInvoiceTemplate = useMemo(() => {
    const id = draft.invoicePdfTemplateId
    if (!id) return null
    return INVOICE_TEMPLATES.find((template) => template.id === id) || null
  }, [draft.invoicePdfTemplateId])

  useEffect(() => {
    const loadInvoicePreviewPdf = async () => {
      if (!token) return
      setInvoicePreviewLoading(true)
      try {
        const templateId = draft.invoicePdfTemplateId || ''
        const response = await fetch(`/api/branding/invoice-preview-pdf?templateId=${encodeURIComponent(templateId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          setInvoicePreviewUrl(null)
          return
        }
        const blob = await response.blob()
        if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl)
        const nextUrl = URL.createObjectURL(blob)
        setInvoicePreviewUrl(nextUrl)
      } finally {
        setInvoicePreviewLoading(false)
      }
    }
    void loadInvoicePreviewPdf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.invoicePdfTemplateId, draft.invoiceBusinessName, draft.invoicePhone, draft.invoiceEmail, draft.invoiceAddress, draft.invoiceFooterText, draft.invoiceLogoUrl, token])

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading branding settings...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Branding</h1>
          <p className="text-sm text-gray-600">Optional overrides layered over existing defaults.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetAll}>Restore All Defaults</Button>
          <Button onClick={saveBranding} disabled={saving}>{saving ? 'Saving...' : 'Save Branding'}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>UI Colors</CardTitle>
          <CardDescription>Each field is optional and falls back to defaults when empty.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {COLOR_FIELDS.map((field) => (
            <div key={field.key} className="rounded border p-3">
              <Label>{field.label}</Label>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={draft[field.key] || ''}
                  placeholder="#000000"
                  onChange={(e) => setField(field.key, e.target.value || null)}
                />
                <input
                  type="color"
                  value={draft[field.key] || '#000000'}
                  onChange={(e) => setField(field.key, e.target.value || null)}
                  className="h-10 w-12 rounded border"
                />
                <div
                  className="h-10 w-10 rounded border"
                  style={{ background: draft[field.key] || 'transparent' }}
                />
                <Button variant="outline" onClick={() => setField(field.key, null)}>Reset</Button>
              </div>
            </div>
          ))}
          <div className="md:col-span-2">
            <Button variant="outline" onClick={() => resetSection('ui')}>Reset UI Section</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logos & Icons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {LOGO_FIELDS.map((field) => (
            <div key={field.key} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>{field.label}</Label>
                  <p className="text-xs text-gray-500">{field.note}</p>
                </div>
                <Button variant="outline" onClick={() => setField(field.key, null)}>Remove</Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={draft[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value || null)}
                  placeholder="https://..."
                />
                <Input type="file" onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void startCropUpload(file, field.key)
                }} />
              </div>
              {draft[field.key] ? (
                <img
                  src={draft[field.key] as string}
                  alt={field.label}
                  className="mt-2 h-16 max-w-full rounded border object-contain"
                  onError={(e) => {
                    const img = e.currentTarget
                    img.style.display = 'none'
                  }}
                />
              ) : null}
            </div>
          ))}
          <Button variant="outline" onClick={() => resetSection('logos')}>Reset Logos Section</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice Styling</CardTitle>
          <CardDescription>Select a template and preview a sample invoice below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {INVOICE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setField('invoicePdfTemplateId', template.id)}
                className={`rounded border p-3 text-left ${draft.invoicePdfTemplateId === template.id ? 'border-blue-500 ring-2 ring-blue-200' : ''}`}
              >
                <div className="h-8 rounded" style={{ backgroundColor: template.preview.accentColor }} />
                <div className="mt-2 text-sm font-medium">{template.name}</div>
                <div className="text-xs text-gray-500">{template.description}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input placeholder="Business Name" value={draft.invoiceBusinessName || ''} onChange={(e) => setField('invoiceBusinessName', e.target.value || null)} />
            <Input placeholder="Phone" value={draft.invoicePhone || ''} onChange={(e) => setField('invoicePhone', e.target.value || null)} />
            <Input placeholder="Email" value={draft.invoiceEmail || ''} onChange={(e) => setField('invoiceEmail', e.target.value || null)} />
            <Input placeholder="Address" value={draft.invoiceAddress || ''} onChange={(e) => setField('invoiceAddress', e.target.value || null)} />
            <Input placeholder="Footer Text" value={draft.invoiceFooterText || ''} onChange={(e) => setField('invoiceFooterText', e.target.value || null)} />
            <Input placeholder="Invoice Logo URL" value={draft.invoiceLogoUrl || ''} onChange={(e) => setField('invoiceLogoUrl', e.target.value || null)} />
          </div>

          <div className="rounded border p-4">
            <div className="mb-3 text-sm font-medium text-gray-700">PDF Preview</div>
            <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
              <span>{selectedInvoiceTemplate ? `${selectedInvoiceTemplate.name}` : 'Default production template'}</span>
              <span className="rounded border bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-700">
                {selectedInvoiceTemplate
                  ? `id: ${selectedInvoiceTemplate.id} | v${selectedInvoiceTemplate.version}`
                  : 'id: production-default'}
              </span>
            </div>
            <div className="overflow-hidden rounded border bg-white">
              {invoicePreviewLoading ? (
                <div className="p-8 text-center text-sm text-gray-500">Rendering PDF preview...</div>
              ) : invoicePreviewUrl ? (
                <iframe
                  title="Invoice PDF Preview"
                  src={invoicePreviewUrl}
                  className="h-[560px] w-full"
                />
              ) : (
                <div className="p-8 text-center text-sm text-gray-500">
                  Preview unavailable. Save and try again.
                </div>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => resetSection('invoice')}>Reset Invoice Section</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Templates & Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {EMAIL_COLOR_FIELDS.map((field) => (
              <div key={field.key}>
                <Label>{field.label}</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    value={draft[field.key] || ''}
                    placeholder="#000000"
                    onChange={(e) => setField(field.key, e.target.value || null)}
                  />
                  <input
                    type="color"
                    value={draft[field.key] || '#000000'}
                    onChange={(e) => setField(field.key, e.target.value || null)}
                    className="h-10 w-12 rounded border"
                  />
                </div>
              </div>
            ))}
          </div>
          <Input placeholder="Email Logo URL" value={draft.emailLogoUrl || ''} onChange={(e) => setField('emailLogoUrl', e.target.value || null)} />
          <textarea className="w-full rounded border p-2" rows={3} placeholder="Footer text" value={draft.emailFooterText || ''} onChange={(e) => setField('emailFooterText', e.target.value || null)} />
          <textarea className="w-full rounded border p-2" rows={3} placeholder="Email signature" value={draft.emailSignature || ''} onChange={(e) => setField('emailSignature', e.target.value || null)} />
          <textarea className="w-full rounded border p-2" rows={4} placeholder="Custom header HTML (sanitized)" value={draft.emailCustomHeaderHTML || ''} onChange={(e) => setField('emailCustomHeaderHTML', e.target.value || null)} />
          <textarea className="w-full rounded border p-2" rows={4} placeholder="Custom footer HTML (sanitized)" value={draft.emailCustomFooterHTML || ''} onChange={(e) => setField('emailCustomFooterHTML', e.target.value || null)} />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {['Invoice Email', 'Invitation Email', 'Receipt Email'].map((title) => (
              <div key={title} className="rounded border p-3" style={{ background: emailPreview.bg }}>
                <div className="rounded p-2 text-xs font-medium" style={{ background: emailPreview.headerBg, color: emailPreview.textPrimary }}>
                  {title}
                </div>
                <div className="mt-2 rounded p-3" style={{ background: emailPreview.cardBg, color: emailPreview.textSecondary }}>
                  <p style={{ color: emailPreview.textPrimary }}>Preview content</p>
                  <button type="button" className="mt-2 rounded px-3 py-1 text-xs" style={{ background: emailPreview.button, color: emailPreview.buttonText }}>
                    Action
                  </button>
                </div>
                <div className="mt-2 rounded p-2 text-xs" style={{ background: emailPreview.footerBg, color: emailPreview.textSecondary }}>
                  Footer
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => resetSection('email')}>Reset Email Section</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={resetAll}>Restore All Defaults</Button>
          <Button variant="outline" onClick={exportJson}>Export Branding JSON</Button>
          <Input type="file" accept="application/json" onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importJson(file)
          }} />
        </CardContent>
      </Card>

      {cropImageSrc && cropFieldKey ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Crop Image</div>
              <Button variant="outline" onClick={closeCropper}>Cancel</Button>
            </div>
            <div className="relative h-[420px] w-full overflow-hidden rounded border bg-black">
              <Cropper
                image={cropImageSrc}
                crop={{ x: cropX, y: cropY }}
                zoom={cropZoom}
                aspect={cropAspect}
                onCropChange={(next) => {
                  setCropX(next.x)
                  setCropY(next.y)
                }}
                onZoomChange={setCropZoom}
                onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                showGrid
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Label className="text-xs">Zoom</Label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={cropZoom}
                onChange={(e) => setCropZoom(Number(e.target.value))}
                className="w-full"
              />
              <Button onClick={confirmCropAndUpload} disabled={cropping || !croppedAreaPixels}>
                {cropping ? 'Uploading...' : 'Crop & Upload'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

