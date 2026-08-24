import { SupabaseClient } from '@supabase/supabase-js'
import type { AgentRegistry, AgentCapability } from '@/types/phase3'

/**
 * Agent Registry & Management
 * Central registry for all AI agents in the organization
 */
export class AgentRegistry {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Register a new AI agent
   */
  async registerAgent(
    organizationId: string,
    agent: Omit<AgentRegistry, 'id' | 'created_at' | 'updated_at'>
  ): Promise<AgentRegistry> {
    const { data, error } = await this.supabase
      .from('agent_registry')
      .insert([{ ...agent, organization_id: organizationId }])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get all agents for organization
   */
  async getAgents(
    organizationId: string,
    status?: 'active' | 'inactive' | 'archived'
  ): Promise<AgentRegistry[]> {
    let query = this.supabase
      .from('agent_registry')
      .select('*')
      .eq('organization_id', organizationId)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<AgentRegistry> {
    const { data, error } = await this.supabase
      .from('agent_registry')
      .select('*')
      .eq('id', agentId)
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(
    organizationId: string,
    type: string
  ): Promise<AgentRegistry[]> {
    const { data, error } = await this.supabase
      .from('agent_registry')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('type', type)
      .eq('status', 'active')

    if (error) throw error
    return data || []
  }

  /**
   * Update agent
   */
  async updateAgent(
    agentId: string,
    updates: Partial<Omit<AgentRegistry, 'id' | 'organization_id' | 'created_at'>>
  ): Promise<AgentRegistry> {
    const { data, error } = await this.supabase
      .from('agent_registry')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', agentId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Grant capability to agent
   */
  async grantCapability(
    organizationId: string,
    agentId: string,
    capability: Omit<AgentCapability, 'id' | 'organization_id' | 'agent_id' | 'created_at'>
  ): Promise<AgentCapability> {
    const { data, error } = await this.supabase
      .from('agent_capabilities')
      .insert([
        {
          ...capability,
          organization_id: organizationId,
          agent_id: agentId,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Check if agent has capability
   */
  async hasCapability(
    agentId: string,
    resourceType: string,
    capabilityType: 'read' | 'write' | 'execute' | 'approve' | 'delegate'
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from('agent_capabilities')
      .select('id')
      .eq('agent_id', agentId)
      .eq('resource_type', resourceType)
      .eq('capability_type', capabilityType)
      .single()

    return !!data
  }

  /**
   * Get all capabilities for agent
   */
  async getCapabilities(agentId: string): Promise<AgentCapability[]> {
    const { data, error } = await this.supabase
      .from('agent_capabilities')
      .select('*')
      .eq('agent_id', agentId)

    if (error) throw error
    return data || []
  }

  /**
   * Update agent performance metrics
   */
  async updatePerformanceMetrics(
    agentId: string,
    metrics: Record<string, any>
  ): Promise<void> {
    await this.supabase
      .from('agent_registry')
      .update({
        performance_metrics: metrics,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
  }
}
