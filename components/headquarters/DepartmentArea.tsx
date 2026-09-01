'use client'

import { Department, Agent } from '@/types/models'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'

interface DepartmentAreaProps {
  department: Department
  agents: Agent[]
  organizationColors: {
    primary: string
    secondary: string
    accent: string
  }
  onSelectAgent: (agentId: string) => void
}

export function DepartmentArea({
  department,
  agents,
  organizationColors,
  onSelectAgent,
}: DepartmentAreaProps) {
  return (
    <div
      className="rounded-xl border-2 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer"
      style={{
        borderColor: department.color,
        backgroundColor: `${department.color}05`,
      }}
    >
      {/* Department Header */}
      <div
        className="p-4 text-white font-bold text-lg"
        style={{ backgroundColor: department.color }}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl">{department.icon}</span>
          <span>{department.name}</span>
        </div>
      </div>

      {/* Department Content */}
      <div className="p-6">
        {department.description && (
          <p className="text-slate-400 text-sm mb-4">{department.description}</p>
        )}

        {/* Employees */}
        <div className="space-y-3">
          {agents.length > 0 ? (
            agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors cursor-pointer group"
                onClick={() => onSelectAgent(agent.id)}
              >
                {/* Avatar */}
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                    style={{ backgroundColor: department.color }}
                  >
                    {agent.avatar_url ? (
                      <img
                        src={agent.avatar_url}
                        alt={agent.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      '👤'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-100 truncate">{agent.name}</p>
                    <p className="text-sm text-slate-400 truncate">{agent.role}</p>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor:
                        agent.status === 'available'
                          ? '#10b981'
                          : agent.status === 'working'
                          ? '#f59e0b'
                          : agent.status === 'waiting'
                          ? '#06b6d4'
                          : '#6b7280',
                    }}
                  />
                  <span className="text-xs text-slate-400 capitalize">{agent.status}</span>
                </div>

                {/* Description */}
                {agent.description && (
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 group-hover:text-slate-400">
                    {agent.description}
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-6">
              <p className="text-slate-500 text-sm mb-4">No employees assigned yet</p>
              <Button variant="ghost" size="sm" disabled>
                Hire AI Employee
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
