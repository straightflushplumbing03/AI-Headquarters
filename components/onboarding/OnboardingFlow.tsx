'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'

type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

interface OnboardingData {
  companyName: string
  website: string
  industry: string
  description: string
  logoFile: File | null
  primaryGoal: string
  organizationId: string | null
}

const initialData: OnboardingData = {
  companyName: '',
  website: '',
  industry: '',
  description: '',
  logoFile: null,
  primaryGoal: '',
  organizationId: null,
}

export function OnboardingFlow() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState<OnboardingStep>(1)
  const [data, setData] = useState<OnboardingData>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [user, setUser] = useState<any>(null)

  // Load from localStorage on mount
  useEffect(() => {
    setIsClient(true)
    const savedData = localStorage.getItem('onboarding_draft')
    const savedStep = localStorage.getItem('onboarding_step')
    
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData)
        setData(parsed)
      } catch (e) {
        console.error('Failed to load saved data:', e)
      }
    }
    if (savedStep) {
      const stepNum = parseInt(savedStep) as OnboardingStep
      if (stepNum >= 1 && stepNum <= 8) {
        setStep(stepNum)
      }
    }

    // Get current user
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [])

  // Save progress to localStorage
  const saveProgress = () => {
    localStorage.setItem('onboarding_draft', JSON.stringify(data))
    localStorage.setItem('onboarding_step', step.toString())
  }

  const updateData = (updates: Partial<OnboardingData>) => {
    const newData = { ...data, ...updates }
    setData(newData)
    localStorage.setItem('onboarding_draft', JSON.stringify(newData))
  }

  const validateStep = (): boolean => {
    setError(null)
    switch (step) {
      case 2:
        if (!data.companyName.trim()) {
          setError('Company name is required')
          return false
        }
        if (data.companyName.trim().length < 2) {
          setError('Company name must be at least 2 characters')
          return false
        }
        return true
      case 3:
        if (!data.website.trim()) {
          setError('Website is required')
          return false
        }
        try {
          new URL(data.website.startsWith('http') ? data.website : `https://${data.website}`)
        } catch {
          setError('Please enter a valid website URL')
          return false
        }
        return true
      case 4:
        if (!data.industry.trim()) {
          setError('Please select an industry')
          return false
        }
        return true
      case 5:
        if (!data.description.trim()) {
          setError('Company description is required')
          return false
        }
        if (data.description.trim().length < 10) {
          setError('Description must be at least 10 characters')
          return false
        }
        return true
      case 7:
        if (!data.primaryGoal.trim()) {
          setError('Primary business goal is required')
          return false
        }
        return true
      default:
        return true
    }
  }

  const handleNext = async () => {
    if (!validateStep()) return

    // Create organization on step 2 (company name)
    if (step === 2 && !data.organizationId) {
      setLoading(true)
      try {
        const slug = data.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 50)

        // Check for duplicate slug
        const { data: existing } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', slug)
          .single()

        if (existing) {
          setError('This company name is already taken. Please use a different name.')
          setLoading(false)
          return
        }

        // Create organization
        const { data: org, error: createError } = await supabase
          .from('organizations')
          .insert([
            {
              name: data.companyName,
              slug,
              onboarding_completed: false,
            },
          ])
          .select()
          .single()

        if (createError) throw createError

        // Add user as owner
        const { error: memberError } = await supabase
          .from('organization_members')
          .insert([
            {
              organization_id: org.id,
              user_id: user.id,
              role: 'owner',
            },
          ])

        if (memberError) throw memberError

        updateData({ organizationId: org.id })
      } catch (err: any) {
        setError(err.message || 'Failed to create organization')
        setLoading(false)
        return
      } finally {
        setLoading(false)
      }
    }

    if (step < 8) {
      const nextStep = (step + 1) as OnboardingStep
      setStep(nextStep)
      saveProgress()
    }
  }

  const handleBack = () => {
    if (step > 1) {
      const prevStep = (step - 1) as OnboardingStep
      setStep(prevStep)
      localStorage.setItem('onboarding_step', prevStep.toString())
    }
  }

  const handleComplete = async () => {
    if (!validateStep()) return

    setLoading(true)
    setError(null)

    try {
      if (!data.organizationId || !user) {
        throw new Error('Missing organization or user data')
      }

      // Update organization with final data
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          website: data.website.startsWith('http')
            ? data.website
            : `https://${data.website}`,
          industry: data.industry,
          description: data.description,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.organizationId)

      if (updateError) throw updateError

      // Initialize default departments
      const departments = [
        { name: 'Executive', color: '#0ea5e9', x: 50, y: 20, icon: '👔' },
        { name: 'Marketing', color: '#8b5cf6', x: 20, y: 50, icon: '📢' },
        { name: 'Research', color: '#06b6d4', x: 80, y: 50, icon: '🔬' },
        { name: 'SEO', color: '#14b8a6', x: 20, y: 80, icon: '🔍' },
        { name: 'Technology', color: '#f59e0b', x: 50, y: 80, icon: '💻' },
        { name: 'Operations', color: '#ef4444', x: 80, y: 80, icon: '⚙️' },
      ]

      const { error: deptError } = await supabase
        .from('departments')
        .insert(
          departments.map((dept) => ({
            organization_id: data.organizationId,
            name: dept.name,
            color: dept.color,
            position_x: dept.x,
            position_y: dept.y,
            icon: dept.icon,
          }))
        )

      if (deptError) throw deptError

      // Log activity
      await supabase.from('activity_events').insert([
        {
          organization_id: data.organizationId,
          user_id: user.id,
          event_type: 'onboarding_completed',
          title: 'Headquarters created',
          description: `${data.companyName} headquarters has been established`,
          metadata: {
            company_name: data.companyName,
            industry: data.industry,
            goal: data.primaryGoal,
          },
        },
      ])

      // Clear onboarding data
      localStorage.removeItem('onboarding_draft')
      localStorage.removeItem('onboarding_step')

      // Redirect to headquarters
      router.push(`/headquarters/${data.organizationId}`)
    } catch (err: any) {
      setError(err.message || 'Failed to complete onboarding')
      console.error('Onboarding error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!isClient || !user) {
    return (
      <Container className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Loading...</h2>
        </div>
      </Container>
    )
  }

  return (
    <Container className="max-w-2xl mx-auto py-8 px-4">
      {/* Progress bar */}
      <div className="mb-12">
        <div className="flex justify-between mb-4">
          <span className="text-sm font-medium text-slate-300">Step {step} of 8</span>
          <span className="text-sm text-slate-400">{Math.round((step / 8) * 100)}%</span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-primary-500 to-secondary-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(step / 8) * 100}%` }}
          />
        </div>
      </div>

      <Card>
        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="animate-slideUp">
            <h2 className="text-3xl font-bold mb-4">Welcome to AI Headquarters</h2>
            <p className="text-slate-300 mb-6">
              Let's set up your branded virtual headquarters. Your AI workforce is waiting to transform your business.
            </p>
            <div className="space-y-4 mb-8 bg-slate-800 rounded-lg p-6">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🏢</span>
                <div>
                  <h3 className="font-semibold text-slate-100">Create Your Headquarters</h3>
                  <p className="text-slate-400 text-sm">A branded virtual office for your AI employees</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-2xl">👥</span>
                <div>
                  <h3 className="font-semibold text-slate-100">Hire AI Employees</h3>
                  <p className="text-slate-400 text-sm">Build your digital workforce to perform real business tasks</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <h3 className="font-semibold text-slate-100">Measure Results</h3>
                  <p className="text-slate-400 text-sm">Track tasks, activities, and business outcomes</p>
                </div>
              </div>
            </div>
            <Button onClick={handleNext} className="w-full">Let's Get Started</Button>
          </div>
        )}

        {/* Step 2: Company Name */}
        {step === 2 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">What's your company name?</h2>
            <p className="text-slate-400 mb-6">This will be displayed throughout your headquarters</p>
            <Input
              label="Company Name"
              placeholder="Acme Corporation"
              value={data.companyName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateData({ companyName: e.target.value })}
              disabled={loading}
              error={error && step === 2 ? error : undefined}
            />
          </div>
        )}

        {/* Step 3: Website */}
        {step === 3 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">What's your website?</h2>
            <p className="text-slate-400 mb-6">This helps our AI team learn about your business</p>
            <Input
              label="Website URL"
              placeholder="example.com or https://example.com"
              value={data.website}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateData({ website: e.target.value })}
              disabled={loading}
              error={error && step === 3 ? error : undefined}
            />
          </div>
        )}

        {/* Step 4: Industry */}
        {step === 4 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">What industry are you in?</h2>
            <p className="text-slate-400 mb-6">This helps tailor your AI workforce</p>
            <select
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              value={data.industry}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateData({ industry: e.target.value })}
              disabled={loading}
            >
              <option value="">Select an industry...</option>
              <option value="Technology">Technology</option>
              <option value="Plumbing">Plumbing & HVAC</option>
              <option value="Marketing">Marketing & Advertising</option>
              <option value="E-commerce">E-commerce</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Finance">Finance & Banking</option>
              <option value="Real Estate">Real Estate</option>
              <option value="Legal">Legal Services</option>
              <option value="Education">Education</option>
              <option value="Other">Other</option>
            </select>
            {error && step === 4 && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>
        )}

        {/* Step 5: Description */}
        {step === 5 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">Describe your business</h2>
            <p className="text-slate-400 mb-6">What does your company do?</p>
            <textarea
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors h-32 resize-none"
              placeholder="Tell us about your business, services, and what makes you unique..."
              value={data.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateData({ description: e.target.value })}
              disabled={loading}
            />
            {error && step === 5 && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>
        )}

        {/* Step 6: Logo Upload */}
        {step === 6 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">Upload your company logo</h2>
            <p className="text-slate-400 mb-6">This will brand your headquarters (optional)</p>
            <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-primary-500 transition-colors">
              <input
                type="file"
                accept="image/*"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  if (e.target.files?.[0]) {
                    const file = e.target.files[0]
                    if (file.size > 5 * 1024 * 1024) {
                      setError('File size must be less than 5MB')
                      return
                    }
                    if (!file.type.startsWith('image/')) {
                      setError('File must be an image')
                      return
                    }
                    updateData({ logoFile: file })
                    setError(null)
                  }
                }}
                disabled={loading}
                className="hidden"
                id="logo-input"
              />
              <label htmlFor="logo-input" className="cursor-pointer">
                {data.logoFile ? (
                  <div>
                    <p className="text-slate-300 font-semibold">{data.logoFile.name}</p>
                    <p className="text-slate-500 text-sm mt-2">Click to change</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-4xl mb-3">📸</p>
                    <p className="text-slate-300 font-semibold">Click to upload or drag and drop</p>
                    <p className="text-slate-500 text-sm mt-2">PNG, JPG up to 5MB</p>
                  </div>
                )}
              </label>
            </div>
            {error && step === 6 && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>
        )}

        {/* Step 7: Primary Goal */}
        {step === 7 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-2">What's your primary business goal?</h2>
            <p className="text-slate-400 mb-6">What do you want your AI workforce to focus on?</p>
            <textarea
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors h-32 resize-none"
              placeholder="e.g., Increase customer leads, improve website SEO, analyze competitor strategies..."
              value={data.primaryGoal}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateData({ primaryGoal: e.target.value })}
              disabled={loading}
            />
            {error && step === 7 && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>
        )}

        {/* Step 8: Review & Create */}
        {step === 8 && (
          <div className="animate-slideUp">
            <h2 className="text-2xl font-bold mb-6">Ready to create your headquarters?</h2>
            <div className="space-y-4 bg-slate-800 rounded-lg p-6 mb-6">
              <div>
                <p className="text-slate-400 text-sm">Company Name</p>
                <p className="text-slate-100 font-semibold">{data.companyName}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Website</p>
                <p className="text-slate-100 font-semibold">{data.website}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Industry</p>
                <p className="text-slate-100 font-semibold">{data.industry}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Logo</p>
                <p className="text-slate-100 font-semibold">{data.logoFile ? '✓ Uploaded' : 'Not provided'}</p>
              </div>
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm mb-4">{error}</div>}
            <Button
              onClick={handleComplete}
              disabled={loading}
              className="w-full bg-gradient-to-r from-secondary-600 to-secondary-700 hover:from-secondary-700 hover:to-secondary-800"
            >
              {loading ? 'Creating headquarters...' : 'Create Headquarters'}
            </Button>
          </div>
        )}
      </Card>

      {/* Navigation buttons */}
      <div className="flex gap-4 mt-8">
        <Button
          onClick={handleBack}
          variant="ghost"
          disabled={step === 1 || loading}
          className="flex-1"
        >
          Back
        </Button>
        {step < 8 && (
          <Button
            onClick={handleNext}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Processing...' : 'Next'}
          </Button>
        )}
      </div>

      {/* Save indicator */}
      <p className="text-center text-slate-500 text-sm mt-6">
        💾 Your progress is automatically saved
      </p>
    </Container>
  )
}
