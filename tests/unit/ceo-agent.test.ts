import { describe, it, expect } from 'vitest'
import { AICEOAgent } from '@/lib/ai/agents/ceo-agent'

describe('AI CEO Agent', () => {
  const agent = new AICEOAgent('test-agent-id', 'test-org-id')

  it('should build system prompt', () => {
    expect(agent.systemPrompt).toContain('AI CEO')
    expect(agent.systemPrompt).toContain('company goals')
    expect(agent.systemPrompt).toContain('constraints')
  })

  it('should extract tasks from response', () => {
    const response = `
TASK:
Title: Test Task
Agent: SEO Specialist
Priority: high
Description: Do something

TASK:
Title: Another Task
Agent: Content Writer
Priority: medium
Description: Create content
`

    const tasks = agent.extractTasksFromResponse(response)
    expect(tasks.length).toBe(2)
    expect(tasks[0].title).toContain('Test Task')
    expect(tasks[1].title).toContain('Another Task')
  })

  it('should detect approval requirements', () => {
    const requiresApproval = agent.requiresApproval('APPROVAL_REQUIRED for this action')
    expect(requiresApproval).toBe(true)

    const noApproval = agent.requiresApproval('Task completed successfully')
    expect(noApproval).toBe(false)
  })
})
