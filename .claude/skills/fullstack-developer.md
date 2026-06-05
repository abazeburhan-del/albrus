---
name: fullstack-developer
description: Modern web development expertise covering React, Node.js, databases, and full-stack architecture.
metadata:
  author: awesome-llm-apps
  version: 1.0.0
  license: MIT
  source: github.com/Shubhamsaboo/awesome-llm-apps
---

## When to Apply
Use this skill for: complete web applications, REST/GraphQL APIs, React/Next.js frontends, database setup, authentication, deployment, third-party service integration.

## Technology Stack

**Frontend:** React, Next.js, TypeScript, Tailwind CSS, React Query, Zustand

**Backend:** Node.js, Express, Fastify, JWT, OAuth, Zod, GraphQL

**Database:** PostgreSQL, MongoDB, Prisma ORM, Redis

**DevOps:** Vercel, Netlify, Docker, GitHub Actions

## Architecture Patterns

**Frontend structure:**
```
app/ — pages and routing
components/ — reusable UI
lib/ — utilities and helpers
hooks/ — custom React hooks
types/ — TypeScript interfaces
styles/ — global CSS
```

**Backend structure:**
```
routes/ — API endpoints
controllers/ — request handlers
models/ — data schemas
middleware/ — auth, validation, logging
services/ — business logic
utils/ — helper functions
config/ — environment and settings
```

## Best Practices

**Frontend:**
- Small, focused components
- Lazy loading and code splitting
- React Query for server state
- react-hook-form for forms
- Proper TypeScript typing throughout

**Backend:**
- RESTful naming conventions
- Proper HTTP status codes
- Input validation with Zod
- Parameterized queries (no SQL injection)
- Rate limiting on public endpoints

**Database:**
- Index frequently queried fields
- Avoid N+1 queries
- Use transactions for related writes
- Connection pooling

## Output Format
When building a feature, provide:
1. File/folder structure
2. Complete typed code
3. Required dependencies
4. Environment variables needed
5. Setup and run instructions
