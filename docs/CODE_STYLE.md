# AI Headquarters - Code Style & Architecture

## TypeScript Conventions

### Types Location

```
types/
├── ai.ts           # AI-specific types
├── agent.ts        # Agent types
├── task.ts         # Task types
└── ...
```

### Export Pattern

```typescript
// Good: Named exports for types and classes
export interface AIExecutionRequest { ... }
export class AIProvider { ... }
export function getAIProvider() { ... }

// Avoid: Default exports for complex types
```

### Error Handling

```typescript
// Try-catch with specific error messages
try {
  // operation
} catch (error: any) {
  return {
    success: false,
    error: error.message,
  }
}
```

## AI Architecture Patterns

### Provider Abstraction

```typescript
abstract class AIProvider {
  abstract execute(request): Promise<result>
  abstract estimateCost(input, output): number
}

// Implementations
class OpenAIProvider extends AIProvider { ... }
class PendingProvider extends AIProvider { ... }
```

### Pipeline Pattern

```typescript
class AIExecutionPipeline {
  async execute(request) {
    // 1. Authenticate
    // 2. Authorize
    // ...
    // 15. Return result
  }
}
```

### Manager Pattern

```typescript
class AICostManager {
  async initializeBudget(...) { ... }
  async recordCost(...) { ... }
  async getSpending(...) { ... }
}
```

## Database Queries

### Pattern: Select with Filter & Order

```typescript
const { data, error } = await supabase
  .from('table')
  .select('columns or *')
  .eq('column', value)           // equality
  .gte('date', startDate)        // greater than or equal
  .lte('date', endDate)          // less than or equal
  .order('column', { ascending: false })
  .limit(count)
  .single() // optional: return single row

if (error) throw error
return data
```

### Pattern: Insert with Return

```typescript
const { data, error } = await supabase
  .from('table')
  .insert([{ ... }])
  .select()        // get inserted rows back
  .single()        // optional: return single

if (error) throw error
return data
```

### Pattern: Update with Verification

```typescript
const { error } = await supabase
  .from('table')
  .update({ column: value })
  .eq('id', id)

if (error) throw error
```

## Testing Structure

### Unit Tests

```typescript
describe('Feature', () => {
  describe('Specific Function', () => {
    it('should do something', () => {
      // arrange
      const input = ...
      
      // act
      const result = functionUnderTest(input)
      
      // assert
      expect(result).toBe(expected)
    })
  })
})
```

### Mock Supabase

```typescript
vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({  
    from: () => ({
      select: () => ({ data, error }),
      insert: () => ({ data, error }),
      update: () => ({ error }),
    })
  })
}))
```

## Naming Conventions

### Classes
- PascalCase
- Descriptive: `AIExecutionPipeline`, not `Pipeline`
- Suffixes: `Manager`, `Provider`, `Agent`, `Tracker`, `Generator`

### Functions
- camelCase
- Verb prefix: `execute`, `load`, `create`, `update`, `delete`
- Private prefix: `private loadContext()`

### Variables
- camelCase
- Descriptive: `organizationId`, not `org_id` in TypeScript
- Database columns: snake_case (in SQL)

### Constants
- UPPER_SNAKE_CASE

## Performance Considerations

### Database Queries
- ✅ Add `.limit()` to prevent loading all rows
- ✅ Select only needed columns
- ✅ Add indexes on frequently filtered columns
- ✅ Use `.single()` when expecting one row

### API Calls
- ✅ Cache provider configuration
- ✅ Batch operations when possible
- ✅ Implement request timeout
- ✅ Handle rate limiting

### Memory
- ✅ Stream large responses
- ✅ Clean up subscriptions
- ✅ Avoid storing large objects in state

## Documentation

### Inline Comments

```typescript
// Explain WHY, not WHAT
// BAD:
const x = 10 // set x to 10

// GOOD:
const MAX_RETRIES = 10 // allow 10 attempts before failing
```

### Function Documentation

```typescript
/**
 * Calculate estimated AI cost for token usage
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @returns Estimated cost in USD
 */
function estimateCost(inputTokens: number, outputTokens: number): number {
  ...
}
```
