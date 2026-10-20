import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { AuthContext, useAuth } from '@/lib/auth'
import type { CollectionOwner } from '@/lib/collection'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [owner, setOwner] = useState<CollectionOwner | null>(null)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('admins')
      .select('collection_owner')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('Admin lookup failed:', error)
        const value = data?.collection_owner
        setOwner(value === 'Raphael' || value === 'Tim' ? value : null)
        setOwnerUserId(userId)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const ownerLoading = userId !== null && ownerUserId !== userId
  const value = {
    session,
    owner: userId && ownerUserId === userId ? owner : null,
    loading: sessionLoading || ownerLoading,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, owner, loading } = useAuth()
  if (loading) return null
  if (!session || !owner) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}
