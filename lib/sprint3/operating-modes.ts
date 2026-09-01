/**
 * Operating Modes Manager
 *
 * SHADOW: Analyze and prepare, NO external execution
 * APPROVAL: All high-risk actions require human approval (default)
 * AUTONOMOUS: Level 1 auto-executes, Level 2+ requires approval
 *
 * Mode is loaded from persistent DB (ai_usage_limits.approval_level) first;
 * falls back to 'approval' (safe default) when unavailable.
 *
 * Risk → Sprint 3 semantic mapping (using actual Phase 6 schema values):
 *   low      → LOW            (level_1, autonomous approval_level)
 *   medium   → CONTROLLED     (level_2, controlled approval_level)
 *   high     → APPROVAL_REQUIRED (level_3, approval_required approval_level)
 *   critical → PROHIBITED     (level_4, human_only approval_level — never autonomous)
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type OperatingMode = 'shadow' | 'approval' | 'autonomous'

export interface ModeConfig {
  mode: OperatingMode
  description: string
  allowAutoExecution: boolean
}

export const OPERATING_MODES: Record<OperatingMode, ModeConfig> = {
  shadow: {
    mode: 'shadow',
    description: 'Shadow Mode: Analyze & prepare actions, but NO external execution',
    allowAutoExecution: false,
  },
  approval: {
    mode: 'approval',
    description: 'Approval Mode: All high-risk actions require human approval (DEFAULT)',
    allowAutoExecution: false,
  },
  autonomous: {
    mode: 'autonomous',
    description: 'Autonomous Mode: Level 1/low can auto-execute, Level 2+ requires approval',
    allowAutoExecution: true,
  },
}

/**
 * Map Phase 6 approval_level DB values to OperatingMode
 * 'autonomous' → autonomous, 'controlled'|'approval_required' → approval, everything else → approval
 */
export function dbApprovalLevelToMode(dbLevel: string | null | undefined): OperatingMode {
  if (dbLevel === 'autonomous') return 'autonomous'
  // controlled and approval_required both require approval
  return 'approval'
}

export class OperatingModeManager {
  constructor(private supabase?: SupabaseClient) {}

  /**
   * Load authoritative mode from DB; fall back to 'approval' (safe default).
   * Never trusts caller-supplied mode.
   */
  async getModePersistent(organizationId: string): Promise<OperatingMode> {
    if (!this.supabase) return 'approval'
    try {
      const { data } = await this.supabase
        .from('ai_usage_limits')
        .select('approval_level')
        .eq('organization_id', organizationId)
        .single()

      if (!data) return 'approval'
      return dbApprovalLevelToMode(data.approval_level)
    } catch {
      // Fail closed
      return 'approval'
    }
  }

  getModeConfig(mode: OperatingMode): ModeConfig {
    return OPERATING_MODES[mode]
  }

  /**
   * Returns true when the action requires human approval given the operating mode,
   * risk level, and authorization level.
   *
   * Risk mapping:
   *   low      → LOW (level_1) — may auto-execute in autonomous mode
   *   medium   → CONTROLLED (level_2) — requires approval
   *   high     → APPROVAL_REQUIRED (level_3) — requires approval
   *   critical → PROHIBITED (level_4) — never autonomous
   */
  requiresApproval(
    mode: OperatingMode,
    authorizationLevel: 1 | 2 | 3 | 4,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): boolean {
    // Shadow always blocks execution (records "would execute")
    if (mode === 'shadow') return true
    // Approval mode always requires approval
    if (mode === 'approval') return true
    // Autonomous mode: only level_1 + low risk may auto-execute
    if (mode === 'autonomous') {
      if (authorizationLevel === 1 && riskLevel === 'low') return false
      return true
    }
    return true
  }
}
