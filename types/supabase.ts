export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          website: string | null
          industry: string | null
          description: string | null
          logo_url: string | null
          primary_color: string
          secondary_color: string
          accent_color: string
          onboarding_completed: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          website?: string | null
          industry?: string | null
          description?: string | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          accent_color?: string
          onboarding_completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          website?: string | null
          industry?: string | null
          description?: string | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          accent_color?: string
          onboarding_completed?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: 'owner' | 'admin' | 'member' | 'viewer'
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role: 'owner' | 'admin' | 'member' | 'viewer'
          created_at?: string
        }
        Update: {
          role?: 'owner' | 'admin' | 'member' | 'viewer'
        }
      }
      departments: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          color: string
          icon: string | null
          position_x: number | null
          position_y: number | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          color: string
          icon?: string | null
          position_x?: number | null
          position_y?: number | null
          created_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          color?: string
          icon?: string | null
          position_x?: number | null
          position_y?: number | null
        }
      }
      agents: {
        Row: {
          id: string
          organization_id: string
          department_id: string
          name: string
          role: string
          description: string | null
          avatar_url: string | null
          capabilities: string[] | null
          status: 'available' | 'working' | 'waiting' | 'offline'
          active: boolean
          system_instructions: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          department_id: string
          name: string
          role: string
          description?: string | null
          avatar_url?: string | null
          capabilities?: string[] | null
          status?: 'available' | 'working' | 'waiting' | 'offline'
          active?: boolean
          system_instructions?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          role?: string
          description?: string | null
          avatar_url?: string | null
          capabilities?: string[] | null
          status?: 'available' | 'working' | 'waiting' | 'offline'
          active?: boolean
          system_instructions?: string | null
          updated_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          parent_task_id: string | null
          title: string
          description: string | null
          priority: 'low' | 'medium' | 'high' | 'critical'
          status: 'queued' | 'working' | 'completed' | 'failed' | 'waiting_approval' | 'cancelled' | 'paused'
          input: Record<string, any> | null
          result: string | null
          error: string | null
          approval_state: 'pending' | 'approved' | 'rejected'
          created_at: string
          started_at: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          parent_task_id?: string | null
          title: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'critical'
          status?: 'queued' | 'working' | 'completed' | 'failed' | 'waiting_approval' | 'cancelled' | 'paused'
          input?: Record<string, any> | null
          result?: string | null
          error?: string | null
          approval_state?: 'pending' | 'approved' | 'rejected'
          created_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Update: {
          title?: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'critical'
          status?: 'queued' | 'working' | 'completed' | 'failed' | 'waiting_approval' | 'cancelled' | 'paused'
          result?: string | null
          error?: string | null
          approval_state?: 'pending' | 'approved' | 'rejected'
          started_at?: string | null
          completed_at?: string | null
        }
      }
      activity_events: {
        Row: {
          id: string
          organization_id: string
          user_id: string | null
          agent_id: string | null
          task_id: string | null
          event_type: string
          title: string
          description: string | null
          metadata: Record<string, any> | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id?: string | null
          agent_id?: string | null
          task_id?: string | null
          event_type: string
          title: string
          description?: string | null
          metadata?: Record<string, any> | null
          created_at?: string
        }
        Update: {}
      }
      company_memory: {
        Row: {
          id: string
          organization_id: string
          category: string
          title: string
          content: string
          metadata: Record<string, any> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          category: string
          title: string
          content: string
          metadata?: Record<string, any> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          category?: string
          title?: string
          content?: string
          metadata?: Record<string, any> | null
          updated_at?: string
        }
      }
    }
  }
}
