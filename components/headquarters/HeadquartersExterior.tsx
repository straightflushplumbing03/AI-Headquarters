'use client'

import { Organization } from '@/types/models'
import { Container } from '@/components/Container'
import { Button } from '@/components/Button'

interface HeadquartersExteriorProps {
  organization: Organization
  onEnter: () => void
}

export function HeadquartersExterior({ organization, onEnter }: HeadquartersExteriorProps) {
  return (
    <Container className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-4xl">
        {/* Building */}
        <div className="mb-12 perspective">
          <div className="relative mx-auto" style={{ maxWidth: '400px' }}>
            {/* Building structure */}
            <div className="relative bg-gradient-to-b from-slate-700 to-slate-900 rounded-t-3xl shadow-2xl overflow-hidden border-4" style={{
              borderColor: organization.primary_color,
            }}>
              {/* Roof */}
              <div className="h-20 bg-gradient-to-b" style={{
                background: `linear-gradient(to bottom, ${organization.secondary_color}, ${organization.primary_color})`,
              }} />

              {/* Main building */}
              <div className="p-8 space-y-6">
                {/* Logo area */}
                <div className="flex justify-center mb-8">
                  {organization.logo_url ? (
                    <img
                      src={organization.logo_url}
                      alt={organization.name}
                      className="h-24 w-auto object-contain"
                    />
                  ) : (
                    <div className="h-24 w-24 bg-slate-800 rounded-lg flex items-center justify-center border-2" style={{
                      borderColor: organization.primary_color,
                    }}>
                      <span className="text-4xl">🏢</span>
                    </div>
                  )}
                </div>

                {/* Building name */}
                <div className="text-center space-y-2">
                  <h1 className="text-4xl font-bold" style={{ color: organization.primary_color }}>
                    {organization.name}
                  </h1>
                  <p className="text-xl font-semibold" style={{ color: organization.secondary_color }}>
                    AI Headquarters
                  </p>
                  {organization.industry && (
                    <p className="text-slate-400 text-sm">{organization.industry}</p>
                  )}
                </div>

                {/* Windows (visual element) */}
                <div className="grid grid-cols-3 gap-4 mt-8">
                  {[...Array(9)].map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-lg border-2 transition-all duration-500"
                      style={{
                        borderColor: organization.primary_color,
                        backgroundColor: `${organization.primary_color}20`,
                        animation: `twinkle ${2 + Math.random()}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Ground */}
            <div className="h-8 bg-gradient-to-b from-slate-800 to-slate-900 rounded-b-xl border-4" style={{
              borderColor: organization.primary_color,
            }} />
          </div>
        </div>

        {/* CTA Button */}
        <div className="text-center">
          <p className="text-slate-300 mb-6 text-lg">Your AI-powered virtual workforce is ready</p>
          <Button
            onClick={onEnter}
            className="px-8 py-4 text-lg"
            style={{
              background: `linear-gradient(135deg, ${organization.primary_color}, ${organization.secondary_color})`,
            }}
          >
            Enter Headquarters
          </Button>
        </div>
      </div>

      <style jsx>{`
        @keyframes twinkle {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 1;
          }
        }
        .perspective {
          perspective: 1000px;
        }
      `}</style>
    </Container>
  )
}
