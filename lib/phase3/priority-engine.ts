import type { PriorityScore, Opportunity } from '@/types/phase3'

/**
 * Priority Scoring Engine
 * Calculates normalized opportunity scores for intelligent prioritization
 */
export class PriorityEngine {
  /**
   * Calculate priority score for opportunity
   * Score = (impact * confidence * urgency) / effort
   * Normalized to 0-100
   */
  static calculateScore(
    impact: number, // 0-1 (potential business value)
    confidence: number, // 0-1 (likelihood of success)
    urgency: number, // 0-1 (time sensitivity)
    effort: number // 0-1 (resources required, lower is better)
  ): PriorityScore {
    // Clamp values to 0-1
    const clampedImpact = Math.max(0, Math.min(1, impact))
    const clampedConfidence = Math.max(0, Math.min(1, confidence))
    const clampedUrgency = Math.max(0, Math.min(1, urgency))
    const clampedEffort = Math.max(0.1, Math.min(1, effort)) // min 0.1 to avoid division by zero

    // Calculate raw score
    const rawScore =
      (clampedImpact * clampedConfidence * clampedUrgency) / clampedEffort

    // Normalize to 0-100 (theoretical max is 1/0.1 = 10)
    const normalizedScore = (rawScore / 10) * 100
    const calculatedScore = Math.min(100, normalizedScore)

    return {
      impact: clampedImpact,
      confidence: clampedConfidence,
      urgency: clampedUrgency,
      effort: clampedEffort,
      calculated_score: calculatedScore,
    }
  }

  /**
   * Rank opportunities by priority score
   */
  static rankOpportunities(
    opportunities: Opportunity[]
  ): (Opportunity & { rank: number })[]
  {
    return opportunities
      .map((opp) => ({
        ...opp,
        rank: opp.priority_score,
      }))
      .sort((a, b) => b.rank - a.rank)
  }

  /**
   * Filter opportunities by score threshold
   */
  static filterByThreshold(
    opportunities: Opportunity[],
    minScore: number
  ): Opportunity[] {
    return opportunities.filter((opp) => opp.priority_score >= minScore)
  }

  /**
   * Get top N opportunities
   */
  static getTop(
    opportunities: Opportunity[],
    count: number
  ): Opportunity[] {
    return opportunities
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, count)
  }

  /**
   * Categorize opportunities by priority band
   */
  static categorizeBands(opportunities: Opportunity[]): {
    critical: Opportunity[]
    high: Opportunity[]
    medium: Opportunity[]
    low: Opportunity[]
  } {
    return {
      critical: opportunities.filter((o) => o.priority_score >= 80),
      high: opportunities.filter((o) => o.priority_score >= 60 && o.priority_score < 80),
      medium: opportunities.filter(
        (o) => o.priority_score >= 40 && o.priority_score < 60
      ),
      low: opportunities.filter((o) => o.priority_score < 40),
    }
  }
}
