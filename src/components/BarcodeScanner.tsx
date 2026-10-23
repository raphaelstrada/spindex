import { useEffect, useRef, useState } from 'react'
import { BarcodeDetector as BarcodeDetectorPonyfill } from 'barcode-detector/ponyfill'
import { LoaderCircle, Zap, ZapOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeBarcode } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'

type DetectorConstructor = typeof BarcodeDetectorPonyfill
type Detector = InstanceType<DetectorConstructor>

// Retail barcodes found on vinyl: EAN-13, UPC-A, EAN-8, UPC-E.
const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'] as const
const SCAN_INTERVAL_MS = 120

/** GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14). Rejects misreads before hitting Discogs. */
function hasValidCheckDigit(code: string): boolean {
  if (![8, 12, 13, 14].includes(code.length)) return false
  const digits = [...code].map(Number)
  const check = digits.pop() as number
  const sum = digits.reverse().reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Prefer the browser's native detector (hardware accelerated on Android); fall back to ZXing-C++ WASM. */
function createDetector(): Detector {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  if (Native) {
    try {
      return new Native({ formats: [...FORMATS] })
    } catch {
      // Native detector doesn't support these formats on this device: use the ponyfill.
    }
  }
  return new BarcodeDetectorPonyfill({ formats: [...FORMATS] })
}

type ExtendedCapabilities = MediaTrackCapabilities & {
  torch?: boolean
  zoom?: { min: number; max: number; step?: number }
}

export function BarcodeScanner({
  language,
  onScan,
  onError,
}: {
  language: Language
  onScan: (code: string) => void
  onError: (message: string) => void
}) {
  const t = translations[language].app
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [manualCode, setManualCode] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)

  // Latest callbacks in refs: the camera effect runs once, even if the parent passes inline functions.
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  })

  useEffect(() => {
    let cancelled = false
    let handled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let stream: MediaStream | null = null
    const video = videoRef.current

    async function start() {
      try {
        if (!video) return
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API unavailable (the page must be served over HTTPS).')
        }

        // Resolution matters: at the default 640x480 a vinyl barcode is only a few pixels per bar.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        const track = stream.getVideoTracks()[0]
        trackRef.current = track

        // Optional camera features: each one is best-effort and differs per device/browser.
        const capabilities = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          })
        } catch {
          // Continuous autofocus not supported: ignore.
        }
        setTorchSupported(Boolean(capabilities.torch))
        if (capabilities.zoom) {
          const { min, max, step } = capabilities.zoom
          setZoomRange({ min, max, step: step || 0.1 })
          setZoom(min)
        }

        video.srcObject = stream
        await video.play()
        setIsReady(true)

        const detector = createDetector()

        const tick = async () => {
          if (cancelled || handled) return
          try {
            if (video.readyState >= 2) {
              const barcodes = await detector.detect(video)
              for (const barcode of barcodes) {
                const code = normalizeBarcode(barcode.rawValue)
                if (hasValidCheckDigit(code)) {
                  handled = true
                  navigator.vibrate?.(60)
                  onScanRef.current(code)
                  return
                }
              }
            }
          } catch (error) {
            // A failed frame is not fatal; keep scanning. Surface it in the console for debugging.
            console.warn('Barcode detection failed for a frame:', error)
          }
          timer = setTimeout(tick, SCAN_INTERVAL_MS)
        }
        void tick()
      } catch (error) {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error))
      }
    }

    void start()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      trackRef.current = null
      if (video) video.srcObject = null
    }
  }, [])

  async function toggleTorch() {
    const next = !torchOn
    try {
      await trackRef.current?.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      })
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }

  async function changeZoom(value: number) {
    setZoom(value)
    try {
      await trackRef.current?.applyConstraints({
        advanced: [{ zoom: value } as MediaTrackConstraintSet],
      })
    } catch {
      // Zoom not applicable: ignore.
    }
  }

  function submitManual() {
    const code = normalizeBarcode(manualCode)
    if (code.length < 8 || code.length > 14) {
      setManualError(t.barcodeManualInvalid)
      return
    }
    setManualError(null)
    onScanRef.current(code)
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          </div>
        )}
        {torchSupported && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute right-2 top-2"
            onClick={() => void toggleTorch()}
            aria-pressed={torchOn}
          >
            {torchOn ? <ZapOff aria-hidden="true" /> : <Zap aria-hidden="true" />}
            {t.barcodeTorch}
          </Button>
        )}
      </div>

      {zoomRange && (
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="shrink-0">{t.barcodeZoom}</span>
          <input
            type="range"
            className="w-full"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step}
            value={zoom}
            onChange={(event) => void changeZoom(Number(event.target.value))}
          />
        </label>
      )}

      <p className="text-center text-sm text-muted-foreground">{t.scanningBarcode}</p>
      <p className="text-center text-xs text-muted-foreground">{t.barcodeTips}</p>

      <div className="space-y-1.5 border-t border-border pt-3">
        <label htmlFor="manual-barcode" className="text-sm font-medium">
          {t.barcodeManualLabel}
        </label>
        <div className="flex gap-2">
          <Input
            id="manual-barcode"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t.barcodeManualPlaceholder}
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitManual()
              }
            }}
          />
          <Button type="button" onClick={submitManual}>
            {t.barcodeManualSubmit}
          </Button>
        </div>
        {manualError && (
          <p role="alert" className="text-sm text-destructive">
            {manualError}
          </p>
        )}
      </div>
    </div>
  )
}
