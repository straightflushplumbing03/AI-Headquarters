'use client'

export function Card({
  children,
  className = '',
  ...props
}: {
  children: React.ReactNode
  className?: string
  [key: string]: any
}) {
  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-xl p-6 $${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
