import { useState } from 'react'
import { LoaderCircle, RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCollectionOwner } from '@/lib/collection'
import { useDiscogsAutoMatch } from '@/lib/discogsAutoMatch'
import { isVerificationRunning } from '@/lib/discogsVerification'
import { translations, type Language } from '@/lib/i18n'
import { reportSetupIssue } from '@/lib/setupIssues'

export function DiscogsAutoMatch({ language, onRecordsChanged }: { language: Language; onRecordsChanged: () => void }) {
  const t = translations[language].discogsAutoMatch
  const owner = useCollectionOwner()
  const autoMatch = useDiscogsAutoMatch(owner, onRecordsChanged)
  const [isStarting, setIsStarting] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)

  async function start(retry = false) {
    if (isVerificationRunning(owner)) {
      alert(t.busy)
      return
    }
    setIsStarting(true)
    setResultsOpen(false)
    try {
      await autoMatch.start(retry)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!reportSetupIssue(message)) alert(`${t.startError} ${message}`)
    } finally {
      setIsStarting(false)
    }
  }

  const summary = [
    { label: t.matched, value: autoMatch.matched },
    { label: t.ambiguous, value: autoMatch.ambiguous },
    { label: t.noMatch, value: autoMatch.noMatch },
    { label: t.covers, value: autoMatch.covers },
  ]

  return (
    <>
      {autoMatch.status === 'running' ? (
        <Button
          variant="outline"
          title={t.stopHint}
          onClick={() => {
            if (window.confirm(t.stopConfirm)) autoMatch.stop()
          }}
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {t.running
            .replace('{current}', String(autoMatch.position))
            .replace('{total}', String(autoMatch.queue.length))}
        </Button>
      ) : autoMatch.status === 'done' ? (
        <Button variant="outline" onClick={() => setResultsOpen(true)}>
          <Wand2 aria-hidden="true" />
          {t.showResults.replace('{count}', String(autoMatch.matched))}
        </Button>
      ) : (
        <Button variant="outline" title={t.hint} disabled={isStarting} onClick={() => void start()}>
          {isStarting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
          {t.run}
        </Button>
      )}

      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.resultsTitle}</DialogTitle>
            <DialogDescription>{t.resultsDescription}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            {summary.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {autoMatch.failures.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t.failuresTitle.replace('{count}', String(autoMatch.failures.length))}</p>
              <ul className="space-y-1 text-muted-foreground">
                {autoMatch.failures.map((failure) => (
                  <li key={failure.recordId}>{failure.artist ?? '-'} - {failure.title ?? '-'}: {failure.error}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={isStarting} onClick={() => void start(true)}>
              <RefreshCw aria-hidden="true" />
              {t.retry}
            </Button>
            <Button disabled={isStarting} onClick={() => void start()}>
              <Wand2 aria-hidden="true" />
              {t.runAgain}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
