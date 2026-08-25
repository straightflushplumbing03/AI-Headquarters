/**
 * Phase 6: Decision Engine
 * Evaluates business intelligence and determines autonomous actions
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface DecisionInput {
  organizationId: string;
  decisionType: string;
  trigger: string;
  evidence: Record<string, any>;
  metrics: Record<string, any>;
  predictedOutcome?: string;
  relatedPredictions?: string[];
}

export interface Decision {
  id: string;
  organizationId: string;
  decisionType: string;
  title: string;
  reasoning: string;
  confidenceScore: number;
  confidenceLevel: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  expectedRevenueImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvalRequired: boolean;
  recommendedAction: string;
  status: string;
}

export class DecisionEngine {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Evaluate and create an autonomous decision
   */
  async makeDecision(input: DecisionInput): Promise<Decision> {
    const confidenceScore = this.calculateConfidence(input);
    const confidenceLevel = this.getConfidenceLevel(confidenceScore);
    const riskLevel = this.assessRisk(input);
    const approvalRequired = riskLevel === 'high' || riskLevel === 'critical' || confidenceScore < 65;

    const decision: Omit<Decision, 'id'> = {
      organizationId: input.organizationId,
      decisionType: input.decisionType,
      title: `${input.decisionType}: ${input.trigger}`,
      reasoning: this.generateReasoning(input),
      confidenceScore,
      confidenceLevel,
      expectedRevenueImpact: this.estimateRevenueImpact(input),
      riskLevel,
      approvalRequired,
      recommendedAction: this.generateRecommendedAction(input),
      status: 'pending',
    };

    const { data, error } = await this.supabase
      .from('autonomous_decisions')
      .insert({
        organization_id: input.organizationId,
        decision_type: input.decisionType,
        title: decision.title,
        description: input.trigger,
        reasoning: decision.reasoning,
        trigger_event: input.trigger,
        trigger_data: input,
        supporting_evidence: input.evidence,
        relevant_metrics: input.metrics,
        confidence_score: decision.confidenceScore,
        confidence_level: decision.confidenceLevel,
        expected_revenue_impact: decision.expectedRevenueImpact,
        risk_level: decision.riskLevel,
        approval_required: decision.approvalRequired,
        recommended_action: decision.recommendedAction,
        approval_level: approvalRequired ? 'approval_required' : 'controlled',
      })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      ...decision,
    };
  }

  /**
   * Calculate confidence score (0-100)
   */
  private calculateConfidence(input: DecisionInput): number {
    let score = 50;

    // Evidence quality
    const evidenceCount = Object.keys(input.evidence).length;
    if (evidenceCount > 5) score += 20;
    else if (evidenceCount > 2) score += 10;

    // Metric count
    const metricCount = Object.keys(input.metrics).length;
    if (metricCount > 5) score += 15;
    else if (metricCount > 2) score += 8;

    // Related predictions
    if (input.relatedPredictions && input.relatedPredictions.length > 0) {
      score += 10;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Categorize confidence level
   */
  private getConfidenceLevel(score: number): 'very_low' | 'low' | 'medium' | 'high' | 'very_high' {
    if (score < 20) return 'very_low';
    if (score < 40) return 'low';
    if (score < 65) return 'medium';
    if (score < 85) return 'high';
    return 'very_high';
  }

  /**
   * Assess risk level
   */
  private assessRisk(input: DecisionInput): 'low' | 'medium' | 'high' | 'critical' {
    let risk = 0;

    const revenue = input.metrics.predicted_revenue || 0;
    if (revenue > 50000) risk += 3;
    else if (revenue > 10000) risk += 2;
    else if (revenue > 1000) risk += 1;

    if (input.decisionType.includes('financial')) risk += 2;
    if (input.decisionType.includes('customer')) risk += 1;
    if (input.decisionType.includes('churn')) risk += 2;

    if (risk >= 6) return 'critical';
    if (risk >= 4) return 'high';
    if (risk >= 2) return 'medium';
    return 'low';
  }

  /**
   * Estimate revenue impact
   */
  private estimateRevenueImpact(input: DecisionInput): number {
    return input.metrics.predicted_revenue || 0;
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(input: DecisionInput): string {
    return `Decision based on: ${input.trigger}. Supporting evidence: ${Object.keys(input.evidence).join(', ')}`;
  }

  /**
   * Generate recommended action
   */
  private generateRecommendedAction(input: DecisionInput): string {
    return `Execute ${input.decisionType} based on analysis: ${input.trigger}`;
  }
}
