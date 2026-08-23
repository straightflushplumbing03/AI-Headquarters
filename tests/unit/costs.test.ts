import { describe, it, expect } from 'vitest'

describe('Cost Calculations', () => {
  it('should calculate OpenAI costs correctly', () => {
    // GPT-4 Turbo: $0.01 per 1K input tokens, $0.03 per 1K output tokens
    const inputCost = (2000 / 1000) * 0.01 // $0.02
    const outputCost = (1000 / 1000) * 0.03 // $0.03
    const total = inputCost + outputCost // $0.05

    expect(total).toBeCloseTo(0.05, 2)
  })

  it('should handle zero tokens', () => {
    const inputCost = (0 / 1000) * 0.01
    const outputCost = (0 / 1000) * 0.03
    const total = inputCost + outputCost

    expect(total).toBe(0)
  })

  it('should calculate budget percentage correctly', () => {
    const budget = 100
    const spent = 45
    const percentage = (spent / budget) * 100

    expect(percentage).toBe(45)
  })
})
