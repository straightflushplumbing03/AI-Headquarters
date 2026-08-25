# AI-HEADQUARTERS DEPLOYMENT GUIDE

## Quick Start Deployment (5 Steps)

### Step 1: Database Setup
```bash
# Apply all migrations in order
supabase migration up

# Verify migrations
supabase status
```

### Step 2: Environment Configuration
```bash
cp .env.example .env.local

# Configure these variables:
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Step 3: Service Deployment
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify all services
npm run verify
```

### Step 4: Initialize Organization
```bash
# Create test organization
node scripts/init-org.js

# Run test suite
npm run test
```

### Step 5: Verify Full Platform
```bash
# Check all systems operational
npm run health-check

# View operational dashboard
npm run start
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│        EXECUTIVE COMMAND CENTER                         │
│  (5-min briefings, dashboards, alerts)                  │
└────────────────────┬────────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼──────┐  ┌────▼──────┐  ┌────▼──────┐
│ Phase 6   │  │ Phase 7   │  │ Phase 5   │
│ Autonomous│  │ Learning  │  │ Predictive│
│ Decisions │  │ & Optimize│  │ Intel     │
│ & Actions │  │ & Memory  │  │           │
└────┬──────┘  └────┬──────┘  └────┬──────┘
     │              │              │
     └──────────────┬──────────────┘
                    │
        ┌───────────▼───────────┐
        │  Phase 1-4: Core      │
        │  Analytics &          │
        │  Business Intel       │
        └───────────┬───────────┘
                    │
        ┌───────────▼───────────┐
        │  SUPABASE DATABASE    │
        │  (34 tables, RLS)     │
        └───────────────────────┘
```

---

## Operational Workflows

### Full Cycle: Analyze → Predict → Decide → Act → Learn

```
1. ANALYZE (Phase 1-4)
   └─ Ingest events
   └─ Calculate metrics
   └─ Update KPIs
   └─ Generate insights

2. PREDICT (Phase 5)
   └─ Forecast leads (7/30 days)
   └─ Project revenue
   └─ Identify opportunities
   └─ Calculate business health

3. DECIDE (Phase 6)
   └─ Evaluate signals
   └─ Calculate confidence
   └─ Assess risk
   └─ Determine approval needs

4. ACT (Phase 6)
   └─ Execute autonomous actions
   └─ Process approvals
   └─ Queue workflows
   └─ Track execution

5. LEARN (Phase 7)
   └─ Measure outcomes
   └─ Calculate accuracy
   └─ Extract patterns
   └─ Generate recommendations
   └─ Improve future predictions
```

---

## Monitoring & Metrics

### Key Performance Indicators
- Prediction accuracy (target: >75%)
- Decision success rate (target: >80%)
- Agent performance (target: >85% success)
- System health (target: >90%)
- Approval time (target: <2 hours)

### Health Checks
```bash
# Real-time system health
GET /api/health

# Prediction accuracy report
GET /api/accuracy

# Agent performance dashboard
GET /api/agents/performance

# Executive briefing
GET /api/briefing
```

---

## Security Checklist

✅ All tables have RLS policies
✅ Organization isolation enforced
✅ Audit logging active on all tables
✅ Service role key restricted
✅ Emergency stop tested
✅ Approval workflows functional
✅ Rate limiting configured
✅ Backup procedures in place
✅ Disaster recovery tested
✅ Compliance logging enabled

---

## Support & Troubleshooting

### Common Issues

**Issue**: Predictions not being created
**Solution**: Verify business_kpis table has data, check data quality score

**Issue**: Actions not executing
**Solution**: Check action_queue, verify authorization level, check approval status

**Issue**: RLS preventing data access
**Solution**: Verify organization_id in where clause, check user organization membership

**Issue**: Test suite failing
**Solution**: Run migrations again, verify test org exists, check database connectivity

### Debug Mode
```bash
# Enable verbose logging
export DEBUG=ai-headquarters:*
npm run start

# Check database logs
supabase logs tail

# Verify RLS policies
select tablename, policyname from pg_policies;
```

---

## Next Steps

1. **Day 1**: Deploy to staging, run full test suite
2. **Day 2**: Deploy to production, monitor metrics
3. **Day 3-7**: Collect data, run learning loops
4. **Week 2**: Review predictions vs outcomes, adjust models
5. **Week 3**: Scale to full organization usage
6. **Month 2**: Implement Phase 8 enhancements

---

## Support

For issues or questions:
- Check IMPLEMENTATION_REPORT.md for detailed documentation
- Review tests/ directory for examples
- Check lib/ directory for service implementations
- Contact: straightflushplumbing03@gmail.com
