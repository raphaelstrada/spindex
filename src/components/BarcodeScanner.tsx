import { useEffect, useRef, useState } from 'react'
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
  NotFoundException,
} from '@zxing/library'
import { LoaderCircle } from 'lucide-react'
import { translations, type Language } from '@/lib/i18n'
import { normalizeBarcode } from '@/lib/discogs'

const hints = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8],
  ],
  [DecodeHintType.TRY_HARDER, true],
])

export function BarcodeScanner({
  language,
  onScan,
  onError,
}: {
  language: Language
  onScan: (code: string) => void
  onError: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isReady, setIsReady] = useState(false)
  const t = translations[language].app

  // Keep the latest callbacks in refs so the camera effect runs only once,
  // even if the parent passes new inline functions on every render.
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  })

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(hints)
    const video = videoRef.current
    let cancelled = false
    let handled = false

    if (!video) return

    const handlePlaying = () => setIsReady(true)
    video.addEventListener('playing', handlePlaying)

    // decodeFromConstraints opens the camera itself: no second getUserMedia stream.
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, error) => {
          if (cancelled || handled) return
          if (result) {
            const code = normalizeBarcode(result.getText())
            if (code.length < 8) return // ignore partial/garbage reads
            handled = true // fire only once per scanner session
            reader.reset()
            onScanRef.current(code)
          } else if (error && !(error instanceof NotFoundException)) {
            // Checksum/format errors happen constantly while scanning; ignore them.
          }
        },
      )
      .catch((error) => {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      video.removeEventListener('playing', handlePlaying)
      reader.reset()
    }
  }, [])

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          </div>
        )}
      </div>
      <p className="text-center text-sm text-muted-foreground">{t.scanningBarcode}</p>
    </div>
  )
}
