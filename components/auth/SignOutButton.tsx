'use client'

import { logout } from '@/lib/auth/logout'
import { Button } from '@/components/Button'

export function SignOutButton() {
  return (
    <Button
      onClick={async () => {
        await logout()
      }}
      className="bg-red-600 hover:bg-red-700 text-white"
    >
      Sign Out
    </Button>
  )
}
