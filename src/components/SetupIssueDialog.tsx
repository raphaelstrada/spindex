import { Fragment, useEffect, useState } from 'react'
import { ExternalLink, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translations, type Language } from '@/lib/i18n'
import { registerSetupIssueHandler, type SetupIssue, type SetupIssueRequest } from '@/lib/setupIssues'
import { spotifyRedirectUri } from '@/lib/spotify'

const DISCOGS_DEVELOPERS = 'https://www.discogs.com/settings/developers'
const SPOTIFY_DASHBOARD = 'https://developer.spotify.com/dashboard'

const issueLinks: Partial<Record<SetupIssue, string>> = {
  discogsTokenMissing: DISCOGS_DEVELOPERS,
  discogsTokenInvalid: DISCOGS_DEVELOPERS,
  discogsSellerSettings: 'https://www.discogs.com/settings/seller',
  discogsServerNotConfigured: DISCOGS_DEVELOPERS,
  geminiNotConfigured: 'https://aistudio.google.com/apikey',
  spotifyNotConfigured: SPOTIFY_DASHBOARD,
  spotifyConnect: SPOTIFY_DASHBOARD,
  spotifyLoginFailed: SPOTIFY_DASHBOARD,
  spotifyUserNotRegistered: SPOTIFY_DASHBOARD,
}

const tokenIssues = new Set<SetupIssue>(['discogsTokenMissing', 'discogsTokenInvalid'])
// The detail is only worth showing when it can help diagnose (it is never the main message).
const issuesWithDetails = new Set<SetupIssue>(['spotifyLoginFailed', 'spotifyUserNotRegistered'])

/** Renders `code` spans in the step text (commands, URLs, variable names). */
function StepText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => index % 2 === 1
        ? <code key={index} className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">{part}</code>
        : <Fragment key={index}>{part}</Fragment>)}
    </>
  )
}

/** Explains a missing token/configuration and how to fix it. Mounted once in AdminPage. */
export function SetupIssueDialog({ language }: { language: Language }) {
  const t = translations[language].setup
  // Queue: several actions can hit the same problem at once; each request gets its own answer.
  const [queue, setQueue] = useState<SetupIssueRequest[]>([])
  const [token, setToken] = useState('')
  const current = queue[0]

  useEffect(() => registerSetupIssueHandler((request) => setQueue((items) => {
    // The same problem reported twice (e.g. by a batch) is explained once.
    if (items.some((item) => item.issue === request.issue)) {
      request.resolve(false)
      return items
    }
    return [...items, request]
  })), [])

  function finish(result: string | boolean) {
    current?.resolve(result)
    setToken('')
    setQueue((items) => items.slice(1))
  }

  if (!current) return null

  const content = t.issues[current.issue]
  const fill = (text: string) => text
    .replace('{redirectUri}', spotifyRedirectUri())
    .replace(/\{name\}/g, current.detail ?? '')
  const link = issueLinks[current.issue]
  const needsToken = tokenIssues.has(current.issue)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) finish(false) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {content.title}
          </DialogTitle>
          <DialogDescription>{fill(content.body)}</DialogDescription>
        </DialogHeader>

        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          {content.steps.map((step) => <li key={step}><StepText text={fill(step)} /></li>)}
        </ol>

        {link && content.link && (
          <Button asChild variant="outline" className="w-fit">
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {content.link}
            </a>
          </Button>
        )}

        {needsToken && (
          <form
            id="setup-issue-token"
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              if (token.trim()) finish(token.trim())
            }}
          >
            <Label htmlFor="setup-issue-token-input">{t.tokenLabel}</Label>
            <Input
              id="setup-issue-token-input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t.tokenPlaceholder}
            />
          </form>
        )}

        {current.detail && issuesWithDetails.has(current.issue) && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t.technicalDetails}</summary>
            <p className="mt-1 break-words font-mono">{current.detail}</p>
          </details>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => finish(false)}>{t.close}</Button>
          {content.action && (needsToken ? (
            <Button type="submit" form="setup-issue-token" disabled={!token.trim()}>{content.action}</Button>
          ) : (
            <Button type="button" onClick={() => finish(true)}>{content.action}</Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
