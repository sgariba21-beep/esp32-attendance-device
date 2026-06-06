import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createAuthClient } from './server'

export const verifySession = cache(async () => {
  const supabase = await createAuthClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return { user: user! }
})
