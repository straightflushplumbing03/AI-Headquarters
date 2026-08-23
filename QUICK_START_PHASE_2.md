# AI Headquarters - Quick Start Guide

## Phase 2 Setup (5 minutes)

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local with your values
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
OPENAI_API_KEY=sk_your_openai_key
```

### 2. Database Setup

```bash
# Push migrations to Supabase
npm run db:push
```

### 3. Supabase Storage

1. Go to Supabase dashboard
2. Storage → Create bucket
3. Name: `logos`
4. Visibility: Public

### 4. Start Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## First Steps

1. Sign up → Complete onboarding → Upload logo → Set goals → Hire AI CEO → Create task → View results

---

**Full guide**: `docs/PHASE_2_IMPLEMENTATION.md`
