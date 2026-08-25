import { SupabaseClient } from '@supabase/supabase-js';

export class ContinuousLearningEngine {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Analyze decision outcomes and learn from success/failure
   */
  async analyzeOutcomes(organizationId: string) {
    const { data: decisions } = await this.supabase
      .from('autonomous_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('outcome_measured', true)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!decisions || decisions.length === 0) {
      return { successRate: 0, patterns: [] };
    }

    const successCount = decisions.filter(d => d.success).length;
    const successRate = (successCount / decisions.length) * 100;

    // Extract patterns from successful decisions
    const patterns = this.extractPatterns(decisions);

    return {
      successRate: Math.round(successRate),
      decisionCount: decisions.length,
      patterns,
    };
  }

  /**
   * Identify weak predictions for improvement
   */
  async identifyWeakPredictions(organizationId: string) {
    const { data: outcomes } = await this.supabase
      .from('forecast_outcomes')
      .select('accuracy_score, error_percentage')
      .eq('organization_id', organizationId)
      .lt('accuracy_score', 60)
      .order('error_percentage', { ascending: false })
      .limit(20);

    return {
      weakPredictionCount: outcomes?.length || 0,
      avgError: outcomes ? Math.round(outcomes.reduce((sum, o) => sum + (o.error_percentage || 0), 0) / outcomes.length) : 0,
    };
  }

  /**
   * Extract successful patterns from decisions
   */
  private extractPatterns(decisions: any[]): string[] {
    const patterns: string[] = [];
    
    const successful = decisions.filter(d => d.success);
    if (successful.length > 0) {
      const decisionTypes = [...new Set(successful.map(d => d.decision_type))];
      patterns.push(`Most successful decision types: ${decisionTypes.slice(0, 3).join(', ')}`);
    }

    const highConfidence = decisions.filter(d => d.confidence_score > 80 && d.success);
    if (highConfidence.length > decisions.length * 0.6) {
      patterns.push('High confidence decisions have strong success rate');
    }

    return patterns;
  }
}
