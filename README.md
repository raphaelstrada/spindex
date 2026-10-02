# React + TypeScript + Vite

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

### Facebook Marketplace bridge

Marketplace reading runs locally so Facebook session cookies never leave this computer. There is no Facebook API token: each person signs in manually in a local Chromium window, and the helper saves that person's Playwright session to `~/.vinyl-catalog/fb_auth.json`. The bridge visits only Marketplace item URLs, reads listing text from the main panel, and extracts photos only from the configured main-image XPath.

Clone or download this repository, open a terminal in its folder, and create a local Python environment.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install playwright
python -m playwright install chromium
python marketplace_login.py
```

The login helper opens Chromium. Sign in to your own Facebook account there, finish any checks, then return to the terminal and press Enter. The session file is stored outside the repository and is never sent to the app.

For Windows PowerShell, use these environment setup commands instead:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install playwright
python -m playwright install chromium
python marketplace_login.py
```

Then start the bridge in the same activated environment:

```sh
python marketplace_bridge.py
```

Keep that terminal open. Copy the temporary token it prints into **Upload a Picture > Link to Marketplace**, paste one listing URL per line, and fetch the photos. The helper accepts up to 10 listings and returns at most 5 main-panel photos per listing; it binds only to `127.0.0.1`. Never commit the Facebook session or share the temporary bridge token.

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
