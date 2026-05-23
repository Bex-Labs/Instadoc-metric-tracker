# InstaDoc — Unified System

## Project Structure

```
unified_instadoc/
│
├── index.html                  ← Landing page (main entry point)
├── style.css                   ← ID Metric landing page styles
├── script.js                   ← ID Metric misc scripts (consultation helper etc.)
├── consultation.html
├── consultation.js
├── consultation_firebase.js
├── about.html
├── contact.html
├── services.html
├── Performance_Metrics.html
├── Real_time_analytics_services.html
├── predictive_analytics.html
├── resource_optimization.html
│
├── app/                        ← INSTADOC dashboard (patient + doctor)
│   ├── index.html
│   ├── script.js
│   └── style.css
│
└── admin/                      ← Admin panel (admin-only access)
    ├── index.html
    ├── script.js
    └── style.css
```

## How It Works

### 1. User Journey
1. User visits `index.html` (landing page).
2. If already authenticated (active Supabase session), they are **automatically redirected** to `app/index.html`.
3. If not authenticated, they browse the landing page normally.
4. Clicking **Login** or **Signup** opens a polished modal powered by the same Supabase credentials as the app.
5. On successful authentication, the user is redirected to `app/index.html`.
6. INSTADOC's `onAuthStateChange` then performs **role-based routing** — patients see the patient dashboard, doctors see the doctor dashboard.

### 2. Admin Access
- Admins navigate directly to `admin/index.html` — there is no public link to this URL.
- The admin panel is fully self-contained and only accessible to users with `role: 'admin'` in Supabase profiles.
- A **"← Main Site"** button in the admin header returns to the landing page.

### 3. Auth Flow Details
| Scenario | Behaviour |
|---|---|
| User logs in from landing page | Redirected to `app/index.html`; INSTADOC routes by role |
| User is already logged in | Landing page auto-redirects to `app/index.html` |
| User logs out from app | Redirected to `../index.html` (landing page) |
| Password reset email | Redirects to `app/index.html`; INSTADOC handles `PASSWORD_RECOVERY` |
| Admin suspends user | Force-logout broadcast kicks user to landing page within ~10s |
| Admin visits admin panel | Goes to `admin/index.html`; role-check enforces admin-only access |

### 4. Supabase Client Initialisation
| File | Client name | Scope |
|---|---|---|
| `index.html` (inline `<script>`) | `lpSb` | Landing page auth bridge only |
| `app/script.js` | `supabaseClient` | Full INSTADOC app |
| `admin/script.js` | `supabaseClient` | Admin panel |

Each context has its **own isolated Supabase client instance**. No shared globals, no scope leaks.

### 5. CSS Isolation
- Landing page: `style.css` (root)
- INSTADOC app: `app/style.css`
- Admin panel: `admin/style.css`

Each stylesheet is scoped to its own `index.html`. No conflicts.

## No Changes to Core Logic
- All INSTADOC authentication flows, chart initialisations, API calls, form validations, and video consultation features are **unchanged**.
- All admin user management, realtime subscriptions, ticket workflows, and doctor assignments are **unchanged**.
- Integration is purely additive — new routing glue + modal integration.

---

## Changelog

### [Chore] Sentry removed
**Files:** `index.html`, `app/index.html`

Sentry was included for error and performance monitoring. For a Nigerian healthcare platform, sending user session data (IP, browser, OS, URL) to a US-based third-party service on every error raises NDPR compliance concerns — personal data leaving Nigeria requires explicit consent and appropriate safeguards. Given the app is pre-scale beta, the risk/benefit trade-off doesn't yet justify it.

**What changed:**
- Sentry CDN `<script>` tag and `Sentry.init()` block removed from `index.html`, `app/index.html`, and `admin/index.html`.
- No code elsewhere referenced `Sentry` directly, so no further changes were needed.

**If re-introducing monitoring later:** consider a self-hosted option like [GlitchTip](https://glitchtip.com) (open source, GDPR/NDPR-friendly, Sentry-compatible SDK) so patient data stays under your control.

---

### [Fix] Avatar upload — store in Supabase Storage, not auth metadata
**Files:** `app/script.js` (`handleFileUpload`)

The previous implementation used `FileReader.readAsDataURL()` to convert uploaded avatars into base64 strings and saved them directly into Supabase auth user metadata. This bloated every session token and auth API call with tens of kilobytes of image data, risking metadata size limit errors and degraded performance.

**What changed:**
- Avatar files are now uploaded to the `avatars` Supabase Storage bucket at path `{userId}/avatar.{ext}` with `upsert: true` (re-uploads cleanly overwrite in place).
- Only the short public CDN URL is stored in auth user metadata (`avatar_url`), not the image data itself.
- An optimistic local blob URL is shown instantly while the upload is in progress, then swapped for the permanent URL on success.
- File validation added: images only, 2 MB maximum.
- Upload failures revert the preview to the previous avatar and surface an error toast.

**Supabase setup required (one-time):**
1. Create a public `avatars` bucket in Supabase Storage.
2. Add RLS policies:
   - **INSERT / UPDATE:** `(auth.uid()::text) = (storage.foldername(name))[1]` — users may only write to their own folder.
   - **SELECT:** `true` — public read so avatar URLs resolve in the browser.

---

### [Security] Doctor registration — invite-only via admin panel
**Files:** `index.html`, `app/index.html`, `app/script.js`

Previously, any visitor could tick a "Register as Doctor" checkbox on the signup form and self-assign the `doctor` role. Because role assignment happened entirely in the browser, it could not be trusted — anyone could send the same Supabase `signUp` call with `role: 'doctor'` in the metadata.

**What changed:**
- The "Register as Doctor" checkbox, doctor name/license/specialty fields, and `toggleDoctorSignupFields` function have been removed from both the landing page signup modal (`index.html`) and the in-app signup modal (`app/index.html`, `app/script.js`).
- All self-registered accounts are now created as `patient` unconditionally, with a comment in the code explaining the policy.
- Doctor accounts are created exclusively by admins through the existing **Admin Panel → Create User** modal, where role can be set to `doctor` explicitly.

**No admin panel changes were required** — the create-user and edit-user flows already support the `doctor` role.

---

### [Chore] Orphaned root `script.js` removed
**Files:** `script.js` (deleted), `package.json`

A `script.js` existed at the repo root (2,358 lines) alongside the canonical `admin/script.js` (2,659 lines). Comparison confirmed it was an older snapshot of the admin script with no unique content and no HTML file loading it — the landing page has all its JS inline. Leaving it in place risked engineers editing the wrong file and the two copies silently diverging.

**What changed:**
- Root `script.js` deleted via `git rm`.
- `package.json` description updated — it referenced `script.js` as "ID Metric misc scripts" which was no longer accurate.

**Action required:** Run `git rm script.js && git commit -m "chore: remove orphaned root script.js"` if not already done.

---

### [Chore] Committed zip artefacts removed, `*.zip` added to `.gitignore`
**Files:** `app.zip` (deleted), `admin.zip` (deleted), `.gitignore`

`app.zip` and `admin.zip` were committed to the repo root — likely accidental exports. Binary artefacts like these have no place in version control: they bloat the repo, don't diff meaningfully, and go stale silently.

**What changed:**
- Both zip files removed via `git rm`.
- `*.zip` added to `.gitignore` so re-generated archives can't be accidentally committed in future.

---

### [Security] Admin portal link removed from public footer
**Files:** `index.html`

The landing page footer contained a visible (if small) link to `admin/index.html`. While the admin panel enforces a server-side role check (`role: 'admin'`), advertising the admin URL in public HTML is unnecessary and makes it trivially discoverable via page source inspection.

**What changed:**
- The `<a href="admin/index.html">Admin Portal</a>` link and its associated CSS (`.admin-portal-link`) have been removed from the landing page footer.
- The admin panel URL is unchanged — admins navigate to it directly.
- The "Admin Access" section in this README has been updated to reflect this.
