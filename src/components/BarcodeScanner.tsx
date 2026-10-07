import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { LoaderCircle } from 'lucide-react'
import { translations, type Language } from '@/lib/i18n'

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
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [isReady, setIsReady] = useState(false)
  const t = translations[language].app

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsReady(true)

        await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, error) => {
          if (cancelled) return
          if (result) {
            onScan(result.getText())
          } else if (error && !(error instanceof NotFoundException)) {
            onError(error.message)
          }
        })
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      reader.reset()
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((track) => track.stop())
        videoRef.current.srcObject = null
      }
    }
  }, [onScan, onError])

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />
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
