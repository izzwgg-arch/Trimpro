'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Current stable Cardknox iFields build.
const IFIELDS_SCRIPT = 'https://cdn.cardknox.com/ifields/3.5.2607.1401/ifields.min.js'
const IFIELD_FRAME = 'https://cdn.cardknox.com/ifields/3.5.2607.1401/ifield.htm'

let scriptPromise: Promise<void> | null = null
function loadIfieldsScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if ((window as any).getTokens) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = IFIELDS_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load the secure card form.'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

// Make the field INSIDE the Cardknox iframe borderless/transparent so there is
// no "box inside a box", and vertically center the text in the 40px-tall box.
const INNER_STYLE = {
  border: 'none',
  outline: 'none',
  'background-color': 'transparent',
  width: '100%',
  height: '40px',
  padding: '0 10px',
  margin: '0',
  'font-size': '16px',
  'line-height': '40px',
  'box-sizing': 'border-box',
  color: '#111827',
}

export interface CardTerminalHandle {
  tokenize: () => Promise<{ cardToken: string; cvvToken: string; exp: string; zip: string }>
  ready: boolean
}

export const CardTerminal = forwardRef<CardTerminalHandle, { disabled?: boolean }>(function CardTerminal(props, ref) {
  const ifieldsKey = process.env.NEXT_PUBLIC_CARDKNOX_IFIELDS_KEY
  const [ready, setReady] = useState(false)
  const [exp, setExp] = useState('')
  const [zip, setZip] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const expRef = useRef('')
  expRef.current = exp
  const zipRef = useRef('')
  zipRef.current = zip

  // Auto-insert the divider as the user types: MM / YY.
  const onExpChange = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4)
    setExp(d.length <= 2 ? d : `${d.slice(0, 2)} / ${d.slice(2)}`)
  }

  useEffect(() => {
    if (!ifieldsKey) {
      setErr('Card entry is not configured (missing iFields key).')
      return
    }
    let cancelled = false
    loadIfieldsScript()
      .then(() => {
        if (cancelled) return
        try {
          ;(window as any).setAccount?.(ifieldsKey, 'TrimPro', '1.0')
          ;(window as any).enableAutoFormatting?.()
          ;(window as any).setIfieldStyle?.('card-number', INNER_STYLE)
          ;(window as any).setIfieldStyle?.('cvv', INNER_STYLE)
          setReady(true)
        } catch (e: any) {
          setErr(e?.message || 'Could not initialize the secure card form.')
        }
      })
      .catch((e) => !cancelled && setErr(e?.message || 'Could not load the secure card form.'))
    return () => {
      cancelled = true
    }
  }, [ifieldsKey])

  useImperativeHandle(ref, () => ({
    ready,
    tokenize: () =>
      new Promise((resolve, reject) => {
        const digits = (expRef.current || '').replace(/\D/g, '')
        if (digits.length !== 4) return reject(new Error('Enter the card expiration as MMYY (e.g. 0530).'))
        if (!(window as any).getTokens) return reject(new Error('The secure card form is not ready yet.'))
        ;(window as any).getTokens(
          () => {
            const cardToken = (document.querySelector('[data-ifields-id="card-number-token"]') as HTMLInputElement)?.value
            const cvvToken = (document.querySelector('[data-ifields-id="cvv-token"]') as HTMLInputElement)?.value
            if (!cardToken) return reject(new Error('Please re-enter the card number.'))
            resolve({ cardToken, cvvToken: cvvToken || '', exp: digits, zip: (zipRef.current || '').trim() })
          },
          (e: any) => reject(new Error(typeof e === 'string' ? e : 'Please check the card details and try again.')),
          60000
        )
      }),
  }), [ready])

  if (!ifieldsKey) return <p className="text-sm text-red-600">Card entry isn’t configured yet.</p>

  return (
    <div className="space-y-2">
      <div>
        <Label>Card number</Label>
        <div className="flex h-10 w-full items-center overflow-hidden rounded-md border border-gray-300 bg-white">
          <iframe
            title="Card number"
            data-ifields-id="card-number"
            data-ifields-placeholder="1234 5678 9012 3456"
            src={IFIELD_FRAME}
            className="h-full w-full border-0"
          />
          <input data-ifields-id="card-number-token" name="xCardNum" type="hidden" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="ctExp">Expiration</Label>
          <Input id="ctExp" inputMode="numeric" placeholder="MM / YY" maxLength={7} value={exp} onChange={(e) => onExpChange(e.target.value)} disabled={props.disabled} />
        </div>
        <div>
          <Label>CVV</Label>
          <div className="flex h-10 w-full items-center overflow-hidden rounded-md border border-gray-300 bg-white">
            <iframe
              title="CVV"
              data-ifields-id="cvv"
              data-ifields-placeholder="CVV"
              src={IFIELD_FRAME}
              className="h-full w-full border-0"
            />
            <input data-ifields-id="cvv-token" name="xCVV" type="hidden" />
          </div>
        </div>
        <div>
          <Label htmlFor="ctZip">ZIP code</Label>
          <Input id="ctZip" inputMode="numeric" placeholder="12345" maxLength={10} value={zip} onChange={(e) => setZip(e.target.value)} disabled={props.disabled} />
        </div>
      </div>
      {!ready && <p className="text-xs text-gray-500">Loading the secure card form…</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
})
