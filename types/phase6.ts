export namespace Phase6 {
  export interface AutonomousDecision {
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
    executionStatus: string;
    createdAt: string;
  }

  export interface AutonomousAction {
    id: string;
    organizationId: string;
    decisionId?: string;
    actionType: string;
    payload: Record<string, any>;
    authorizationLevel: 'level_1' | 'level_2' | 'level_3' | 'level_4';
    executionStatus: string;
    result?: Record<string, any>;
    createdAt: string;
  }

  export interface ApprovalRequest {
    id: string;
    organizationId: string;
    decisionId: string;
    title: string;
    reasoning: string;
    expectedImpact: string;
    approvalStatus: string;
    createdAt: string;
  }
}
