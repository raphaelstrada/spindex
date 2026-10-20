import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/i18n'

export default function LoginPage() {
  const language: Language = window.localStorage.getItem('spindex-language') === 'pt' ? 'pt' : 'en'
  const t = translations[language]
  const { session, owner, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', window.localStorage.getItem('spindex-theme') !== 'light')
    document.documentElement.lang = language
    document.title = `${t.auth.loginTitle} · ${t.app.title}`
  }, [language, t.app.title, t.auth.loginTitle])

  if (loading) return null
  if (session && owner) return <Navigate to="/admin" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErrorMsg(t.auth.invalidCredentials)
    setIsSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1>
            <Logo />
          </h1>
          <p className="text-sm text-muted-foreground">{t.auth.loginTitle}</p>
        </div>
        {session ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive" role="alert">{t.auth.notAuthorized}</p>
            <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
              {t.auth.signOut}
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="login-email">{t.auth.email}</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">{t.auth.password}</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {errorMsg && <p className="text-sm text-destructive" role="alert">{errorMsg}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t.auth.signingIn : t.auth.signIn}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
