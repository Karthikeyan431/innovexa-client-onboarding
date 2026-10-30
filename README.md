# Innovexa Digital — Client Onboarding

**Build. Automate. Scale.** — the client onboarding and management system for [Innovexa Digital](https://www.innovexadigital.in).

- **`/`** — a four-step onboarding form (contact → business → project → review & sign) with a real signature pad, attachments, a locally saved draft and a branded PDF.
- **`/admin/`** — a private dashboard for the Innovexa team: overview metrics, a searchable client list, a detail page per client, status tracking, internal notes, assignment, PDF download and CSV export.

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | Vite + TypeScript (no framework). `index.html` (onboarding) and `admin/index.html` (dashboard) |
| API | Vercel Functions in `api/` (Node.js, Web `Request`/`Response` handlers) |
| Database, auth, files | Supabase Postgres with Row Level Security, Supabase Auth (admins only) and three private Storage buckets |
| PDF | Generated on the server with jsPDF and the embedded Inter font (`server/pdf.ts`) |
| Email | Resend HTTP API (`server/email.ts`) |

```
api/                    Vercel Functions (thin HTTP layer)
  applications.ts       POST  submit an application
  applications/pdf.ts   POST  client re-downloads their PDF (reference + access token)
  uploads.ts            POST  signed upload URLs for attachments
  admin/status.ts       POST  change status (+ optional client email), admin JWT required
  admin/pdf.ts          POST  download / regenerate the signed PDF, admin JWT required
server/                 Server-only logic (validation, storage, PDF, email, PNG checks)
src/shared/schema.ts    Form options, limits and validation shared by browser and server
src/onboarding/         Onboarding form (signature pad, draft storage, API client)
src/admin/              Admin dashboard (data layer in data.ts, views in main.ts)
supabase/migrations/    Schema, RLS policies, storage buckets, RPCs
scripts/                create-admin, cleanup-orphan-uploads, mock-resend (tests), embed-fonts
tests/                  unit (vitest), integration (vitest + local stack), e2e (Playwright)
```

### How a submission flows

1. The browser validates each step using the shared schema. Drafts, including the signature strokes, are saved to `localStorage` on the client's own device.
2. Attachments go **directly to private Storage** through short-lived signed upload URLs from `/api/uploads`. This avoids Vercel's 4.5 MB request limit.
3. `/api/applications` runs the authoritative checks:
   - re-validates and sanitises every field;
   - decodes the signature PNG and **rejects blank or tap-only signatures**;
   - checks each attachment's size, MIME type and magic bytes;
   - enforces a per-IP rate limit and a honeypot field;
   - makes the submission idempotent, so a double-click or retry returns the same application.
4. The server then stores the signature and the application rows and **generates the signed PDF**, saving it to the private `documents` bucket. The PDF is the record of what the client signed, and later admin edits never change it.
5. Emails go to the Innovexa team and to the client, with the PDF attached. An email failure is logged in `email_events` and never undoes a saved submission.
6. The client gets a one-time access token, and only its SHA-256 hash is stored. The token lets them re-download the PDF from the success page or from "Applications submitted from this device".

### The signature fix

The original prototype redrew the canvas every time the review step opened. Going back and forward silently erased the drawing while the form still treated it as signed. The print view also inserted the image right before `window.print()`, so it was often blank. Now:

- Strokes are stored as resolution-independent vectors and re-rendered on resize, step changes and reload. Pointer events cover mouse, touch and pen (including pen pressure), with high-DPI scaling.
- Export renders a fresh, cropped, transparent PNG. If there is no real signature, export returns `null`, and the UI never claims a signature exists without one.
- The server decodes the PNG and requires real ink before accepting a submission.
- The PDF embeds the actual image in the "Client acknowledgement & signature" section, next to the signer's name, date and reference.

## Security

- **RLS on every table.** `anon` has no table privileges at all. Authenticated users see data only if `public.is_admin()` is true, meaning their user id is an **active** row in `admin_users`. Client-side role checks are never trusted.
- **Column-level grants.** Admins can edit only permitted contact and business fields plus the assignment. Status changes go through the `set_application_status()` RPC, which authorises the caller and writes the history in one transaction. Email, project requirements and the signature can't be edited.
- **Private storage.** The `attachments`, `signatures` and `documents` buckets are private, with bucket-level size and MIME limits. Admins read files through 5-minute signed URLs, and anonymous users can read nothing.
- **Secrets.** The service-role key and the Resend key exist only in server env vars, and the built bundle was scanned to confirm no service key is present. `.env*` is git-ignored, and `.env.example` holds placeholders only.
- **Input handling.**
  - Shared validation runs on the server, with length limits, option allow-lists, control and bidi character stripping, and http(s)-only URLs (also enforced by a DB constraint).
  - All dashboard output is HTML-escaped.
  - CSV export guards against formula injection.
  - Internal notes never appear in PDFs, client emails or CSV exports.
- **Headers** (`vercel.json`): CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and `noindex` for `/admin`.
- Public sign-ups are disabled. Admins are created with `scripts/create-admin.mjs`.

## Local development

Requirements: Node 22+ (24 recommended), Docker, and Chrome for the e2e tests.

```bash
npm install
npx supabase start            # local Postgres/Auth/Storage; applies supabase/migrations
cp .env.example .env.local    # then paste the local URL, anon key and service-role key printed by `supabase start`
npm run admin:create -- you@innovexadigital.in "Your Name" owner
npm run dev                   # http://localhost:5173  ·  admin: http://localhost:5173/admin/
```

`npm run dev` serves the `api/` functions through a small Vite plugin, so the Vercel CLI isn't needed locally.

### Tests

```bash
npm test                                   # unit: validation, PNG signature check, PDF content/signature/multi-page
node scripts/mock-resend.mjs &             # captures emails to test-results/emails.jsonl
# with RESEND_API_KEY=test_key and RESEND_API_URL=http://127.0.0.1:4599/emails in .env.local:
INTEGRATION=1 npx vitest run tests/integration   # API, storage, RLS, email, idempotency (needs `npm run dev`)
npx playwright test                        # browser flows on desktop, mobile (touch) and tablet
```

The integration and e2e suites expect three local accounts:

- `admin@innovexadigital.in` / `LocalAdmin#2026` (owner)
- `member@innovexadigital.in` / `LocalMember#2026` (member)
- `outsider@example.com` / `NotAdmin#2026` (a signed-in user who is not an admin)

Create them with `ADMIN_PASSWORD=… npm run admin:create -- …` for the first two. Create the third through the Supabase Studio (local only).

## Deploying to production (Vercel + Supabase)

The existing Vercel project keeps deploying from GitHub. Do this once:

1. **Create a Supabase project** at [supabase.com](https://supabase.com), ideally in the Mumbai region (`ap-south-1`) for Indian clients.
2. **Apply the migrations:** `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. **Auth settings** (Supabase → Authentication):
   - Turn **off** "Allow new users to sign up".
   - Set the Site URL to `https://innovexa-client-onboarding.vercel.app` and add `https://innovexa-client-onboarding.vercel.app/admin/` to the redirect URLs, for password resets.
   - Optionally configure custom SMTP so reset emails come from your domain.
4. **Create the first admin:** put the production URL and service-role key in a local, uncommitted `.env.local`, then run `npm run admin:create -- <email> "<name>" owner`. Ask the person to set their own password via "Forgot password?".
5. **Resend:** create an account, verify the `innovexadigital.in` domain (DNS records), and create an API key.
6. **Vercel → Project → Settings → Environment Variables** (Production and Preview):

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role / secret key (**server only**) |
   | `IP_HASH_SALT` | output of `openssl rand -hex 32` |
   | `RESEND_API_KEY` | Resend API key |
   | `EMAIL_FROM` | e.g. `Innovexa Digital <onboarding@innovexadigital.in>` (verified domain) |
   | `EMAIL_REPLY_TO` | `contact@innovexadigital.in` |
   | `ADMIN_NOTIFICATION_EMAILS` | comma-separated team addresses |
   | `APP_BASE_URL` | `https://innovexa-client-onboarding.vercel.app` |

7. **Framework preset:** `vercel.json` sets Vite, `npm run build` and `dist`, so check the project's settings don't override them. Node.js 24.x.
8. Push the branch, open a preview deployment, run one real submission end to end, then promote to production.
9. **Recommended:**
   - add a Vercel Firewall rate-limit rule for `/api/*`;
   - schedule `scripts/cleanup-orphan-uploads.mjs` daily, from CI or a cron job;
   - if you use a custom Supabase domain, add it to the CSP in `vercel.json`.

## Known limitations

- The drawn signature confirms the acknowledgement. It is **not** an identity-verified or legally certified e-signature, and the UI and PDF say so.
- The client PDF access token lasts 180 days and lives in the client's browser. Clearing site data removes the "previous submissions" list, but the confirmation email still carries the PDF.
- Unsubmitted uploads stay in storage until the cleanup script runs.
- The per-IP rate limit counts successful submissions. For burst protection, use the Vercel Firewall.
- PDF text uses Inter, which covers Latin scripts and ₹. Text in other scripts, such as Tamil, is stored correctly but may not render in the PDF.
