'use client'

import { useState } from 'react'
import { Organization, Department, Agent } from '@/types/models'
import { Container } from '@/components/Container'
import { Button } from '@/components/Button'
import { DepartmentArea } from '@/components/headquarters/DepartmentArea'

interface HeadquartersInteriorProps {
  organization: Organization
  departments: Department[]
  agents: Agent[]
  onExit: () => void
}

export function HeadquartersInterior({
  organization,
  departments,
  agents,
  onExit,
}: HeadquartersInteriorProps) {
  const [_selectedDepartment, _setSelectedDepartment] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const getDepartmentAgents = (deptId: string | null) => {
    return agents.filter((agent) => agent.department_id === deptId)
  }

  if (selectedAgent) {
    const agent = agents.find((a) => a.id === selectedAgent)
    if (agent) {
      return (
        <div
          className="min-h-screen p-4"
          style={{
            background: `linear-gradient(135deg, ${organization.primary_color}20 0%, ${organization.secondary_color}20 100%)`,
          }}
        >
          <Container className="max-w-4xl">
            <Button
              variant="ghost"
              onClick={() => setSelectedAgent(null)}
              className="mb-6"
            >
              ← Back to Headquarters
            </Button>
            {/* Employee workstation will be rendered here */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
              <h1 className="text-3xl font-bold mb-4">{agent.name}</h1>
              <p className="text-slate-300 mb-2">Position: {agent.role}</p>
              <p className="text-slate-400 mb-4">Status: {agent.status}</p>
              <p className="text-slate-400">This is a placeholder for the employee workstation. Full implementation coming soon.</p>
            </div>
          </Container>
        </div>
      )
    }
  }

  return (
    <div className="min-h-screen p-4" style={{
      background: `linear-gradient(135deg, ${organization.primary_color}20 0%, ${organization.secondary_color}20 100%)`,
    }}>
      <Container className="max-w-7xl">
        {/* Header */}
        <div className="flex justify-between items-start mb-12 pt-6">
          <div>
            <h1 className="text-4xl font-bold mb-2">{organization.name}</h1>
            <p className="text-slate-400">AI Headquarters Interior</p>
          </div>
          <Button variant="ghost" onClick={onExit}>
            Exit
          </Button>
        </div>

        {/* Departments Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {departments.map((dept) => {
            const deptAgents = getDepartmentAgents(dept.id)
            return (
              <DepartmentArea
                key={dept.id}
                department={dept}
                agents={deptAgents}
                organizationColors={{
                  primary: organization.primary_color,
                  secondary: organization.secondary_color,
                  accent: organization.accent_color,
                }}
                onSelectAgent={setSelectedAgent}
              />
            )
          })}
        </div>

        {/* Info */}
        <div className="text-center text-slate-500 py-8">
          <p className="text-sm">👥 {agents.length} AI Employees · 🏢 {departments.length} Departments</p>
        </div>
      </Container>
    </div>
  )
}
