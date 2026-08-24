import { SupabaseClient } from '@supabase/supabase-js'
import type { SEOExperiment } from '@/types/phase4'

/**
 * SEO Experimentation Engine
 * Tracks SEO experiments with hypothesis, implementation, measurement
 */
export class SEOExperimentationEngine {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create an experiment
   */
  async createExperiment(
    organizationId: string,
    experiment: Omit<SEOExperiment, 'id' | 'organization_id' | 'actual_result' | 'created_at' | 'updated_at'>
  ): Promise<SEOExperiment> {
    const { data, error } = await this.supabase
      .from('seo_experiments')
      .insert([
        {
          ...experiment,
          organization_id: organizationId,
          started_at: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Record experiment result
   */
  async recordResult(
    experimentId: string,
    result: 'improved' | 'declined' | 'neutral' | 'inconclusive',
    resultValue: number,
    significant: boolean = false
  ): Promise<SEOExperiment> {
    // Get baseline to calculate change
    const { data: exp } = await this.supabase
      .from('seo_experiments')
      .select('baseline_value')
      .eq('id', experimentId)
      .single()

    let changePercent = 0
    if (exp?.baseline_value && exp.baseline_value !== 0) {
      changePercent = ((resultValue - exp.baseline_value) / exp.baseline_value) * 100
    }

    const { data, error } = await this.supabase
      .from('seo_experiments')
      .update({
        actual_result: result,
        result_value: resultValue,
        change_percent: changePercent,
        significant,
        ended_at: new Date().toISOString(),
      })
      .eq('id', experimentId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Add learning note
   */
  async addLearning(experimentId: string, learning: string): Promise<SEOExperiment> {
    const { data, error } = await this.supabase
      .from('seo_experiments')
      .update({
        learning_recorded: learning,
      })
      .eq('id', experimentId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get active experiments
   */
  async getActiveExperiments(organizationId: string): Promise<SEOExperiment[]> {
    const { data } = await this.supabase
      .from('seo_experiments')
      .select('*')
      .eq('organization_id', organizationId)
      .is('actual_result', null)
      .order('started_at', { ascending: false })

    return data || []
  }

  /**
   * Get completed experiments
   */
  async getCompletedExperiments(organizationId: string, limit: number = 20): Promise<SEOExperiment[]> {
    const { data } = await this.supabase
      .from('seo_experiments')
      .select('*')
      .eq('organization_id', organizationId)
      .not('actual_result', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Get experiment success rate
   */
  async getExperimentSuccessRate(organizationId: string): Promise<any> {
    const experiments = await this.getCompletedExperiments(organizationId, 100)

    if (experiments.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        neutral: 0,
        inconclusive: 0,
        success_rate: 0,
      }
    }

    const improved = experiments.filter((e) => e.actual_result === 'improved').length
    const declined = experiments.filter((e) => e.actual_result === 'declined').length
    const neutral = experiments.filter((e) => e.actual_result === 'neutral').length
    const inconclusive = experiments.filter((e) => e.actual_result === 'inconclusive').length

    return {
      total: experiments.length,
      successful: improved,
      failed: declined,
      neutral,
      inconclusive,
      success_rate: (improved / experiments.length) * 100,
      average_confidence: experiments.reduce((sum, e) => sum + (e.confidence || 0), 0) / experiments.length,
    }
  }

  /**
   * Get learnings from experiments
   */
  async extractLearnings(organizationId: string): Promise<string[]> {
    const experiments = await this.getCompletedExperiments(organizationId, 50)

    return experiments
      .filter((e) => e.learning_recorded)
      .map((e) => e.learning_recorded)
      .filter((learning): learning is string => Boolean(learning))
  }

  /**
   * Get winning strategies
   */
  async getWinningStrategies(organizationId: string): Promise<any[]> {
    const experiments = await this.getCompletedExperiments(organizationId, 100)

    const improved = experiments.filter((e) => e.actual_result === 'improved')

    const strategies: Record<string, any> = {}

    for (const exp of improved) {
      const type = exp.change_type || 'unknown'
      if (!strategies[type]) {
        strategies[type] = {
          type,
          count: 0,
          average_improvement: 0,
          examples: [],
        }
      }
      strategies[type].count++
      strategies[type].average_improvement += exp.change_percent || 0
      strategies[type].examples.push({
        hypothesis: exp.hypothesis,
        improvement: exp.change_percent,
        significant: exp.significant,
      })
    }

    // Calculate averages
    for (const type in strategies) {
      strategies[type].average_improvement /= strategies[type].count
    }

    return Object.values(strategies).sort((a, b) => b.average_improvement - a.average_improvement)
  }
}
