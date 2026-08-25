import { SupabaseClient } from '@supabase/supabase-js';

export class ApprovalWorkflow {
  constructor(private supabase: SupabaseClient) {}

  async createApprovalRequest(
    organizationId: string,
    decisionId: string,
    title: string,
    reasoning: string,
    expectedImpact: string,
    riskAssessment: string,
    responseDeadline?: Date
  ) {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .insert({
        organization_id: organizationId,
        decision_id: decisionId,
        request_type: 'decision',
        title,
        description: reasoning,
        reasoning,
        expected_impact: expectedImpact,
        risk_assessment: riskAssessment,
        approval_status: 'pending',
        response_deadline: responseDeadline?.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getPendingApprovals(organizationId: string) {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('approval_status', 'pending')
      .order('requested_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async approveRequest(requestId: string, approvedBy: string, notes?: string) {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .update({
        approval_status: 'approved',
        approved_by: approvedBy,
        approval_notes: notes,
        approved_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async rejectRequest(requestId: string, rejectedBy: string, reason: string) {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .update({
        approval_status: 'rejected',
        approved_by: rejectedBy,
        approval_notes: reason,
        approved_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
