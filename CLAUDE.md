# Master Ji Fashion House app

Before doing anything in this repo, read:

1. `.ai/PROJECT_OVERVIEW.md` -- what the app is, every screen and flow, architecture, data model, receipt format, roadmap.
2. `.ai/APP_RULES.md` -- the rules for changing it (owner's guiding principle, language, UX, money rules, security, testing, git workflow).
3. `.ai/DECISIONS.md` -- every owner decision and why (tax/GST rules, money rules, UI choices). Don't change anything listed there without asking the owner, and add new decisions to it.

Quick facts:
- Next.js 14 + React 18 + Tailwind + better-sqlite3, plain JavaScript, Node 22. Deployed on Railway from `main`.
- `npm run dev` (dev DB), `npm test` (must pass before committing).
- Work on a feature branch; merge to `main` only when the owner confirms a final build.
- Never touch the production database or type credentials anywhere.
