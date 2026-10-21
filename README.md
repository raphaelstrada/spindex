# Spindex

A personal vinyl record catalog with photo import, Gemini recognition, and Discogs matching.

## Discogs Cover Search

Cover search runs through a Supabase Edge Function so Discogs requests and optional credentials stay off the browser.

Deploy the function to your Supabase project:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy discogs-search
```

Discogs database search and image retrieval require authentication. In your [Discogs developer settings](https://www.discogs.com/settings/developers), rotate the Consumer Secret if it has been shared, then add `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` under **Project Settings > Edge Functions > Secrets** in the Supabase Dashboard. The Edge Function also accepts a personal token as `DISCOGS_TOKEN`. These credentials stay server-side and are never included in the frontend bundle. This read-only cover search uses Discogs' Consumer Key/Secret authentication; no OAuth redirect flow is needed.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Local CSV Migration

`migrate.js` reads the Discogs credentials from the Git-ignored `.env.local` file. Add these variables there before running the migration script:

```env
DISCOGS_CONSUMER_KEY=your_discogs_consumer_key
DISCOGS_CONSUMER_SECRET=your_discogs_consumer_secret
```

The script stops with a clear error if either value is missing. Do not commit these credentials. If the previous hard-coded values were pushed to GitHub, revoke/rotate them in Discogs before using the new local values.

## Photo Record Identification

Photo identification uses Gemini 3.8 Flash through a Supabase Edge Function. Resized images are sent to Google for identification. When a record is saved from a photo, its original source image is stored in the public Supabase Storage bucket `vinyl-originals` and linked from the record; multiple records detected in one photo share that image. The bucket limits uploads to 20 MB and supported image formats. The Gemini API key stays server-side and is never included in the frontend bundle.

Apply the database and Storage migration to the linked Supabase project before saving photo imports:

```sh
npx supabase db push
```

### GitHub Actions setup

In the repository, open **Settings > Secrets and variables > Actions** and add:

- Repository secret `GEMINI_API_KEY`: create the key in [Google AI Studio](https://aistudio.google.com/apikey).
- Repository secret `SUPABASE_ACCESS_TOKEN`: create a personal access token in the Supabase account settings.
- Optional repository variable `SUPABASE_PROJECT_REF`: override the project reference. If omitted, the workflow uses this app's Supabase project ref.

The existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build secrets remain unchanged. On a push to `main`, or a manual run from **Actions > Deploy to GitHub Pages > Run workflow**, the workflow copies `GEMINI_API_KEY` into Supabase Edge Function secrets and deploys `identify-records`.

### Marketplace Helper Downloads

The desktop helper is built for macOS and Windows and published automatically after a successful push to `main`:

- [Download for macOS (Apple Silicon — M1/M2/M3/M4)](https://github.com/raphaelstrada/spindex/releases/download/marketplace-helper-latest/MarketplaceHelper-macOS-AppleSilicon.zip)
- [Download for macOS (Intel)](https://github.com/raphaelstrada/spindex/releases/download/marketplace-helper-latest/MarketplaceHelper-macOS-Intel.zip)
- [Download for Windows](https://github.com/raphaelstrada/spindex/releases/download/marketplace-helper-latest/MarketplaceHelper-Windows.zip)

Download and extract the matching ZIP for your computer. On a Mac, choose **Apple Silicon** for M1/M2/M3/M4 chips (Apple menu > About This Mac shows "Chip") or **Intel** for older Macs (About This Mac shows "Processor: Intel"). Google Chrome or Microsoft Edge must be installed. These builds are unsigned, so continue only with a copy downloaded from the official project Releases. On macOS, Control-click the app, choose **Open**, then confirm **Open** again. On Windows SmartScreen, choose **More info > Run anyway**. The helper opens Facebook for a manual sign-in, saves the session only on that computer, starts the local bridge, and provides a copy-token button. No repository clone, Python commands, or Facebook API token are needed for normal use. GitHub access is required if this repository is private.

### Local Marketplace Helper Development

The source helper uses `~/.spindex/fb_auth.json` for the local Playwright session; cookies are never sent to the web app or Supabase. To run it from source, use a Python environment with Playwright installed, then run `python marketplace_login.py` followed by `python marketplace_bridge.py`. It accepts up to 10 listing URLs and returns up to 5 images from the configured main-image area per listing. Never commit or share the Facebook session file or temporary bridge token.

### Local Edge Function

For local Supabase development, create `supabase/functions/.env` with:

```env
GEMINI_API_KEY=your_google_ai_studio_key
```

This file is ignored by Git. Serve the function locally with:

```sh
npx supabase functions serve identify-records --env-file supabase/functions/.env
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Payments (Stripe Checkout)

The storefront bag holds record ids only. `create-checkout` reserves the records, computes every
price (`record_sale_price_cad`) and the shipping (`shipping_cad`) in the database, and returns a
Stripe Checkout URL. `stripe-webhook` marks the records sold and writes the order. Reserved records
are hidden from `public_catalog` until `reserved_until` passes (about 30 minutes) or the session
expires. Shipping is edited in Admin > Shipping. Tax is off: `COLLECT_TAX` in
`supabase/functions/create-checkout/index.ts`.

Secrets (Supabase only, never in `.env`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`.

### Test mode

1. Apply the migration `20261022000000_checkout_orders_shipping.sql` (`supabase db push`, or paste it into the SQL editor), then run `supabase/tests/rls_check.sql`.
2. In the Stripe Dashboard, switch to **Test mode** and copy the secret key (Developers > API keys).
3. Set the secrets. `SITE_URL` is the storefront root with no trailing slash:
   ```sh
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... SITE_URL=https://<github-user>.github.io/spindex
   ```
   For local testing, use `SITE_URL=http://localhost:5173/spindex`.
4. Deploy the functions: `supabase functions deploy create-checkout` and `supabase functions deploy stripe-webhook`. Both have `verify_jwt = false` in `supabase/config.toml`.
5. In the Stripe Dashboard (still in test mode), go to Developers > Webhooks > Add endpoint:
   - URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed` and `checkout.session.expired`
6. Copy the endpoint's signing secret and set it: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.
7. Pay with the card `4242 4242 4242 4242`, any future expiry date, any CVC and any Canadian address. The record becomes sold, leaves the storefront, and the order appears in Admin > Orders.
8. To test an abandoned checkout without waiting 30 minutes, run `stripe checkout sessions expire cs_test_...` with the Stripe CLI.

### Going live

1. Activate the Stripe account: business details, identity and payout bank account.
2. In **Live mode**, create the same webhook endpoint (same URL and the same two events). Live mode has its own signing secret.
3. Set the live secrets:
   ```sh
   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   Make sure `SITE_URL` points to the production storefront. The secrets take effect without redeploying.
4. Optional: enable customer email receipts under Settings > Customer emails.
5. Make one real low-value purchase, check the order in Admin > Orders, then refund it from the Stripe Dashboard. A refund does not relist the record: set `sold` back to false in the admin table.
6. Later, to collect GST/HST: register for the tax in Stripe Tax (Settings > Tax), set `COLLECT_TAX = true` and redeploy `create-checkout`. Prices are then treated as tax-included.

An order with status **Needs review** means a record was already sold or reserved by another session when the payment arrived. This should not happen because reservations outlive the Stripe session, but if it does, refund one of the two buyers.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
