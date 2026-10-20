# Spindex
Vinyl catalog app. React + Vite + TypeScript + Tailwind + shadcn/ui. Supabase (DB, Auth, Edge Functions). Hosted on GitHub Pages under base path `/spindex/` (static hosting: no server code besides Supabase).

## Two surfaces
- Public storefront: `/spindex/` (Polaroid-style product pages, bag, checkout). No login.
- Admin: `/spindex/admin` (the existing app: DataTable, Discogs sync, photo/barcode import, Facebook Marketplace). Login required.

## Owners
Two users only: Raphael and Tim. Each admin manages ONLY rows where `vinyl_records.collection_owner` equals their own owner. Owner comes from the `admins` table, never from the URL.

## Rules
- Security lives in Supabase RLS and Edge Function JWT checks, never only in the UI.
- Never trust prices/stock from the client; the server reads them from the DB.
- i18n: every string goes through `src/lib/i18n.ts` (en + pt).
- Keep changes minimal. Touch only files the task needs. No refactors outside the task.
- Secrets only in Supabase secrets / `.env` (never committed).
- Run `npm run build` before declaring a phase done.