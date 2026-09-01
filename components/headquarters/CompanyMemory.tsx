'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'

export function CompanyMemory() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [memories, setMemories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  useEffect(() => {
    const loadMemories = async () => {
      try {
        const { data } = await supabase
          .from('company_memory')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })

        setMemories(data || [])
      } catch (error) {
        console.error('Failed to load memories:', error)
      } finally {
        setLoading(false)
      }
    }

    loadMemories()
  }, [organizationId, supabase])

  const categories = Array.from(new Set(memories.map((m) => m.category)))
  const filteredMemories = selectedCategory
    ? memories.filter((m) => m.category === selectedCategory)
    : memories

  return (
    <Container className="py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Company Memory</h1>
        <p className="text-slate-400 mt-2">Knowledge base for your AI workforce</p>
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              selectedCategory === null
                ? 'bg-primary-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All ({memories.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {cat} ({memories.filter((m) => m.category === cat).length})
            </button>
          ))}
        </div>
      )}

      {/* Memory Items */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center text-slate-400">Loading memory...</div>
        ) : filteredMemories.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-slate-400">No memories yet</p>
            <p className="text-slate-500 text-sm mt-2">
              Knowledge will accumulate as your AI employees work
            </p>
          </Card>
        ) : (
          filteredMemories.map((memory) => (
            <Card key={memory.id} className="p-6">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <h3 className="text-lg font-semibold">{memory.title}</h3>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                    {memory.category}
                  </span>
                </div>
                <p className="text-slate-300">{memory.content}</p>
                <p className="text-xs text-slate-500 pt-2">
                  {new Date(memory.created_at).toLocaleDateString()}
                </p>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
