/**
 * AI-Headquarters Platform
 * Phases 1-7: Complete Business Intelligence & Autonomous Execution System
 * 
 * This integration file ties together all components:
 * - Phase 1-4: Core Analytics & Business Intelligence
 * - Phase 5: Predictive Intelligence & Forecasting
 * - Phase 6: Autonomous Decision & Action Engine
 * - Phase 7: Continuous Learning & Self-Optimization
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Phase6Orchestrator } from './phase6/phase6-orchestrator';
import { Phase7LearningOrchestrator } from './phase7/phase7-learning-orchestrator';
import { ExecutiveCommandCenter } from './phase6/executive-command-center';
import { SafetyAndCompliance } from './phase6/safety-and-compliance';
import { SystemHealthMonitor } from './phase6-7/system-health-monitor';

export class AIHeadquartersPlatform {
  private phase6: Phase6Orchestrator;
  private phase7: Phase7LearningOrchestrator;
  private executiveCenter: ExecutiveCommandCenter;
  private safety: SafetyAndCompliance;
  private health: SystemHealthMonitor;

  constructor(private supabase: SupabaseClient) {
    this.phase6 = new Phase6Orchestrator(supabase);
    this.phase7 = new Phase7LearningOrchestrator(supabase);
    this.executiveCenter = new ExecutiveCommandCenter(supabase);
    this.safety = new SafetyAndCompliance(supabase);
    this.health = new SystemHealthMonitor(supabase);
  }

  /**
   * Main execution flow: Analyze -> Predict -> Decide -> Act -> Learn -> Improve
   */
  async executeFullCycle(organizationId: string, input: any, agentId: string) {
    // Step 1: Check system health
    const health = await this.health.checkSystemHealth(organizationId);
    if (!health.overall_healthy) {
      console.warn('System health degraded, proceeding with caution');
    }

    // Step 2: Make decision
    const decision = await this.phase6.orchestrateDecisionToAction(
      organizationId,
      input,
      agentId
    );

    // Step 3: Process outcome and learn
    if (input.outcome) {
      await this.phase7.processOutcome(
        organizationId,
        decision.decisionId,
        input.outcome,
        agentId
      );
    }

    return decision;
  }

  /**
   * Get executive briefing
   */
  async getExecutiveBriefing(organizationId: string) {
    return this.executiveCenter.getFiveMinuteBriefing(organizationId);
  }

  /**
   * Emergency stop all autonomous operations
   */
  async emergencyStop(organizationId: string) {
    return this.safety.emergencyStop(organizationId);
  }
}
