// Missing tokens / configuration are never shown as raw errors: they open the SetupIssueDialog
// (mounted once in AdminPage), which explains the problem and how to fix it.

export type SetupIssue =
  | 'discogsTokenMissing'
  | 'discogsTokenInvalid'
  | 'discogsSellerSettings'
  | 'discogsServerNotConfigured'
  | 'functionNotDeployed'
  | 'geminiNotConfigured'
  | 'spotifyNotConfigured'
  | 'spotifyWrongHost'
  | 'spotifyConnect'
  | 'spotifyLoginFailed'
  | 'spotifyUserNotRegistered'

export type SetupIssueRequest = {
  issue: SetupIssue
  /** Technical detail (shown collapsed) or, for functionNotDeployed, the function name. */
  detail?: string
  /** The entered token for token issues, true when the main action was chosen, false when closed. */
  resolve: (result: string | boolean) => void
}

let handler: ((request: SetupIssueRequest) => void) | null = null

export function registerSetupIssueHandler(next: (request: SetupIssueRequest) => void) {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function showSetupIssue(issue: SetupIssue, detail?: string): Promise<string | boolean> {
  const current = handler
  if (!current) return Promise.resolve(false)
  return new Promise((resolve) => current({ issue, detail, resolve }))
}

/** Maps an error message (edge function / Spotify) to the setup problem behind it, if any. */
export function detectSetupIssue(message: string): SetupIssue | null {
  if (message.includes('DISCOGS_TOKEN_MISSING')) return 'discogsTokenMissing'
  if (message.includes('DISCOGS_TOKEN_INVALID')) return 'discogsTokenInvalid'
  if (message.includes('DISCOGS_SELLER_SETTINGS_MISSING')) return 'discogsSellerSettings'
  if (/Discogs is not configured|not configured to read Discogs tokens/i.test(message)) return 'discogsServerNotConfigured'
  if (message.includes('GEMINI_API_KEY')) return 'geminiNotConfigured'
  if (message.includes('SPOTIFY_NOT_CONFIGURED')) return 'spotifyNotConfigured'
  if (message.includes('SPOTIFY_NOT_CONNECTED')) return 'spotifyConnect'
  // Development-mode Spotify apps answer 403 for accounts missing from User Management.
  if (/Spotify HTTP 403/.test(message)) return 'spotifyUserNotRegistered'
  return null
}

/** For inline messages: a setup problem is explained by the dialog, so show a plain fallback instead. */
export function friendlyErrorMessage(message: string, fallback: string) {
  return detectSetupIssue(message) || /Requested function was not found|function not deployed/i.test(message) ? fallback : message
}

/** Shows the dialog when the message is a setup problem. Returns true when it did. */
export function reportSetupIssue(message: string): boolean {
  const issue = detectSetupIssue(message)
  if (!issue) return false
  void showSetupIssue(issue, message)
  return true
}
