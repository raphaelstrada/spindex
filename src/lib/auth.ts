import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { CollectionOwner } from '@/lib/collection'

export type AuthState = {
  session: Session | null
  owner: CollectionOwner | null
  loading: boolean
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}
