import { SupabaseClient } from '@supabase/supabase-js';

export class BusinessMemorySystem {
  constructor(private supabase: SupabaseClient) {}

  async recordMemory(
    organizationId: string,
    memoryType: string,
    title: string,
    content: string,
    confidence: number,
    source: string
  ) {
    const { data, error } = await this.supabase
      .from('business_memory')
      .insert({
        organization_id: organizationId,
        memory_type: memoryType,
        title,
        content,
        confidence,
        source,
        created_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async queryMemory(organizationId: string, query: string, minConfidence: number = 0.7) {
    const { data, error } = await this.supabase
      .from('business_memory')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('confidence', minConfidence)
      .ilike('content', `%${query}%`)
      .order('confidence', { ascending: false });

    if (error) throw error;
    return data;
  }
}
