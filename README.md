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
- A subtle **"Admin Portal"** link is in the footer of the landing page.
- It points to `admin/index.html`.
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
