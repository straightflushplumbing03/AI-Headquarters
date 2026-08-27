/**
 * Operating Modes Manager
 *
 * SHADOW: Analyze and prepare, NO external execution
 * APPROVAL: All high-risk actions require human approval (default)
 * AUTONOMOUS: Level 1 auto-executes, Level 2+ requires approval
 */

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
    description: 'Autonomous Mode: Level 1 can auto-execute, Level 2+ requires approval',
    allowAutoExecution: true,
  },
}

export class OperatingModeManager {
  private organizationModes: Map<string, OperatingMode> = new Map()

  setMode(organizationId: string, mode: OperatingMode): void {
    if (!OPERATING_MODES[mode]) throw new Error(`Invalid mode: ${mode}`)
    this.organizationModes.set(organizationId, mode)
  }

  getMode(organizationId: string): OperatingMode {
    return this.organizationModes.get(organizationId) || 'approval'
  }

  getModeConfig(organizationId: string): ModeConfig {
    return OPERATING_MODES[this.getMode(organizationId)]
  }

  requiresApproval(
    organizationId: string,
    authorizationLevel: 1 | 2 | 3 | 4,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): boolean {
    const mode = this.getMode(organizationId)
    if (mode === 'shadow') return true
    if (mode === 'approval') return true
    if (mode === 'autonomous') {
      if (authorizationLevel === 1 && riskLevel === 'low') return false
      return true
    }
    return true
  }
}
