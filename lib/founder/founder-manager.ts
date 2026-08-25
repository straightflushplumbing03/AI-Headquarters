import { SupabaseClient } from '@supabase/supabase-js'

export class FounderAccountManager {
  constructor(private supabase: SupabaseClient) {}

  async isFounder(userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'founder')
      .single()
    return !!data
  }

  async designateAsFounder(userId: string): Promise<void> {
    await this.supabase.from('user_roles').insert([{ user_id: userId, role: 'founder' }])
  }

  async getFounderAIBudget(userId: string): Promise<{ monthlyBudget: number; currentSpend: number; remaining: number }> {
    const isFounder = await this.isFounder(userId)
    if (!isFounder) throw new Error('Not a Founder')

    const { data } = await this.supabase
      .from('founder_ai_budgets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!data) return { monthlyBudget: 0, currentSpend: 0, remaining: 0 }
    return {
      monthlyBudget: data.monthly_budget,
      currentSpend: data.current_spend,
      remaining: data.monthly_budget - data.current_spend,
    }
  }

  async setFounderAIBudget(userId: string, monthlyBudget: number): Promise<void> {
    const isFounder = await this.isFounder(userId)
    if (!isFounder) throw new Error('Not a Founder')
    await this.supabase
      .from('founder_ai_budgets')
      .upsert([{ user_id: userId, monthly_budget: monthlyBudget, current_spend: 0 }], {
        onConflict: 'user_id',
      })
  }

  async recordFounderAISpend(userId: string, cost: number): Promise<void> {
    const { data: budget } = await this.supabase
      .from('founder_ai_budgets')
      .select('current_spend')
      .eq('user_id', userId)
      .single()

    const newSpend = (budget?.current_spend || 0) + cost
    await this.supabase.from('founder_ai_budgets').update({ current_spend: newSpend }).eq('user_id', userId)
  }
}
