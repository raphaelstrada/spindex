# Spindex: admin + storefront (prompts para o Claude Code)

## Como usar sem gastar tokens
1. Cole o bloco **CLAUDE.md** na raiz do projeto (arquivo `CLAUDE.md`). O Claude lê isso toda sessão, então você não repete contexto.
2. Rode **uma fase por vez**. Ao terminar uma, faça commit e use `/clear` antes da próxima.
3. Em cada fase, comece em **plan mode** (Shift+Tab): ele propõe o plano, você aprova, só então ele edita.
4. Use Sonnet. Reserve Opus só para a Fase 2 (auth/RLS) se quiser revisão extra.
5. Não cole código nem screenshots repetidos. Mande **uma** screenshot da Polaroid (Fase 3) e diga o caminho do arquivo.

---

## CLAUDE.md (colar na raiz)

```md
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
```

---

## Fase 1: Rotas e separação (sem mudar comportamento)

```
Plan first, then implement.

Goal: split the app into two routes without changing the admin's behavior.
- Add react-router-dom. Vite `base: '/spindex/'`, BrowserRouter `basename="/spindex"`.
- GitHub Pages is static, so add the SPA fallback: `public/404.html` that redirects deep links to index.html (the spa-github-pages approach), plus the restore script in index.html.
- `/spindex/admin` renders exactly today's App (header, DataTable, add-record dialogs). Move it to `src/pages/AdminPage.tsx`; do not change its internals.
- `/spindex/` renders a placeholder `StorefrontPage` ("Coming soon").
- Remove the `#/tim` URL hack from `src/lib/collection.ts` (owner will come from auth in phase 2). For now keep it working with a temporary fallback so nothing breaks.

Acceptance: `npm run build` passes; refreshing on /spindex/admin works in `vite preview` with base path; admin looks and works the same.
```

---

## Fase 2: Login e permissão por owner (a parte crítica de segurança)

```
Plan first, then implement.

Goal: put /spindex/admin behind Supabase Auth (email + password). Two users: Raphael and Tim.

Database (write a SQL migration file in supabase/migrations/, do not run anything destructive):
1. Table `admins(user_id uuid primary key references auth.users, collection_owner text not null check (collection_owner in ('Raphael','Tim')))`.
2. Enable RLS on `vinyl_records` and `admins`.
3. Policies on `vinyl_records` for authenticated users: select/insert/update/delete only where `collection_owner = (select collection_owner from admins where user_id = auth.uid())`. On insert, force collection_owner to the admin's owner (WITH CHECK).
4. Pricing (single source of truth, used by BOTH the public view and checkout):
   - Table `app_settings(key text primary key, value text)` with a row `usd_to_cad` (e.g. '1.38', editable by admins only via RLS; public cannot read it).
   - SQL function `record_sale_price_cad(r vinyl_records) returns numeric`: convert `marketplace_price` (using `marketplace_currency`, CAD or USD; treat null/empty as CAD) and `price_on_discogs` (the owner's own listing price on Discogs; treat as USD) to CAD, take the GREATEST of the non-null values, round UP to the next whole dollar. Returns null when both are null. NEVER use `discogs_lowest_price` in any price calculation: it is informational only (admin screens).
5. Hero fields: add to `vinyl_records` `is_hero boolean not null default false` and `hero_tagline text null`.
6. Public read: create a view `public_catalog` (security_invoker off) exposing ONLY safe columns for rows where `sold = false`, `sell_possibility = true` and `record_sale_price_cad(...) is not null`: id, collection_owner, artist, title, year_pressed, genre, sub_genre, record_label, record_type, record_size, country_pressed, media_condition, sleeve_condition, is_original, is_special_edition, special_edition_reason, image_url, original_image_url, discogs_link, is_hero, hero_tagline, and `sale_price_cad` (computed). Never expose notes, source_url, discogs_synced_at, discogs_lowest_price, price_on_discogs, marketplace_price or the raw currencies. Grant select on the view to anon.
7. Leave a commented INSERT template for the two admins rows (I will fill in the user ids after creating the users in the Supabase dashboard).

Frontend:
- `/spindex/admin/login` page; `AuthProvider` with session + admin lookup; a `RequireAdmin` guard that redirects to login if there is no session or no admins row. Logout button in the admin header.
- Replace `getCollectionOwner()` so the owner comes from the admins row. DataTable fetch and RecordForm insert use it. Remove the URL-based owner logic.

Edge Functions (discogs-search, discogs-sync, photo identification):
- Require a valid user JWT (reject the anon key) and a matching admins row; return 401/403 otherwise. The photo identification function calls a paid API (Gemini), so this is mandatory. Keep CORS as is.
- discogs-sync must only touch records whose collection_owner matches the caller.

Acceptance: logged out, /spindex/admin redirects to login; Raphael cannot read or edit Tim's rows (verify with a SQL/RLS test or a short script); anon can only read `public_catalog`; the functions return 401 without a user session.
```

---

## Fase 3: Vitrine pública (layout da Polaroid)

Antes de rodar: salve **uma screenshot** da página da Polaroid em `docs/reference/polaroid.png` (o visual não consegui extrair, só a estrutura). Se não tiver, rode mesmo assim e ajuste depois.

```
Plan first, then implement.

Goal: public storefront at /spindex/, reading ONLY from the `public_catalog` view (anon key). Layout/structure copied from https://www.polaroid.com/en_ca/products/color-sx70-instant-film. Visual reference screenshot: docs/reference/polaroid.png (match its colors, typography, spacing, and button styles as closely as you can; theme color is near-black #151515).

Routes:
- `/spindex/` : header + announcement bar + HERO CAROUSEL (only if at least one record has `is_hero = true`; otherwise skip it) + catalog grid (cover, artist, title, price in CAD) with filters (artist search, genre, year, condition, collection owner). Click goes to the product page.
- Hero carousel: standard e-commerce hero. Full-width slides, record cover on one side, artist/title, `hero_tagline`, price and a "Shop now" button to the product page on the other. Slide order is shuffled randomly on every page load; autoplay every ~6s, paused on hover/focus and when `prefers-reduced-motion` is set; prev/next arrows, dots, swipe on mobile, keyboard accessible. A single hero shows no arrows or dots.
- Prices: always display `sale_price_cad` formatted as CAD (e.g. "$42 CAD"). Never compute prices in the browser.
- `/spindex/record/:id` : product page.

Global layout:
- Announcement bar on top (short messages, e.g. shipping notes).
- Header: logo in the center, bag icon with item count on the right, language switch (en/pt) on the left. No account/login link in the public header.
- Footer: link columns, payment icons, copyright.

Product page (two columns on desktop, stacked on mobile):
- LEFT: cover gallery (cover image; if original_image_url exists, show it as a second thumbnail).
- RIGHT, in this order: breadcrumb above; title "Artist: Album"; price; 4 bullet points (label, year and country pressed, genre/style, format); condition badges (media / sleeve); primary "Add to bag" button.
- Each record is one-of-a-kind (stock 1): no quantity selector, no variants. After adding, the button becomes "In your bag" (disabled) with a "View bag" link.
- Accordions below the buy box: Details, Condition and grading, Shipping and returns, View on Discogs (links to discogs_link).
- Below: carousel "More from this artist" and "You might also like" (same genre).
- Skip reviews, wishlist, newsletter and the region modal (not needed for now).

Use shadcn/ui components already in the project. All text through i18n (en + pt). Responsive and keyboard accessible. Loading and empty states for the grid.

Acceptance: build passes; grid and product page work on mobile and desktop; no field outside `public_catalog` is requested from the browser.
```

---

## Fase 3b: Hero no admin (pode rodar logo depois da Fase 3)

```
Plan first, then implement. Touch only RecordForm, DataTable and i18n.

Goal: let the logged-in admin mark records as hero for the storefront carousel.
- RecordForm: add a "Feature on storefront hero" checkbox (`is_hero`) and a short optional "Hero tagline" text input (`hero_tagline`, max 90 chars, shown only when the checkbox is on). Add both to the zod schema and the save payload.
- DataTable: add a small hero indicator (star icon) on rows with `is_hero`, plus a quick toggle in the row actions menu so it can be switched without opening the form.
- Warn (inline, non-blocking) when marking as hero a record that will not appear in the store (sold, or `sell_possibility` off, or no price), because the public view hides it.
- i18n en + pt. RLS already restricts rows to the admin's owner; do not add client-side owner logic.

Acceptance: toggling hero as Raphael changes only Raphael's rows; the storefront carousel shows the record after reload; build passes.
```

---

## Fase 4: Sacola e pagamento (Stripe Checkout)

O GitHub Pages é estático, então o pagamento precisa passar por Edge Functions. As decisões de preço, frete e imposto já estão resolvidas no fim deste arquivo.

```
Plan first, then implement.

Goal: bag + checkout using Stripe Checkout (hosted page). Payment must never be computed in the browser.

Bag (frontend):
- BagContext persisted in localStorage (array of record ids only, no prices). Mini-bag drawer opened from the header icon and after "Add to bag" (shows items, subtotal fetched from public_catalog, remove button, "Checkout" button).
- On open, drop ids that are no longer in public_catalog (sold/reserved) and tell the user.

Backend:
- Migration: add to vinyl_records `reserved_until timestamptz null` and `stripe_session_id text null`; create table `orders(id uuid pk default gen_random_uuid(), stripe_session_id text unique, email text, shipping jsonb, total_cents int, currency text, record_ids uuid[], status text, created_at timestamptz default now())` with RLS on, no public access (admins read their own owner's orders). Update `public_catalog` to hide rows where `reserved_until > now()`.
- Edge Function `create-checkout` (public, verify_jwt off): input = array of record ids. Server loads the rows (service role), rejects any that are sold/reserved/not for sale, computes each price with the SQL function `record_sale_price_cad` (currency CAD), sets `reserved_until = now() + 30 min`, creates a Stripe Checkout Session (one line item per record, quantity 1, `shipping_address_collection.allowed_countries = ['CA']`, expires_at = 30 min) and returns its URL. Frontend redirects to it.
- Shipping (Canada only), editable: table `shipping_settings(id int primary key default 1, base_cad numeric default 20, included_items int default 3, additional_item_cad numeric default 5, free_over_cad numeric default 150)` (admins edit, public cannot read). Rule: `base_cad` covers up to `included_items` records; each record beyond that adds `additional_item_cad` (1-3 records = $20, 4 = $25, 5 = $30...). Shipping is $0 when the subtotal is strictly above `free_over_cad`. `create-checkout` computes it server-side and sends a single `shipping_options` entry with `shipping_rate_data` (fixed_amount, CAD, label "Canada Post, tracked"; "Free shipping" when 0). Put this calculation in one shared function and show the same estimate in the bag drawer ("Shipping: $X" or "Free shipping"), plus a hint like "Add $Y more for free shipping".
- Tax: do NOT collect tax for now (prices are shown as final). Put the Stripe Tax switch behind a single constant `COLLECT_TAX = false` so it can be enabled later without rewrites.
- Edge Function `stripe-webhook` (verify signature with STRIPE_WEBHOOK_SECRET): on `checkout.session.completed` mark the records `sold = true`, clear reservation, insert the order. On `checkout.session.expired` clear the reservations.
- Success page `/spindex/order/success` (clears the bag) and cancel returns to the bag.
- Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in Supabase secrets only.
- Use Stripe TEST mode first; document the exact steps to go live.

Acceptance: with test card 4242 4242 4242 4242 the record becomes sold and disappears from the storefront; two browsers cannot buy the same record; abandoned checkout releases the reservation after 30 minutes; no price is ever read from the client.
```

---

## Fase 5: Deploy e verificação

```
Plan first, then implement.
- GitHub Actions workflow deploying `dist` to GitHub Pages (base /spindex/), env vars VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from repo secrets.
- Checklist file `docs/go-live.md`: Supabase redirect URLs, Stripe webhook URL, switching Stripe to live, DNS (if any), and a manual test script of the buy flow.
- Run a final review of RLS policies and Edge Function auth for gaps and report them (do not auto-fix silently).
```

---

## Decisões já tomadas (já refletidas nos prompts acima)
1. **Preço:** o maior entre `marketplace_price` e `price_on_discogs`, tudo convertido para CAD e arredondado para cima para dólar inteiro. O `discogs_lowest_price` é só informativo e nunca entra no preço. Disco sem nenhum dos dois não aparece na loja.
2. **Na loja:** só discos com `sell_possibility = true` e `sold = false`.
3. **Pagamento:** uma única conta Stripe por enquanto.
4. **Frete:** só Canadá, editável: **$20 CAD até 3 discos, +$5 CAD por disco a partir do 4º, grátis acima de $150 CAD** no subtotal. Imposto: não cobrado por enquanto.
5. **Home:** grade de discos, com hero em carrossel (ordem aleatória) para os discos marcados como hero no admin.

## Pontos que ainda precisam de você
- **Valores do frete:** $20 / 3 discos / +$5 / grátis acima de $150 são os seus números, e ficam em `shipping_settings`, editável sem mexer em código. Vale testar no calculador da Canada Post com um pacote real para ver se cobre o custo de enviar para as províncias mais distantes.
- **Câmbio:** o preço do Discogs é guardado em USD, então o app precisa de uma taxa USD→CAD. Ela fica em `app_settings.usd_to_cad`, atualizada à mão. Se quiser, na Fase 4 peça uma função que atualize isso uma vez por dia.
- **Moeda do `price_on_discogs`:** assumi USD (o padrão do Discogs). Se o seu preço lá é guardado em outra moeda, corrija essa linha na Fase 2 antes de rodar.
- **Imposto:** vender sem cobrar GST/HST pode ser correto enquanto você estiver abaixo do limite de pequeno fornecedor (CAD 30.000 em vendas), mas confirme com um contador, porque passando disso o registro é obrigatório.
