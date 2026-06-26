"use strict";

/**
 * Instadoc Admin Dashboard (Refactored)
 * - Unified activity feed via `platform_activity`
 * - Admin audit trail via `admin_audit_log`
 * - Soft-delete via `profiles.deleted_at` (exposed as Archived)
 * - Doctor ↔ Patient assignments via `doctor_patient_assignments`
 *
 * IMPORTANT SECURITY NOTE:
 * Using an ANON key in a client-side admin dashboard is not secure unless ALL write operations are protected
 * by RLS policies that only allow admins. Ideally, admin actions should go through server-side functions.
 */

/* =========================
   1) CONFIG
   ========================= */
const CONFIG = {
  SUPABASE_URL: "https://ioaqlcltvakuqqehkyor.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvYXFsY2x0dmFrdXFxZWhreW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTk1MzksImV4cCI6MjA4MTczNTUzOX0._7ISJbfJzryBJWmtRuN72F-JZpYdvJxsltwwhombPtE",
};

// ==========================================
// PRIVACY & COMPLIANCE: DATA MASKING ENGINE
// ==========================================
function maskPII(text) {
    if (!text || typeof text !== 'string') return text;
    
    let maskedText = text;
    
    // 1. Mask Emails (e.g., john.doe@email.com -> j***@email.com)
    maskedText = maskedText.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, (match) => {
        const parts = match.split('@');
        return parts[0][0] + "***@" + parts[1];
    });

    // 2. Mask Phone Numbers (e.g., 1234567890 -> ***-***-7890)
    maskedText = maskedText.replace(/\b\d{10,11}\b/g, (match) => {
        return "***-***-" + match.slice(-4);
    });
    
    // 3. Mask UUIDs for security (e.g., showing only first 8 chars of a user ID)
    maskedText = maskedText.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (match) => {
        return match.substring(0, 8) + "-****-****-****-************";
    });

    return maskedText;
}

const supabaseClient = supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
);

/* =========================
   2) STATE
   ========================= */
const state = {
  sessionUser: null,
  currentAdminId: null,
  currentAdminName: null, // stored for use in activity descriptions
  selectedUserId: null,
  selectedTicketId: null,
  allUsers: [],
  allTickets: [],
  allDoctors: [],
  selectedDoctorId: null,
  selectedDoctorName: null,
  selectedDoctorEmail: null,
  assignments: [], // for selected doctor
  patientPicker: [],
  _sessionWatcher: null, // interval ID for session status polling
};

/* =========================
   3) DOM HELPERS
   ========================= */
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function setBodyView(view) {
  const body = $("app-body");
  body.classList.remove("view-login", "view-dashboard");
  body.classList.add(view);
}

function show(el) {
  el?.classList.remove("hidden");
}
function hide(el) {
  el?.classList.add("hidden");
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showAlert(message) {
  const box = $("login-alert");
  box.textContent = message;
  show(box);
}

function clearAlert() {
  const box = $("login-alert");
  box.textContent = "";
  hide(box);
}

function setLoading(isLoading) {
  const btn = $("loginBtn");
  const text = btn?.querySelector(".btn-text");
  const loader = btn?.querySelector(".btn-loader");
  if (!btn || !text || !loader) return;
  if (isLoading) {
    btn.disabled = true;
    hide(text);
    show(loader);
  } else {
    btn.disabled = false;
    show(text);
    hide(loader);
  }
}

function formatDate(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "N/A";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTime(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "N/A";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${day}/${month}/${year}, ${displayHours}:${minutes} ${ampm}`;
}

function timeAgo(dateInput) {
  const date = new Date(dateInput);
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

/* =========================
   4) NAV TABS
   ========================= */
function initTabs() {
  qsa(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".nav-tab").forEach((b) => b.classList.remove("active"));
      qsa(".tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.target;
      $(`${target}`)?.classList.add("active");

      // Save active tab so page reload restores it
      localStorage.setItem("instadoc_active_tab", target);

      // Reload data fresh when switching to certain tabs
      if (target === "login-history") loadLoginHistory();
      if (target === "metrics") { loadWeeklyChart(); loadMetrics(); }
      if (target === "hospitals") loadHospitals();
    });
  });

  // Restore last active tab on page load
  const savedTab = localStorage.getItem("instadoc_active_tab");
  if (savedTab) {
    const savedBtn = document.querySelector(`.nav-tab[data-target="${savedTab}"]`);
    const savedContent = $(`${savedTab}`);
    if (savedBtn && savedContent) {
      qsa(".nav-tab").forEach((b) => b.classList.remove("active"));
      qsa(".tab-content").forEach((c) => c.classList.remove("active"));
      savedBtn.classList.add("active");
      savedContent.classList.add("active");
    }
  }
}

/* =========================
   5) AUTH FLOW
   ========================= */
async function bootstrap() {
  initTabs();
  bindUI();

  const {
    data: { session },
    error,
  } = await supabaseClient.auth.getSession();
  if (error) console.warn("getSession error:", error);

  if (session?.user) {
    await checkAdminAndLoad(session.user);
  } else {
    showLogin();
  }
}

function showLogin() {
  setBodyView("view-login");
  show($("login-view"));
  hide($("dashboard-view"));
  clearAlert();
  setLoading(false);
}

function showDashboard() {
  setBodyView("view-dashboard");
  hide($("login-view"));
  show($("dashboard-view"));
}

async function checkAdminAndLoad(user) {
  clearAlert();
  setLoading(true);

  // Fetch role from profiles
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, role, status, deleted_at")
    .eq("id", user.id)
    .single();

  if (error) {
    showAlert(`Database Error: ${error.message}. Check RLS policies.`);
    await supabaseClient.auth.signOut();
    setLoading(false);
    return;
  }

  if (profile?.deleted_at) {
    showAlert("Access Denied: This account is archived.");
    await supabaseClient.auth.signOut();
    setLoading(false);
    return;
  }

  if (profile?.status === "suspended") {
    showAlert("Access Denied: This account has been suspended.");
    await supabaseClient.auth.signOut();
    setLoading(false);
    return;
  }

  if (profile?.role !== "admin") {
    showAlert(
      `Access Denied: Your role is '${profile?.role}', but 'admin' is required.`,
    );
    await supabaseClient.auth.signOut();
    setLoading(false);
    return;
  }

  state.sessionUser = user;
  state.currentAdminId = user.id;
  state.currentAdminName = profile.full_name || user.email || "Admin";
  $("admin-email").textContent = user.email;

  showDashboard();
  await loadAllData();
  setupRealtime();
  startAutoRefresh(); // Silently refresh activity feed + chart every 30s
  startSessionWatcher(user.id); // Poll every 60s to catch status changes mid-session

  setLoading(false);
}

// Polls profile every 10 seconds — kicks users out quickly if suspended/archived/deactivated mid-session
function startSessionWatcher(userId) {
  // Clear any existing watcher
  if (state._sessionWatcher) clearInterval(state._sessionWatcher);

  state._sessionWatcher = setInterval(async () => {
    try {
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("status, deleted_at, role")
        .eq("id", userId)
        .single();

      const blocked =
        !profile ||
        profile.deleted_at !== null ||
        profile.status === "suspended" ||
        profile.status === "inactive" ||
        profile.role !== "admin";

      if (blocked) {
        clearInterval(state._sessionWatcher);
        await supabaseClient.auth.signOut();
        resetState();
        showLogin();
        showAlert("Your session has ended: account status changed by an administrator.");
      }
    } catch (_) {
      // Network hiccup — don't kick out, try again next cycle
    }
  }, 10000); // Check every 10 seconds for near-instant logout
}


/* =========================
   6) UI BINDINGS
   ========================= */
function bindUI() {
  // Login submit
  $("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert();

    const email = $("email").value.trim();
    const password = $("password").value;

    setLoading(true);
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      showAlert(error.message);
      setLoading(false);
      return;
    }

    // Track admin login in login_logs
    if (data?.user) {
      const meta = data.user.user_metadata || {};
      supabaseClient.from("login_logs").insert({
        user_id: data.user.id,
        email: data.user.email || "",
        full_name: meta.full_name || meta.name || "",
        role: "admin",
        logged_in_at: new Date().toISOString(),
      }).then(({ error: logErr }) => {
        if (logErr) console.warn("Admin login log failed:", logErr.message);
      });
    }

    await checkAdminAndLoad(data.user);
  });

  // Logout
  $("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    resetState();
    showLogin();
  });

  // Users
  $("refreshUsersBtn")?.addEventListener("click", async () => {
    if ($("userSearch")) $("userSearch").value = "";
    if ($("roleFilter")) $("roleFilter").value = "all";
    if ($("statusFilter")) $("statusFilter").value = "all";

    state.selectedUserId = null;

    await loadUsers();
  });
  $("userSearch")?.addEventListener("input", () => applyUserFilters());
  $("roleFilter")?.addEventListener("change", () => applyUserFilters());
  $("statusFilter")?.addEventListener("change", () => applyUserFilters());

  // Create user modal
  $("openCreateUserBtn")?.addEventListener("click", () =>
    openCreateUserModal(),
  );
  $("closeCreateUserModalBtn")?.addEventListener("click", () =>
    closeCreateUserModal(),
  );
  $("createUserForm")?.addEventListener("submit", (e) => createUser(e));

  // User modal
  $("closeUserModalBtn")?.addEventListener("click", () => closeUserModal());

  // Metrics
  $("refreshLogsBtn")?.addEventListener("click", async () => {
    if ($("logTypeFilter")) $("logTypeFilter").value = "all";

    await loadRecentLogs();
    await loadActivityFeed();
  });
  $("logTypeFilter")?.addEventListener("change", () => loadRecentLogs());

  // Tickets
  $("refreshTicketsBtn")?.addEventListener("click", async () => {
    if ($("ticketSearch")) $("ticketSearch").value = "";
    if ($("priorityFilter")) $("priorityFilter").value = "all";
    if ($("ticketStatusFilter")) $("ticketStatusFilter").value = "all";

    state.selectedTicketId = null;

    closeTicketPanel();

    await loadTickets();
  });
  $("ticketSearch")?.addEventListener("input", () => applyTicketFilters());
  $("priorityFilter")?.addEventListener("change", () => applyTicketFilters());
  $("ticketStatusFilter")?.addEventListener("change", () =>
    applyTicketFilters(),
  );
  $("closeTicketPanelBtn")?.addEventListener("click", () => closeTicketPanel());
  $("sendTicketReplyBtn")?.addEventListener("click", () => sendTicketReply());

  // Doctors
  $("refreshDoctorsBtn")?.addEventListener("click", async () => {
    if ($("doctorSearch")) $("doctorSearch").value = "";

    state.selectedDoctorId = null;
    state.assignments = [];

    const patientList = $("patientList");
    if (patientList) {
      patientList.innerHTML = `
        <div style="text-align:center; padding:2.5rem 1rem; color:#9ca3af;">
          <i class="fa-solid fa-hand-pointer" style="font-size:1.8rem; margin-bottom:0.6rem; display:block; opacity:0.3;"></i>
          <p style="font-size:0.82rem;">Select a doctor to view their patients</p>
        </div>`;
    }

    // Hide unassign all button on refresh
    const unassignBtn = $("unassignAllBtn");
    if (unassignBtn) unassignBtn.style.display = 'none';

    // Hide count pill
    const pill = $("assigned-count-pill");
    if (pill) pill.style.display = 'none';

    await loadDoctors();
  });
  $("doctorSearch")?.addEventListener("input", () => filterDoctors());
  $("unassignAllBtn")?.addEventListener("click", () => unassignAllFromDoctor());

  // Assign patient modal
  $("closeAssignPatientModalBtn")?.addEventListener("click", () =>
    closeAssignPatientModal(),
  );
  $("patientSearch")?.addEventListener("input", () => renderPatientPicker());
  $("refreshPatientPickerBtn")?.addEventListener("click", () =>
    loadPatientPicker(),
  );
  // Login history filters
  $("loginSearch")?.addEventListener("input", () => applyLoginFilters());
  $("loginRoleFilter")?.addEventListener("change", () => applyLoginFilters());
}

function resetState() {
  // Stop session watcher and auto-refresh if running
  if (state._sessionWatcher) {
    clearInterval(state._sessionWatcher);
    state._sessionWatcher = null;
  }
  stopAutoRefresh();
  state.sessionUser = null;
  state.currentAdminId = null;
  state.currentAdminName = null;
  state.selectedUserId = null;
  state.allUsers = [];
  state.allTickets = [];
  state.allDoctors = [];
  state.selectedDoctorId = null;
  state.selectedDoctorName = null;
  state.selectedDoctorEmail = null;
  state.assignments = [];
  state.patientPicker = [];
}

/* =========================
   7) DATA LOADING (Top)
   ========================= */
async function loadAllData() {
  await Promise.allSettled([
    loadUsers(),
    loadMetrics(),
    loadTickets(),
    loadRecentLogs(),
    loadActivityFeed(),
    loadWeeklyChart(),
    loadDoctors(),
    loadLoginHistory(),
    loadDoctorActivity(),
    loadHospitals()
  ]);
}

/* =========================
   AUTO-REFRESH
   ========================= */
let _autoRefreshInterval = null;

function startAutoRefresh() {
  if (_autoRefreshInterval) return; // already running
  _autoRefreshInterval = setInterval(async () => {
    // Silently refresh activity feed and chart without disrupting the user
    const prevScrollTop = $("activityLog")?.scrollTop || 0;
    await Promise.allSettled([
      loadActivityFeed(),
      loadWeeklyChart(),
      loadMetrics(),
    ]);
    // Restore scroll position so feed doesn't jump
    if ($("activityLog")) $("activityLog").scrollTop = prevScrollTop;
  }, 30000); // every 30 seconds
}

function stopAutoRefresh() {
  if (_autoRefreshInterval) {
    clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = null;
  }
}

/* =========================
   LOGIN HISTORY
   ========================= */
const loginHistoryState = {
  allLogs: [],
  filtered: [],
  page: 0,
  pageSize: 20,
};

async function loadLoginHistory() {
  const tbody = $("loginHistoryBody");
  if (!tbody) return;

  // Reset filters on refresh
  if ($("loginSearch")) $("loginSearch").value = "";
  if ($("loginRoleFilter")) $("loginRoleFilter").value = "";

  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading...</td></tr>';

  const [logsRes, profilesRes] = await Promise.all([
    supabaseClient
      .from("login_logs")
      .select("user_id, email, full_name, role, logged_in_at")
      .order("logged_in_at", { ascending: false })
      .limit(500),
    supabaseClient
      .from("profiles")
      .select("id, full_name, email"),
  ]);

  if (logsRes.error) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state" style="color:red">Error loading login history</td></tr>`;
    console.error("loadLoginHistory error:", logsRes.error);
    return;
  }

  // Build a profile map for name lookup
  const profileMap = {};
  (profilesRes.data || []).forEach((p) => {
    profileMap[p.id] = p.full_name || p.email || "";
  });

  // Enrich login logs with profile names as fallback
  loginHistoryState.allLogs = (logsRes.data || []).map((l) => ({
    ...l,
    full_name: profileMap[l.user_id] || l.full_name || "",
  }));

  loginHistoryState.page = 0;
  applyLoginFilters();
}

function applyLoginFilters() {
  const search = ($("loginSearch")?.value || "").toLowerCase().trim();
  const role   = ($("loginRoleFilter")?.value || "").toLowerCase();

  loginHistoryState.filtered = loginHistoryState.allLogs.filter((l) => {
    const matchSearch =
      !search ||
      (l.full_name || "").toLowerCase().includes(search) ||
      (l.email || "").toLowerCase().includes(search);
    const matchRole = !role || (l.role || "").toLowerCase() === role;
    return matchSearch && matchRole;
  });

  loginHistoryState.page = 0;
  renderLoginHistory();
}

function renderLoginHistory() {
  const tbody = $("loginHistoryBody");
  const pagination = $("loginHistoryPagination");
  if (!tbody) return;

  const { filtered, page, pageSize } = loginHistoryState;
  const start = page * pageSize;
  const end   = start + pageSize;
  const slice = filtered.slice(start, end);
  const totalPages = Math.ceil(filtered.length / pageSize);

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No login records found.</td></tr>';
    if (pagination) pagination.innerHTML = "";
    return;
  }

  tbody.innerHTML = slice.map((l) => `
    <tr>
      <td>${escapeHtml(l.full_name || "—")}</td>
      <td>${escapeHtml(l.email || "—")}</td>
      <td><span style="text-transform:capitalize;">${escapeHtml(l.role || "patient")}</span></td>
      <td>${escapeHtml(formatDateTime(l.logged_in_at))}</td>
    </tr>
  `).join("");

  // Pagination controls
  if (pagination) {
    if (totalPages <= 1) {
      pagination.innerHTML = `<small style="color:#888">${filtered.length} record${filtered.length !== 1 ? "s" : ""}</small>`;
    } else {
      pagination.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;">
          <button onclick="loginHistoryPage(-1)" ${page === 0 ? "disabled" : ""} style="padding:5px 12px;border:1px solid #ddd;border-radius:5px;cursor:pointer;">◀ Prev</button>
          <small style="color:#555">Page ${page + 1} of ${totalPages} &nbsp;·&nbsp; ${filtered.length} records</small>
          <button onclick="loginHistoryPage(1)" ${page >= totalPages - 1 ? "disabled" : ""} style="padding:5px 12px;border:1px solid #ddd;border-radius:5px;cursor:pointer;">Next ▶</button>
        </div>
      `;
    }
  }
}

function loginHistoryPage(dir) {
  const { filtered, page, pageSize } = loginHistoryState;
  const totalPages = Math.ceil(filtered.length / pageSize);
  loginHistoryState.page = Math.max(0, Math.min(page + dir, totalPages - 1));
  renderLoginHistory();
}

/* =========================
   8) USER MANAGEMENT
   ========================= */
async function loadUsers() {
  const tbody = $("usersTableBody");
  tbody.innerHTML =
    '<tr><td colspan="8" class="empty-state">Fetching data...</td></tr>';

  // Include deleted_at so we can show Archived status
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:red">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  state.allUsers = data || [];
  applyUserFilters(); // renders
}

function normalizeUserStatus(u) {
  // Soft delete maps to archived
  if (u.deleted_at) return "archived";
  return u.status || "active";
}

function applyUserFilters() {
  const search = $("userSearch")?.value?.trim().toLowerCase() || "";
  const role = $("roleFilter")?.value || "all";
  const status = $("statusFilter")?.value || "all";

  let filtered = [...state.allUsers];

  if (search) {
    filtered = filtered.filter(
      (u) =>
        (u.email || "").toLowerCase().includes(search) ||
        (u.full_name || "").toLowerCase().includes(search) ||
        (u.id || "").toLowerCase().includes(search),
    );
  }

  if (role !== "all") {
    filtered = filtered.filter((u) => u.role === role);
  }

  if (status !== "all") {
    filtered = filtered.filter((u) => normalizeUserStatus(u) === status);
  }

  renderUsers(filtered);
}

function renderUsers(users) {
  const tbody = $("usersTableBody");
  tbody.innerHTML = "";

  if (!users.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="empty-state">No users found matching your criteria.</td></tr>';
    return;
  }

  users.forEach((u) => {
    const status = normalizeUserStatus(u);
    const isSelf = state.currentAdminId && u.id === state.currentAdminId;

    const roleBadge =
      u.role === "admin"
        ? "badge-admin"
        : u.role === "doctor"
          ? "badge-doctor"
          : "badge-patient";

    const statusBadge = `badge-${status}`;

    const row = document.createElement("tr");
    row.dataset.userId = u.id;
    row.classList.add("selectable-row");

    if (state.selectedUserId === u.id) row.classList.add("selected");

    row.addEventListener("click", (e) => {
      // Don't toggle selection when clicking buttons inside row
      if (e.target.closest("button")) return;
      selectUserRow(u.id);
    });

    const actionButtons = buildUserActionButtons(u, status, isSelf);

    const avatarColors = {
      admin:            { bg: '#e6f1fb', color: '#185fa5' },
      doctor:           { bg: '#eaf3de', color: '#3b6d11' },
      patient:          { bg: '#faeeda', color: '#854f0b' },
      hospital_manager: { bg: '#eeedfe', color: '#534ab7' },
    };
    const av = avatarColors[u.role] || { bg: '#f1f5f9', color: '#64748b' };
    const initials = (u.full_name || u.email || '?')
      .split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

    row.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:9px;">
          <div style="width:30px;height:30px;border-radius:50%;background:${av.bg};color:${av.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:13px;color:#1a1a2e;">${escapeHtml(u.full_name || 'N/A')}</div>
            <div style="font-size:11px;color:#94a3b8;">${escapeHtml(u.email || '')}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${roleBadge}">${escapeHtml(u.role || 'unknown')}</span></td>
      <td><span class="badge ${statusBadge}">${escapeHtml(status.toUpperCase())}</span></td>
      <td style="font-size:12px;color:#94a3b8;">${u.created_at ? escapeHtml(formatDate(u.created_at)) : 'N/A'}</td>
      <td><div class="action-buttons">${actionButtons}</div></td>
    `;

    tbody.appendChild(row);
  });

  // Refresh selection indicator for all rows
  syncSelectedRowStyles();
}

function selectUserRow(userId) {
  state.selectedUserId = userId;
  syncSelectedRowStyles();
}

function syncSelectedRowStyles() {
  qsa("#usersTableBody tr").forEach((tr) => {
    const id = tr.dataset.userId;
    if (id && id === state.selectedUserId) {
      tr.classList.add("selected");
    } else {
      tr.classList.remove("selected");
    }
  });
}

// ----- Ticket row selection (tick/untick) -----
function selectTicketRow(ticketId) {
  if (state.selectedTicketId === ticketId) {
    state.selectedTicketId = null;
  } else {
    state.selectedTicketId = ticketId;
  }
  syncSelectedTicketStyles();
}

function syncSelectedTicketStyles() {
  document.querySelectorAll("#ticketTableBody tr").forEach((tr) => {
    const id = tr.dataset.ticketId;
    if (id && id === state.selectedTicketId) {
      tr.classList.add("selected");
    } else {
      tr.classList.remove("selected");
    }
  });
}

function buildUserActionButtons(u, status, isSelf) {
  const id = u.id;

  const viewBtn = `<button class="btn btn-view" type="button" onclick="AdminApp.viewUser('${id}')"><i class="fa-solid fa-eye"></i> View</button>`;
  const editBtn = `<button class="btn btn-edit" type="button" onclick="AdminApp.editUser('${id}')"><i class="fa-solid fa-pen"></i> Edit</button>`;

  if (isSelf) {
    return `<div class="action-buttons">${viewBtn}${editBtn}<small style="color:#6c757d;font-style:italic;font-size:11px;">Own account</small></div>`;
  }

  // Build dropdown items based on status
  let dropdownItems = '';

  if (status === 'archived') {
    dropdownItems = `
      <button class="dropdown-item item-activate" onclick="AdminApp.restoreUser('${id}'); closeAllDropdowns()">
        <i class="fa-solid fa-trash-arrow-up"></i> Restore
      </button>`;
  } else {
    if (status === 'active') {
      dropdownItems += `
        <button class="dropdown-item item-warn" onclick="AdminApp.changeUserStatus('${id}','inactive'); closeAllDropdowns()">
          <i class="fa-solid fa-circle-pause"></i> Deactivate
        </button>
        <button class="dropdown-item item-danger" onclick="AdminApp.changeUserStatus('${id}','suspended'); closeAllDropdowns()">
          <i class="fa-solid fa-ban"></i> Suspend
        </button>`;
    } else if (status === 'inactive' || status === 'suspended') {
      dropdownItems += `
        <button class="dropdown-item item-activate" onclick="AdminApp.changeUserStatus('${id}','active'); closeAllDropdowns()">
          <i class="fa-solid fa-circle-check"></i> Activate
        </button>`;
      if (status === 'inactive') {
        dropdownItems += `
        <button class="dropdown-item item-danger" onclick="AdminApp.changeUserStatus('${id}','suspended'); closeAllDropdowns()">
          <i class="fa-solid fa-ban"></i> Suspend
        </button>`;
      }
    }
    dropdownItems += `
      <div class="dropdown-divider"></div>
      <button class="dropdown-item item-archive" onclick="AdminApp.archiveUser('${id}'); closeAllDropdowns()">
        <i class="fa-solid fa-box-archive"></i> Archive
      </button>`;
  }

  return `
    <div class="action-buttons">
      ${viewBtn}${editBtn}
      <div class="dropdown-wrap">
        <button class="btn btn-more" type="button" onclick="toggleDropdown(this)" title="More actions">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
        <div class="dropdown-menu">
          ${dropdownItems}
        </div>
      </div>
    </div>`;
}

async function viewUser(userId) {
  const u = state.allUsers.find((x) => x.id === userId);
  if (!u) return;

  const modal = $("userModal");
  const body = $("userModalBody");
  $("userModalTitle").textContent = "User Details";

  show(modal);

  const [bp, weight, glucose] = await Promise.all([
    countByUser("bp_logs", userId),
    countByUser("weight_logs", userId),
    countByUser("glucose_logs", userId),
  ]);

  const status = normalizeUserStatus(u);
  body.innerHTML = `
    <div class="modal-body-grid">
      <div class="modal-field"><label>Full Name</label><div class="value">${escapeHtml(u.full_name || "N/A")}</div></div>
      <div class="modal-field"><label>Email</label><div class="value">${escapeHtml(u.email || "N/A")}</div></div>
      <div class="modal-field"><label>Role</label><div class="value"><span class="badge badge-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></div></div>
      <div class="modal-field"><label>Status</label><div class="value"><span class="badge badge-${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></div></div>
      <div class="modal-field"><label>User ID</label><div class="value"><small>${escapeHtml(u.id)}</small></div></div>
      <div class="modal-field"><label>Joined</label><div class="value">${u.created_at ? escapeHtml(formatDate(u.created_at)) : "N/A"}</div></div>
      <div class="modal-field"><label>BP Logs</label><div class="value">${bp} readings</div></div>
      <div class="modal-field"><label>Weight Logs</label><div class="value">${weight} readings</div></div>
      <div class="modal-field"><label>Glucose Logs</label><div class="value">${glucose} readings</div></div>
      <div class="modal-field"><label>Last Updated</label><div class="value">${u.updated_at ? escapeHtml(formatDateTime(u.updated_at)) : "N/A"}</div></div>
    </div>
  `;
}

function closeUserModal() {
  hide($("userModal"));
}

async function editUser(userId) {
  const u = state.allUsers.find((x) => x.id === userId);
  if (!u) return;

  const isSelf = state.currentAdminId && userId === state.currentAdminId;

  const modal = $("userModal");
  const body = $("userModalBody");
  $("userModalTitle").textContent = "Edit User";

  const status = normalizeUserStatus(u);

  body.innerHTML = `
    <form id="editUserForm">
      <div class="modal-body-grid">
        <div class="modal-field">
          <label>Full Name *</label>
          <input type="text" id="edit_full_name" value="${escapeHtml(u.full_name || "")}" required />
        </div>

        <div class="modal-field">
          <label>Email *</label>
          <input type="email" id="edit_email" value="${escapeHtml(u.email || "")}" required />
        </div>

        <div class="modal-field">
          <label>Role * ${isSelf ? '<small style="color:#e74c3c;">(Cannot change own role)</small>' : ""}</label>
          <select id="edit_role" ${isSelf ? "disabled" : ""} required>
            <option value="patient" ${u.role === "patient" ? "selected" : ""}>Patient</option>
            <option value="doctor" ${u.role === "doctor" ? "selected" : ""}>Doctor</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </div>

        <div class="modal-field">
          <label>Status * ${isSelf ? '<small style="color:#e74c3c;">(Cannot change own status)</small>' : ""}</label>
          <select id="edit_status" ${isSelf ? "disabled" : ""} required>
            <option value="active" ${status === "active" ? "selected" : ""}>Active</option>
            <option value="inactive" ${status === "inactive" ? "selected" : ""}>Inactive</option>
            <option value="suspended" ${status === "suspended" ? "selected" : ""}>Suspended</option>
          </select>
        </div>

        <div class="modal-field" style="grid-column: 1 / -1;">
          <label>Reason (for audit) *</label>
          <input type="text" id="edit_reason" placeholder="e.g., Updated email per user request" required />
        </div>
      </div>

      ${isSelf ? '<div style="background:#fff3cd;padding:10px;border-radius:4px;margin-top:12px;color:#856404;font-size:13px;">⚠️ Self-protection: You cannot change your own role/status.</div>' : ""}

      <div style="margin-top: 18px; display:flex; gap:10px; justify-content:flex-end;">
        <button type="button" class="btn btn-close" onclick="AdminApp.closeUserModal()">Cancel</button>
        <button type="submit" class="btn btn-activate">Save Changes</button>
      </div>
    </form>
  `;

  show(modal);

  qs("#editUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveUserEdit(userId, isSelf);
  });
}

async function saveUserEdit(userId, isSelf) {
  const full_name = qs("#edit_full_name")?.value?.trim();
  const email = qs("#edit_email")?.value?.trim();
  const reason = qs("#edit_reason")?.value?.trim();

  const role = isSelf
    ? state.allUsers.find((u) => u.id === userId)?.role
    : qs("#edit_role")?.value;
  const status = isSelf
    ? normalizeUserStatus(state.allUsers.find((u) => u.id === userId))
    : qs("#edit_status")?.value;

  if (!full_name || !email || !role || !status || !reason) {
    alert("Please complete all required fields, including the reason.");
    return;
  }

  if (!confirm("Are you sure you want to update this user?")) return;

  try {
    // Update profiles
    const { error } = await supabaseClient
      .from("profiles")
      .update({
        full_name,
        email,
        role,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw error;

    // Audit trail + activity feed
    await logAdminAction({
      module: "users",
      action: "updated",
      target_user_id: userId,
      description: `${state.currentAdminName} updated profile for ${full_name}.`,
      reason,
    });

    alert("✅ User updated successfully!");
    closeUserModal();
    await loadUsers();
    await loadActivityFeed();
  } catch (err) {
    console.error("saveUserEdit error:", err);
    alert(`❌ Failed to update user: ${err.message}`);
  }
}

async function changeUserStatus(userId, newStatus) {
  const u = state.allUsers.find((x) => x.id === userId);
  if (!u) return;

  const actionWord =
    newStatus === "suspended"
      ? "suspend"
      : newStatus === "inactive"
        ? "deactivate"
        : "activate";

  const actionPastTense = 
    newStatus === "suspended"
      ? "suspended"
      : newStatus === "inactive"
        ? "deactivated"
        : "activated";

  // Describe what will happen to the user for confirmation
  const consequenceMap = {
    suspended: "They will be immediately logged out and BLOCKED from logging in again.",
    inactive:  "They will be logged out on their next action (soft block).",
    active:    "Their access will be restored.",
  };

  const reason = prompt(`Reason to ${actionWord} this user (required for audit):`);
  if (!reason) return;

  if (!confirm(
    `Are you sure you want to ${actionWord} ${u.full_name || u.email}?\n\n${consequenceMap[newStatus]}`
  )) return;

  try {
    const { error } = await supabaseClient
      .from("profiles")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) throw error;

    // Broadcast a force-logout signal on a user-specific channel.
    // The patient/doctor app should subscribe to this channel and sign out when received.
    // This works without a service role key.
    await supabaseClient
      .channel(`force-logout:${userId}`)
      .send({
        type: "broadcast",
        event: "force_logout",
        payload: { reason: newStatus },
      });

    // Also attempt hard revocation via admin API (only works with service role key — silent fail otherwise)
    if (newStatus === "suspended") {
      try { await supabaseClient.auth.admin.signOut(userId); } catch (_) {}
    }

    await logAdminAction({
      module: "users",
      action: newStatus,
      target_user_id: userId,
      description: `${state.currentAdminName} ${actionPastTense} ${u.full_name || u.email}.`,
      reason,
    });

    const resultMsg = {
      suspended: "✅ User suspended! They will be logged out within 10 seconds.",
      inactive:  "✅ User deactivated. They will be logged out within 10 seconds.",
      active:    "✅ User activated! Their access has been restored.",
    };

    alert(resultMsg[newStatus]);
    await loadUsers();
    await loadActivityFeed();
  } catch (err) {
    console.error("changeUserStatus error:", err);
    alert(`❌ Failed to ${actionWord} user: ${err.message}`);
  }
}

async function archiveUser(userId) {
  const u = state.allUsers.find((x) => x.id === userId);
  if (!u) return;

  const reason = prompt("Reason to archive this user (required for audit):");
  if (!reason) return;

  if (
    !confirm(
      `Archive ${u.full_name || u.email}? This is a soft-delete and can be restored.`,
    )
  )
    return;

  try {
    const { error } = await supabaseClient
      .from("profiles")
      .update({
        deleted_at: new Date().toISOString(),
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw error;

    // Broadcast force-logout signal so the user's app logs them out within seconds
    await supabaseClient
      .channel(`force-logout:${userId}`)
      .send({
        type: "broadcast",
        event: "force_logout",
        payload: { reason: "archived" },
      });

    // Also attempt hard revocation (silent fail without service role key)
    try { await supabaseClient.auth.admin.signOut(userId); } catch (_) {}

    await logAdminAction({
      module: "users",
      action: "archived",
      target_user_id: userId,
      description: `${state.currentAdminName} archived ${u.full_name || u.email}.`,
      reason,
    });

    alert("✅ User archived. They are now blocked from accessing the app.");
    await loadUsers();
    await loadActivityFeed();
  } catch (err) {
    console.error("archiveUser error:", err);
    alert(`❌ Failed to archive user: ${err.message}`);
  }
}

async function restoreUser(userId) {
  const u = state.allUsers.find((x) => x.id === userId);
  if (!u) return;

  const reason = prompt("Reason to restore this user (required for audit):");
  if (!reason) return;

  if (!confirm(`Restore ${u.full_name || u.email} from archive?`)) return;

  try {
    const { error } = await supabaseClient
      .from("profiles")
      .update({
        deleted_at: null,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw error;

    await logAdminAction({
      module: "users",
      action: "restored",
      target_user_id: userId,
      description: `${state.currentAdminName} restored ${u.full_name || u.email} from archive.`,
      reason,
    });

    alert("✅ User restored.");
    await loadUsers();
    await loadActivityFeed();
  } catch (err) {
    console.error("restoreUser error:", err);
    alert(`❌ Failed to restore user: ${err.message}`);
  }
}

/* =========================
   9) CREATE USER
   ========================= */
function openCreateUserModal() {
  window.location.href = 'create-user.html';
}

function closeCreateUserModal() {
  hide($("createUserModal"));
}

async function createUser(e) {
  e.preventDefault();

  const email = $("newUserEmail").value.trim();
  const password = $("newUserPassword").value;
  const full_name = $("newUserName").value.trim();
  const role = $("newUserRole").value;

  if (!email || !password || !full_name || !role) {
    alert("Please complete all fields.");
    return;
  }

  const reason = prompt("Reason to create this user (required for audit):");
  if (!reason) return;

  if (!confirm(`Create new ${role} user: ${email}?`)) return;

  try {
    /**
     * NOTE: auth.signUp() on the client will switch the active session to the newly
     * created user, logging the admin out. We capture the admin's session first
     * and restore it immediately after.
     */
    const { data: { session: adminSession } } = await supabaseClient.auth.getSession();

    const { data: signUpData, error: signUpError } =
  await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: role,             // <-- Injects the role into user_metadata
        full_name: full_name    // <-- Injects the name into user_metadata
      }
    }
  });

    if (signUpError) throw signUpError;

    const newUserId = signUpData?.user?.id;
    if (!newUserId)
      throw new Error("Auth signup succeeded but user id was not returned.");

    // Immediately restore admin session so we don't get logged out
    if (adminSession) {
      await supabaseClient.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }

    // Upsert profile row (trigger may have already created it)
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert({
        id: newUserId,
        email,
        full_name,
        role,
        hospital_id: $('newUserHospital')?.value || null,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (profileError) throw profileError;

    await logAdminAction({
      module: "users",
      action: "created",
      target_user_id: newUserId,
      description: `${state.currentAdminName} created new ${role} account for ${email}.`,
      reason,
    });

    alert("✅ User created successfully!");
    closeCreateUserModal();
    await loadUsers();
    await loadActivityFeed();
  } catch (err) {
    console.error("createUser error:", err);
    alert(`❌ Failed to create user: ${err.message}`);
  }
}

/* =========================
   10) METRICS + HEALTH LOGS
   ========================= */
async function loadMetrics() {
  const usersCount = await getCount("profiles");
  const bpCount = await getCount("bp_logs");
  const weightCount = await getCount("weight_logs");
  const glucoseCount = await getCount("glucose_logs");

  $("count-users").textContent = usersCount;
  $("count-bp").textContent = bpCount;
  $("count-weight").textContent = weightCount;
  $("count-glucose").textContent = glucoseCount;
}

async function getCount(table) {
  const { count, error } = await supabaseClient
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    console.warn("getCount error:", table, error);
    return 0;
  }
  return count || 0;
}

async function countByUser(table, userId) {
  const { count, error } = await supabaseClient
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) return 0;
  return count || 0;
}

async function loadRecentLogs() {
  const tbody = $("recentLogsBody");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';

  const logType = $("logTypeFilter")?.value || "all";

  try {
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("id, full_name, email");

    const profileMap = {};
    (profiles || []).forEach(
      (p) => (profileMap[p.id] = p.full_name || p.email || "Unknown"),
    );

    const allLogs = [];

    if (logType === "all" || logType === "bp") {
      const { data } = await supabaseClient
        .from("bp_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      (data || []).forEach((log) =>
        allLogs.push({
          ...log,
          type: "BP",
          reading: `${log.systolic}/${log.diastolic} mmHg`,
          user_name: profileMap[log.user_id] || "Unknown User",
        }),
      );
    }

    if (logType === "all" || logType === "weight") {
      const { data } = await supabaseClient
        .from("weight_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      (data || []).forEach((log) =>
        allLogs.push({
          ...log,
          type: "Weight",
          reading: `${log.weight} kg`,
          user_name: profileMap[log.user_id] || "Unknown User",
        }),
      );
    }

    if (logType === "all" || logType === "glucose") {
      const { data } = await supabaseClient
        .from("glucose_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      (data || []).forEach((log) =>
        allLogs.push({
          ...log,
          type: "Glucose",
          reading: `${log.level} mg/dL`,
          user_name: profileMap[log.user_id] || "Unknown User",
        }),
      );
    }

    allLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    tbody.innerHTML = "";
    if (!allLogs.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="empty-state">No recent logs found.</td></tr>';
      return;
    }

    allLogs.slice(0, 20).forEach((log) => {
      const status = getHealthStatus(log);
      const row = document.createElement("tr");
      
      // 🔒 Privacy Enhancement: Mask all raw numbers within the metric reading string
      const safeReading = log.reading ? log.reading.replace(/\d+/g, '***') : '--';
      
      // Optional Name masking helper logic for standard plaintext names inside the cell
      const rawName = log.user_name || 'Unknown';
      let safeName = maskPII(rawName);
      if (safeName === rawName && !rawName.includes('@') && rawName !== 'Unknown') {
         safeName = rawName.split(' ').map(n => n.length > 1 ? n.charAt(0) + '***' : n).join(' ');
      }

      row.innerHTML = `
        <td><span class="badge badge-${log.type.toLowerCase()}">${log.type}</span></td>
        <td>${escapeHtml(safeName)}</td> 
        <td><strong>${escapeHtml(safeReading)}</strong></td> <td><small>${escapeHtml(formatDateTime(log.created_at))}</small></td>
        <td><span class="badge ${status.class}">${status.text}</span></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("loadRecentLogs error:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color:red">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function getHealthStatus(log) {
  if (log.type === "BP") {
    if (log.systolic > 140 || log.diastolic > 90)
      return { class: "badge-high", text: "High" };
    if (log.systolic < 90 || log.diastolic < 60)
      return { class: "badge-low", text: "Low" };
    return { class: "badge-normal", text: "Normal" };
  }
  if (log.type === "Glucose") {
    if (log.level > 140) return { class: "badge-high", text: "High" };
    if (log.level < 70) return { class: "badge-low", text: "Low" };
    return { class: "badge-normal", text: "Normal" };
  }
  return { class: "badge-normal", text: "Logged" };
}

/* =========================
   11) ACTIVITY FEED (Unified)
   ========================= */
function activityIcon(module, action) {
  if (module === "users") {
    if (action === "created") return '<i class="fa-solid fa-user-plus"></i>';
    if (action === "updated") return '<i class="fa-solid fa-user-pen"></i>';
    if (action === "suspended") return '<i class="fa-solid fa-user-slash"></i>';
    if (action === "inactive") return '<i class="fa-solid fa-circle-pause"></i>';
    if (action === "active") return '<i class="fa-solid fa-user-check"></i>';
    if (action === "archived") return '<i class="fa-solid fa-box-archive"></i>';
    if (action === "restored") return '<i class="fa-solid fa-trash-arrow-up"></i>';
    return '<i class="fa-solid fa-users"></i>';
  }
  if (module === "tickets") {
    if (action === "created") return '<i class="fa-solid fa-ticket"></i>';
    if (action === "progress") return '<i class="fa-solid fa-spinner"></i>';
    if (action === "resolved") return '<i class="fa-solid fa-circle-check"></i>';
    if (action === "reopened") return '<i class="fa-solid fa-arrow-rotate-left"></i>';
    if (action === "replied") return '<i class="fa-solid fa-comment-dots"></i>';
    return '<i class="fa-solid fa-ticket"></i>';
  }
  if (module === "doctors") {
    if (action === "assigned_patient") return '<i class="fa-solid fa-user-doctor"></i>';
    if (action === "unassigned_patient") return '<i class="fa-solid fa-user-minus"></i>';
    if (action === "unassigned_all") return '<i class="fa-solid fa-broom"></i>';
    return '<i class="fa-solid fa-stethoscope"></i>';
  }
  return '<i class="fa-solid fa-bell"></i>';
}

// Pagination state for activity feed
const activityFeedState = {
  page: 0,
  pageSize: 20,
  allItems: [],
  profileMap: {},
  emailMap: {},
  loaded: false,
};

function renderActivityPage() {
  const container = $("activityLog");
  if (!container) return;

  const { allItems, page, pageSize } = activityFeedState;
  const itemsToShow = allItems.slice(0, (page + 1) * pageSize);
  const hasMore = itemsToShow.length < allItems.length;

  container.innerHTML = "";

  if (!itemsToShow.length) {
    container.innerHTML = '<div class="activity-item"><div class="description">No recent activity</div></div>';
    return;
  }

  itemsToShow.forEach((a) => {
    const item = document.createElement("div");
    item.className = "activity-item";
    const icon =
      a.kind === "appointment"
        ? '<i class="fa-solid fa-calendar-check"></i>'
        : a.kind === "health"
        ? a.action === "bp"
          ? '<i class="fa-solid fa-heart-pulse"></i>'
          : a.action === "weight"
            ? '<i class="fa-solid fa-weight-scale"></i>'
            : '<i class="fa-solid fa-droplet"></i>'
        : activityIcon(a.module, a.action);

    // Note: We don't escapeHtml on the icon since it contains HTML tags now
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="time"><i class="fa-solid fa-clock"></i> ${escapeHtml(timeAgo(a.created_at))}</div>
          <div class="description">${icon} ${escapeHtml(maskPII(a.description || ""))}</div>
        </div>
      </div>
    `;
    container.appendChild(item);
  });

  // Add or remove Load More button
  const existing = $("activityLoadMore");
  if (existing) existing.remove();

  if (hasMore) {
    const btn = document.createElement("button");
    btn.id = "activityLoadMore";
    btn.textContent = `Load more (${allItems.length - itemsToShow.length} remaining)`;
    btn.style.cssText = `
      display:block; width:100%; margin-top:10px; padding:8px;
      background:transparent; border:1px solid #ccc; border-radius:6px;
      cursor:pointer; color:#555; font-size:13px;
    `;
    btn.onmouseover = () => btn.style.background = "#f5f5f5";
    btn.onmouseout  = () => btn.style.background = "transparent";
    btn.onclick = () => {
      activityFeedState.page++;
      renderActivityPage();
    };
    container.appendChild(btn);
  }
}

async function loadActivityFeed() {
  const container = $("activityLog");
  if (!container) return;

  // Reset pagination on fresh load
  activityFeedState.page = 0;
  activityFeedState.allItems = [];
  activityFeedState.loaded = false;

  container.innerHTML = `<div class="activity-item"><div class="description"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div></div>`;

  try {
    // Build a profile map so we can display names instead of emails everywhere
    const { data: profiles, error: pe } = await supabaseClient
      .from("profiles")
      .select("id, full_name, email, deleted_at");

    if (pe) throw pe;

    const idToName = {};
    const emailToName = {};
    (profiles || []).forEach((p) => {
      const name = p.full_name || p.email || "Unknown";
      idToName[p.id] = { name, deleted_at: p.deleted_at, email: p.email };
      if (p.email) emailToName[p.email] = name;
    });

    activityFeedState.profileMap = idToName;
    activityFeedState.emailMap   = emailToName;

    // Platform activity (admin actions, assignments, ticket updates, etc.)
    const { data: act, error } = await supabaseClient
      .from("platform_activity")
      .select(
        "id, module, action, description, created_at, actor_id, target_user_id",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const platformItems = (act || [])
      .filter((a) => {
        // Hide activity for archived users (either actor or target)
        const actor = a.actor_id ? idToName[a.actor_id] : null;
        const target = a.target_user_id ? idToName[a.target_user_id] : null;
        if (actor?.deleted_at) return false;
        if (target?.deleted_at) return false;
        return true;
      })
      .map((a) => {
        // Replace any known emails in description with full names
        let desc = a.description || "";
        Object.keys(emailToName).forEach((em) => {
          // Replace all occurrences safely
          desc = desc.split(em).join(emailToName[em]);
        });
        return {
          kind: "platform",
          module: a.module,
          action: a.action,
          created_at: a.created_at,
          description: maskPII(desc),
        };
      });

    // Health logs should also appear in the activity feed
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [bpRes, weightRes, glucoseRes, apptRes] = await Promise.all([
      supabaseClient
        .from("bp_logs")
        .select("user_id, systolic, diastolic, created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseClient
        .from("weight_logs")
        .select("user_id, weight, created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseClient
        .from("glucose_logs")
        .select("user_id, level, created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseClient
        .from("appointments")
        .select("user_id, patient_name, doctor_name, type, status, created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const healthItems = [];

    (bpRes.data || []).forEach((x) => {
      const user = idToName[x.user_id];
      if (user?.deleted_at) return; // hide archived users
      const name = user?.name || user?.email || "Unknown User";
      
      // 🔒 Mask the raw systolic/diastolic numbers
      healthItems.push({
        kind: "health",
        module: "health",
        action: "bp",
        created_at: x.created_at,
        description: `${maskName(name)} logged BP ***/*** mmHg`,
      });
    });

    (weightRes.data || []).forEach((x) => {
      const user = idToName[x.user_id];
      if (user?.deleted_at) return;
      const name = user?.name || user?.email || "Unknown User";
      if (x.weight == null) return;
      
      // 🔒 Mask the raw weight values
      healthItems.push({
        kind: "health",
        module: "health",
        action: "weight",
        created_at: x.created_at,
        description: `${maskName(name)} logged weight *** kg`,
      });
    });

    (glucoseRes.data || []).forEach((x) => {
      const user = idToName[x.user_id];
      if (user?.deleted_at) return;
      const name = user?.name || user?.email || "Unknown User";
      if (x.level == null) return;
      
      // 🔒 Mask the raw glucose levels
      healthItems.push({
        kind: "health",
        module: "health",
        action: "glucose",
        created_at: x.created_at,
        description: `${maskName(name)} logged glucose *** mg/dL`,
      });
    });

    const apptItems = [];
    (apptRes.data || []).forEach((x) => {
      const patientName = x.patient_name || idToName[x.user_id]?.name || idToName[x.user_id]?.email || "Unknown Patient";
      const doctorName  = x.doctor_name || "Unknown Doctor";
      const apptType    = x.type || "appointment";
      
      // 🔒 Clean any stray digits inside appointment formats
      const cleanApptType = apptType.replace(/\d+/g, '***');
      
      apptItems.push({
        kind: "appointment",
        module: "appointments",
        action: "created",
        created_at: x.created_at,
        description: `${maskName(patientName)} booked a ${cleanApptType} with Dr. ${maskName(doctorName)}`,
      });
    });
    
    // Merge + sort by time (no slice — keep all for pagination)
    activityFeedState.allItems = [...platformItems, ...healthItems, ...apptItems]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    activityFeedState.loaded = true;
    renderActivityPage();

  } catch (err) {
    console.error("loadActivityFeed error:", err);
    container.innerHTML =
      '<div class="activity-item"><div class="description">Error loading activity.</div></div>';
  }
}

async function logAdminAction({
  module,
  action,
  target_user_id = null,
  description,
  reason,
}) {
  // Write both admin audit log (more detailed) and platform activity (user-facing feed)
  const nowIso = new Date().toISOString();

  const auditPayload = {
    admin_id: state.currentAdminId,
    target_user_id,
    module,
    action,
    reason,
    created_at: nowIso,
  };

  const activityPayload = {
    actor_id: state.currentAdminId,
    target_user_id,
    module,
    action,
    description,
    created_at: nowIso,
  };

  // Best effort (don’t block UI if one fails, but log it)
  const [a1, a2] = await Promise.all([
    supabaseClient.from("admin_audit_log").insert(auditPayload),
    supabaseClient.from("platform_activity").insert(activityPayload),
  ]);

  if (a1.error) console.warn("admin_audit_log insert failed:", a1.error);
  if (a2.error) console.warn("platform_activity insert failed:", a2.error);
}

/* =========================
   12) WEEKLY CHART (Multi-type)
   ========================= */
async function loadWeeklyChart() {
  const chart = $("weeklyChart");
  if (!chart) return;

  chart.innerHTML = `<div class="chart-empty-msg"><i class="fa-solid fa-spinner fa-spin"></i> Loading chart...</div>`;

  try {
    const today = new Date();

    // Build last 7 days as YYYY-MM-DD strings in LOCAL time
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      // Format as local date string YYYY-MM-DD
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${yyyy}-${mm}-${dd}`);
    }

    // weekStart = beginning of earliest day in UTC
    const weekStart = new Date(days[0] + "T00:00:00").toISOString();

    // Fetch all data sources in parallel
    const [bpRes, weightRes, glucoseRes, usersRes, ticketsRes, apptRes] = await Promise.all([
      supabaseClient.from("bp_logs").select("created_at").gte("created_at", weekStart),
      supabaseClient.from("weight_logs").select("created_at").gte("created_at", weekStart),
      supabaseClient.from("glucose_logs").select("created_at").gte("created_at", weekStart),
      supabaseClient.from("profiles").select("created_at").gte("created_at", weekStart),
      supabaseClient.from("tickets").select("created_at").gte("created_at", weekStart),
      supabaseClient.from("appointments").select("created_at").gte("created_at", weekStart),
    ]);

    // Convert UTC timestamp to local YYYY-MM-DD string for matching
    function toLocalDateStr(isoStr) {
      const d = new Date(isoStr);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    // Count rows per day using local date string matching
    function countPerDay(rows) {
      const counts = Array(7).fill(0);
      (rows || []).forEach((r) => {
        const localDate = toLocalDateStr(r.created_at);
        const idx = days.indexOf(localDate);
        if (idx !== -1) counts[idx]++;
      });
      return counts;
    }

    const healthCounts = countPerDay([
      ...(bpRes.data || []),
      ...(weightRes.data || []),
      ...(glucoseRes.data || []),
    ]);
    const userCounts   = countPerDay(usersRes.data || []);
    const ticketCounts = countPerDay(ticketsRes.data || []);
    const apptCounts   = countPerDay(apptRes.data || []);

    const allValues = [...healthCounts, ...userCounts, ...ticketCounts, ...apptCounts];
    const maxVal = Math.max(...allValues, 1);

    // Day labels derived from actual dates (not hardcoded Mon-Sun)
    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const BAR_MAX_H = 160;

    const hasAnyData = allValues.some((v) => v > 0);
    if (!hasAnyData) {
      chart.innerHTML = `<div class="chart-empty-msg">No activity recorded this week yet.</div>`;
      const totalRow = $("chartTotalRow");
      if (totalRow) totalRow.innerHTML = "";
      return;
    }

    chart.innerHTML = days.map((dateStr, i) => {
      const h = healthCounts[i];
      const u = userCounts[i];
      const t = ticketCounts[i];
      const ap = apptCounts[i];
      const total = h + u + t + ap;

      const hh  = h  > 0 ? Math.max(6, Math.round((h  / maxVal) * BAR_MAX_H)) : 0;
      const uh  = u  > 0 ? Math.max(6, Math.round((u  / maxVal) * BAR_MAX_H)) : 0;
      const th  = t  > 0 ? Math.max(6, Math.round((t  / maxVal) * BAR_MAX_H)) : 0;
      const aph = ap > 0 ? Math.max(6, Math.round((ap / maxVal) * BAR_MAX_H)) : 0;

      const healthBar = h  > 0 ? `<div class="day-bar" style="height:${hh}px;background:#2daa2d;"   title="Health logs: ${h}"></div>`   : `<div class="day-bar" style="height:0;background:transparent;"></div>`;
      const userBar   = u  > 0 ? `<div class="day-bar" style="height:${uh}px;background:#3b82f6;"   title="New users: ${u}"></div>`     : `<div class="day-bar" style="height:0;background:transparent;"></div>`;
      const ticketBar = t  > 0 ? `<div class="day-bar" style="height:${th}px;background:#f59e0b;"   title="Tickets: ${t}"></div>`       : `<div class="day-bar" style="height:0;background:transparent;"></div>`;
      const apptBar   = ap > 0 ? `<div class="day-bar" style="height:${aph}px;background:#8b5cf6;"  title="Appointments: ${ap}"></div>` : `<div class="day-bar" style="height:0;background:transparent;"></div>`;

      // Get actual day name from the date string
      const dayName = dayLabels[new Date(dateStr + "T12:00:00").getDay()];
      const dayNum  = parseInt(dateStr.split("-")[2], 10);

      return `
        <div class="day-group">
          <div class="day-bars">
            ${healthBar}${userBar}${ticketBar}${apptBar}
          </div>
          <div class="day-label">${dayName}</div>
          <div class="day-total">${total > 0 ? dayNum : ""}</div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("loadWeeklyChart error:", err);
    chart.innerHTML = `<div class="chart-empty-msg">Error loading chart data.</div>`;
  }
}

/* =========================
   13) SUPPORT TICKETS
   ========================= */
async function loadTickets() {
  const tbody = $("ticketTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">Refreshing tickets...</td>
    </tr>
  `;

  const { data, error } = await supabaseClient
    .from("tickets")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state" style="color:red">Error loading tickets</td></tr>';
    return;
  }

  state.allTickets = data || [];
  applyTicketFilters();
  updateTicketStats(state.allTickets);
}

function applyTicketFilters() {
  const term = $("ticketSearch")?.value?.trim().toLowerCase() || "";
  const priority = $("priorityFilter")?.value || "all";
  const status = $("ticketStatusFilter")?.value || "all";

  let filtered = [...state.allTickets];

  if (term) {
    filtered = filtered.filter(
      (t) =>
        (t.subject || "").toLowerCase().includes(term) ||
        (t.user || t.user_name || "").toLowerCase().includes(term) ||
        (t.id || "").toLowerCase().includes(term),
    );
  }
  if (priority !== "all")
    filtered = filtered.filter((t) => t.priority === priority);
  if (status !== "all") filtered = filtered.filter((t) => t.status === status);

  renderTickets(filtered);
}

function updateTicketStats(tickets) {
  const open = tickets.filter((t) => t.status === "open").length;
  const progress = tickets.filter((t) => t.status === "progress").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;

  $("openTickets").textContent = String(open);
  $("progressTickets").textContent = String(progress);
  $("resolvedTickets").textContent = String(resolved);

  // Avg response: created_at -> updated_at for non-open
  const responded = tickets.filter(
    (t) => t.status !== "open" && t.created_at && t.updated_at,
  );
  if (!responded.length) {
    $("avgResponse").textContent = "N/A";
    return;
  }

  const avgMs =
    responded.reduce(
      (sum, t) => sum + (new Date(t.updated_at) - new Date(t.created_at)),
      0,
    ) / responded.length;
  const hours = avgMs / (1000 * 60 * 60);

  if (hours < 1)
    $("avgResponse").textContent = `${Math.max(1, Math.round(hours * 60))}m`;
  else if (hours < 24) $("avgResponse").textContent = `${hours.toFixed(1)}h`;
  else $("avgResponse").textContent = `${Math.round(hours / 24)}d`;
}

function renderTickets(tickets) {
  const tbody = $("ticketTableBody");
  tbody.innerHTML = "";

  if (!tickets.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state">No tickets found.</td></tr>';
    return;
  }

  const priorityOrder = { high: 1, medium: 2, low: 3 };
  const sorted = [...tickets].sort((a, b) => {
    const p =
      (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9);
    if (p !== 0) return p;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  sorted.forEach((t) => {
    const row = document.createElement("tr");
    row.dataset.ticketId = t.id;
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectTicketRow(t.id);
    });

    const borderColor =
      t.priority === "high"
        ? "#e74c3c"
        : t.priority === "medium"
          ? "#f39c12"
          : "#27ae60";

    row.innerHTML = `
<td style="border-left: 4px solid ${borderColor};"><strong>${escapeHtml((t.id || "").substring(0, 8))}</strong></td>
      <td>${escapeHtml(t.user || t.user_name || "Unknown")}</td>
      <td>${escapeHtml(t.subject || "")}</td>
      <td><select class="priority-select"
        onchange="updateTicketPriority('${t.id}', this.value)">
  <option value="low" ${t.priority === "low" ? "selected" : ""}>Low</option>
  <option value="medium" ${t.priority === "medium" ? "selected" : ""}>Medium</option>
  <option value="high" ${t.priority === "high" ? "selected" : ""}>High</option>
</select></td>
      <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status === "progress" ? "IN PROGRESS" : (t.status || "").toUpperCase())}</span></td>
      <td><small>${escapeHtml(formatDateTime(t.created_at))}</small></td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-view" type="button" onclick="AdminApp.viewTicket('${t.id}')">View</button>
          <button class="btn btn-edit" type="button" onclick="AdminApp.updateTicketStatus('${t.id}','${nextTicketStatus(t.status)}')">${ticketActionLabel(t.status)}</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
  syncSelectedTicketStyles();
}

function nextTicketStatus(status) {
  if (status === "open") return "progress";
  if (status === "progress") return "resolved";
  if (status === "resolved") return "open";
  return "open";
}

function ticketActionLabel(status) {
  if (status === "open") return "In Progress";
  if (status === "progress") return "Resolve";
  if (status === "resolved") return "Reopen";
  return "Update";
}

async function updateTicketStatus(ticketId, newStatus) {
  const ticket = state.allTickets.find((t) => t.id === ticketId);
  if (!ticket) return;

  const reason = prompt(
    `Reason to set ticket to "${newStatus}" (for audit/activity):`,
  );
  if (!reason) return;

  if (!confirm(`Update ticket ${ticketId.substring(0, 8)} to ${newStatus}?`))
    return;

  try {
    const { error } = await supabaseClient
      .from("tickets")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", ticketId);

    if (error) throw error;

    await logAdminAction({
      module: "tickets",
      action: newStatus === "open" ? "reopened" : newStatus,
      target_user_id: null,
      description: `${state.currentAdminName} moved ticket #${ticketId.substring(0, 8)} to ${newStatus === "open" ? "re-opened" : newStatus}.`,
      reason,
    });

    await loadTickets();
    await loadActivityFeed();
  } catch (err) {
    console.error("updateTicketStatus error:", err);
    alert(`❌ Failed to update ticket: ${err.message}`);
  }
}

async function viewTicket(ticketId) {
  const ticket = state.allTickets.find((t) => t.id === ticketId);
  if (!ticket) return;

  show($("ticketPanel"));
  $("ticketPanel").dataset.ticketId = ticketId;
  $("ticketReply").value = "";

  const thread = $("ticketThread");
  thread.innerHTML = `
    <div class="activity-item">
      <div class="time">Created: ${escapeHtml(formatDateTime(ticket.created_at))}</div>
      <div class="description"><strong>${escapeHtml(ticket.subject || "")}</strong></div>
      <div class="description">${escapeHtml(ticket.description || "")}</div>
    </div>
  `;

  // Load all previous replies so thread persists across open/close
  try {
    const { data: replies, error } = await supabaseClient
      .from("ticket_replies")
      .select("message, created_at, admin_id")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Could not load ticket replies:", error.message);
      return;
    }

    (replies || []).forEach((r) => {
      const item = document.createElement("div");
      item.className = "activity-item";
      item.innerHTML = `
        <div class="time"><i class="fa-solid fa-clock"></i> ${escapeHtml(formatDateTime(r.created_at))}</div>
        <div class="description"><i class="fa-solid fa-comment"></i> Admin: ${escapeHtml(r.message)}</div>
      `;
      thread.appendChild(item);
    });
  } catch (err) {
    console.warn("viewTicket replies fetch error:", err);
  }
}

function closeTicketPanel() {
  hide($("ticketPanel"));
  $("ticketPanel").dataset.ticketId = "";
}

async function sendTicketReply() {
  const ticketId = $("ticketPanel")?.dataset?.ticketId;
  if (!ticketId) return;

  const message = $("ticketReply").value.trim();
  if (!message) {
    alert("Please type a reply.");
    return;
  }

  const reason = "Ticket reply sent";
  try {
    const { error: replyError } = await supabaseClient
      .from("ticket_replies")
      .insert({
        ticket_id: ticketId,
        admin_id: state.currentAdminId,
        message,
        created_at: new Date().toISOString(),
      });

    if (replyError) {
      console.error("ticket_replies insert failed:", replyError.message);
      alert(`❌ Reply could not be saved: ${replyError.message}\n\nPlease ensure the ticket_replies table exists in Supabase.`);
      return;
    }

    // Bump updated_at on the ticket
    await supabaseClient
      .from("tickets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", ticketId);

    await logAdminAction({
      module: "tickets",
      action: "replied",
      target_user_id: null,
      description: `${state.currentAdminName} replied on ticket #${ticketId.substring(0, 8)}.`,
      reason,
    });

    const item = document.createElement("div");
    item.className = "activity-item";
    item.innerHTML = `
      <div class="time"><i class="fa-solid fa-clock"></i> ${escapeHtml(timeAgo(new Date().toISOString()))}</div>
      <div class="description"><i class="fa-solid fa-comment"></i> Admin: ${escapeHtml(message)}</div>
    `;
    $("ticketThread").appendChild(item);
    $("ticketReply").value = "";

    await loadActivityFeed();
  } catch (err) {
    console.error("sendTicketReply error:", err);
    alert(`❌ Failed to send reply: ${err.message}`);
  }
}

/* =========================
   14) DOCTOR WORKFLOWS
   ========================= */
async function loadDoctors() {
  const container = $("doctorList");
  if (!container) return;
  container.textContent = "Loading...";

  // 1. Fetch doctors from profiles table
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, role, status, deleted_at")
    .eq("role", "doctor")
    .order("full_name", { ascending: true });

  if (error) {
    container.textContent = "Error loading doctors";
    return;
  }

  // 2. Fetch verification statuses from doctor_profiles table
  const { data: docProfs } = await supabaseClient
    .from("doctor_profiles")
    .select("id, is_verified");
    
  const verifiedMap = {};
  (docProfs || []).forEach(dp => verifiedMap[dp.id] = dp.is_verified);

  // 3. Fetch hospital memberships for all doctors
  const doctorIds = (data || []).map(d => d.id);
  const { data: memberships } = await supabaseClient
    .from("hospital_doctor_memberships")
    .select("doctor_id, hospitals(name, is_default)")
    .in("doctor_id", doctorIds)
    .eq("status", "active");

  const hospitalMap = {};
  (memberships || []).forEach(m => {
    hospitalMap[m.doctor_id] = m.hospitals?.name || "Instadoc Hospital";
  });

  // 4. Map verification status and hospital to the main array
  state.allDoctors = (data || []).filter((d) => !d.deleted_at).map(d => ({
    ...d,
    is_verified: !!verifiedMap[d.id],
    hospital_name: hospitalMap[d.id] || "Instadoc Hospital"
  }));

  filterDoctors();
}

function filterDoctors() {
  const term = $("doctorSearch")?.value?.trim().toLowerCase() || "";
  let list = [...state.allDoctors];
  if (term) {
    list = list.filter(
      (d) =>
        (d.full_name || "").toLowerCase().includes(term) ||
        (d.email || "").toLowerCase().includes(term),
    );
  }
  renderDoctorList(list);
}

function renderDoctorList(doctors) {
  const container = $("doctorList");
  container.innerHTML = "";

  if (!doctors.length) {
    container.textContent = "No doctors found.";
    return;
  }

  doctors.forEach((d) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.style.cursor = "pointer";
    const status = normalizeUserStatus(d);
    const isSelected = state.selectedDoctorId === d.id;
    if (isSelected) item.style.background = "#f0fdf4";

    const verifiedBadge = d.is_verified
      ? `<span class="badge badge-active" style="font-size:10px; margin-left:8px;">Verified</span>`
      : `<span class="badge badge-suspended" style="font-size:10px; margin-left:8px;">Pending</span>`;

    const verifyBtnText  = d.is_verified ? "Revoke" : "Verify";
    const verifyBtnClass = d.is_verified ? "btn-inactive" : "btn-activate";

    const isDefaultHospital = d.hospital_name === "Instadoc Hospital";
    const hospitalBadge = isDefaultHospital
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:9999px;background:#dbeafe;color:#1d4ed8;font-weight:600;white-space:nowrap;">Instadoc Hospital</span>`
      : `<span style="font-size:10px;padding:2px 7px;border-radius:9999px;background:#f0fdf4;color:#16a34a;font-weight:600;white-space:nowrap;">${escapeHtml(d.hospital_name)}</span>`;

    item.innerHTML = `
      <div class="meta" style="flex:1;">
        <div class="title" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${escapeHtml(d.full_name || "Doctor")} ${verifiedBadge}
        </div>
        <div class="sub" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:3px;">
          <span>${escapeHtml(d.email || "")} • ${escapeHtml(status)}</span>
          ${hospitalBadge}
        </div>
      </div>
      <div class="right">
        <button class="btn ${verifyBtnClass}" type="button" id="verify-btn-${d.id}">${verifyBtnText}</button>
        <button class="btn btn-activate add-patients-btn" type="button" id="add-btn-${d.id}"
                style="display:flex; align-items:center; gap:5px;">
            <i class="fa-solid fa-user-plus"></i> Add Patients
        </button>
      </div>
    `;

    // Clicking the row (but not buttons) selects the doctor and loads patients on the right
    item.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectDoctor(d);
      // Highlight selected row
      document.querySelectorAll("#doctorList .list-item").forEach(el => el.style.background = "");
      item.style.background = "#f0fdf4";
    });

    // Verify/Revoke button
    item.querySelector(`#verify-btn-${d.id}`)
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        AdminApp.toggleVerifyDoctor(d.id, d.is_verified);
      });

    // Add Patients button → navigates to dedicated page
    item.querySelector(`#add-btn-${d.id}`)
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        window.location.href = `assign-patients.html?doctor=${d.id}`;
      });

    container.appendChild(item);
  });
}

async function toggleVerifyDoctor(doctorId, currentStatus) {
  const newStatus = !currentStatus;
  const actionWord = newStatus ? "Verify" : "Revoke verification for";

  if (!confirm(`Are you sure you want to ${actionWord} this doctor?`)) return;

  try {
    // Upsert ensures it works even if the doctor hasn't logged in to create their profile yet
    const { error } = await supabaseClient
        .from('doctor_profiles')
        .upsert({ id: doctorId, is_verified: newStatus });

    if (error) throw error;

    // Push to the Activity Feed & Audit Log
    await logAdminAction({
      module: "doctors",
      action: newStatus ? "updated" : "suspended", 
      target_user_id: doctorId,
      description: `${state.currentAdminName} ${newStatus ? 'verified' : 'revoked verification for'} doctor.`,
      reason: "Admin verification toggle",
    });

    alert(`✅ Doctor successfully ${newStatus ? 'verified' : 'revoked'}.`);
    
    await loadDoctors();
    await loadActivityFeed();
  } catch (err) {
    console.error("toggleVerifyDoctor error:", err);
    alert(`❌ Failed to update verification: ${err.message}`);
  }
}

async function selectDoctor(doctor) {
  state.selectedDoctorId = doctor.id;
  state.selectedDoctorName = doctor.full_name || "Doctor";
  state.selectedDoctorEmail = doctor.email || "";

  await loadAssignmentsForDoctor(doctor.id);
}

async function loadAssignmentsForDoctor(doctorId) {
  const list = $("patientList");
  list.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#9ca3af;font-size:0.82rem;">
    <i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i>Loading...
  </div>`;

  const { data, error } = await supabaseClient
    .from("doctor_patient_assignments")
    .select("id, doctor_id, patient_id, assigned_at")
    .eq("doctor_id", doctorId)
    .order("assigned_at", { ascending: false });

  if (error) {
    list.innerHTML = `<div style="padding:1rem;color:#dc2626;font-size:0.82rem;">
      <i class="fa-solid fa-circle-xmark" style="margin-right:5px;"></i>Error: ${escapeHtml(error.message)}
    </div>`;
    return;
  }

  state.assignments = data || [];

  // Update count pill
  const pill = $("assigned-count-pill");
  if (pill) {
    pill.textContent = `${state.assignments.length} patient${state.assignments.length !== 1 ? 's' : ''}`;
    pill.style.display = state.assignments.length > 0 ? "inline" : "none";
  }

  // Show/hide Unassign All button based on whether there are assignments
  const unassignAllBtn = $("unassignAllBtn");
  if (unassignAllBtn) {
    unassignAllBtn.style.display = state.assignments.length > 0 ? "flex" : "none";
  }

  if (!state.assignments.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:2.5rem 1rem;color:#9ca3af;">
        <i class="fa-solid fa-user-slash" style="font-size:1.8rem;margin-bottom:0.6rem;display:block;opacity:0.35;"></i>
        <p style="font-size:0.82rem;font-weight:500;color:#374151;">No patients assigned yet</p>
        <p style="font-size:0.75rem;margin-top:3px;">Click <strong>Add Patients</strong> next to this doctor to get started.</p>
      </div>`;
    return;
  }

  const patientIds = state.assignments.map((a) => a.patient_id);
  const { data: patients, error: pe } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, status, deleted_at")
    .in("id", patientIds);

  if (pe) {
    list.innerHTML = `<div style="padding:1rem;color:#dc2626;font-size:0.82rem;">Error resolving patients.</div>`;
    return;
  }

  const patientMap = {};
  (patients || []).forEach((p) => (patientMap[p.id] = p));
  renderAssignedPatients(patientMap);
}

function renderAssignedPatients(patientMap) {
  const list = $("patientList");
  list.innerHTML = "";

  const assignments = state.assignments;
  if (!assignments.length) return;

  assignments.forEach((a) => {
    const p = patientMap[a.patient_id];
    const displayName = p?.full_name || p?.email || "Unknown Patient";
    const email = p?.email || "";
    const initials = displayName.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase() || "?";
    const assignedDate = a.assigned_at
      ? new Date(a.assigned_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
      : "—";

    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:0.75rem;padding:0.7rem 0.85rem;border-bottom:1px solid #f3f4f6;transition:background 0.12s;";
    item.onmouseover = () => item.style.background = "#f9fafb";
    item.onmouseout  = () => item.style.background = "";

    item.innerHTML = `
      <div style="width:36px;height:36px;border-radius:50%;background:#ede9fe;
                  display:flex;align-items:center;justify-content:center;
                  font-weight:700;color:#7c3aed;font-size:0.78rem;flex-shrink:0;">
        ${escapeHtml(initials)}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.84rem;color:#1a1a2e;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(displayName)}
        </div>
        <div style="font-size:0.72rem;color:#9ca3af;">
          ${escapeHtml(email)}
          <span style="margin:0 4px;color:#d1d5db;">&middot;</span>
          <i class="fa-regular fa-clock" style="font-size:0.65rem;margin-right:3px;"></i>${assignedDate}
        </div>
      </div>
      <button type="button"
        style="flex-shrink:0;padding:4px 11px;background:#fff;color:#dc2626;
               border:1.5px solid #fca5a5;border-radius:7px;font-size:0.75rem;
               font-weight:600;cursor:pointer;font-family:inherit;
               display:flex;align-items:center;gap:4px;"
        onmouseover="this.style.background='#fef2f2'"
        onmouseout="this.style.background='#fff'">
        <i class="fa-solid fa-xmark"></i> Remove
      </button>
    `;

    item.querySelector("button")
      ?.addEventListener("click", () => unassignPatient(a.id, a.patient_id));
    list.appendChild(item);
  });
}

function openAssignPatientModal() {
  const doctorId = state.selectedDoctorId;
  window.location.href = doctorId
    ? `assign-patients.html?doctor=${doctorId}`
    : "assign-patients.html";
}

function closeAssignPatientModal() {
  hide($("assignPatientModal"));
}

async function loadPatientPicker() {
  const box = $("patientPickerList");
  box.textContent = "Loading...";

  // Patients not archived + role=patient
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, role, status, deleted_at")
    .eq("role", "patient")
    .order("full_name", { ascending: true });

  if (error) {
    box.textContent = "Error loading patients";
    return;
  }

  // Exclude archived
  const patients = (data || []).filter((p) => !p.deleted_at);

  // Exclude already assigned to this doctor
  const assignedIds = new Set(state.assignments.map((a) => a.patient_id));
  state.patientPicker = patients.filter((p) => !assignedIds.has(p.id));

  renderPatientPicker();
}

function renderPatientPicker() {
  const box = $("patientPickerList");
  const term = $("patientSearch")?.value?.trim().toLowerCase() || "";

  let list = [...state.patientPicker];
  if (term) {
    list = list.filter(
      (p) =>
        (p.full_name || "").toLowerCase().includes(term) ||
        (p.email || "").toLowerCase().includes(term),
    );
  }

  box.innerHTML = "";

  if (!list.length) {
    box.textContent =
      "No available patients found (or all patients already assigned).";
    return;
  }

  list.slice(0, 200).forEach((p) => {
    const item = document.createElement("div");
    item.className = "list-item";
    const status = normalizeUserStatus(p);

    item.innerHTML = `
      <div class="meta">
        <div class="title">${escapeHtml(p.full_name || "Patient")}</div>
        <div class="sub">${escapeHtml(p.email || "")} • ${escapeHtml(status)}</div>
      </div>
      <div class="right">
        <button class="btn btn-activate" type="button">Assign</button>
      </div>
    `;

    item
      .querySelector("button")
      ?.addEventListener("click", () => assignPatientToDoctor(p));
    box.appendChild(item);
  });
}

async function assignPatientToDoctor(patient) {
  const doctorId = state.selectedDoctorId;
  if (!doctorId) return;

  const reason = prompt("Reason to assign this patient (required for audit):");
  if (!reason) return;

  if (
    !confirm(
      `Assign ${patient.full_name || patient.email} to ${state.selectedDoctorName}?`,
    )
  )
    return;

  try {
    const { error } = await supabaseClient
      .from("doctor_patient_assignments")
      .insert({
        doctor_id: doctorId,
        patient_id: patient.id,
        assigned_by: state.currentAdminId,
        assigned_at: new Date().toISOString(),
      });

    if (error) throw error;

    await logAdminAction({
      module: "doctors",
      action: "assigned_patient",
      target_user_id: doctorId,
      description: `${state.currentAdminName} assigned ${patient.full_name || patient.email} to Dr. ${state.selectedDoctorName || state.selectedDoctorEmail}.`,
      reason,
    });

    await loadAssignmentsForDoctor(doctorId);
    await loadActivityFeed();
    await loadPatientPicker();
  } catch (err) {
    console.error("assignPatientToDoctor error:", err);
    alert(`❌ Failed to assign patient: ${err.message}`);
  }
}

async function unassignPatient(assignmentId, patientId) {
  const reason = prompt(
    "Reason to unassign this patient (required for audit):",
  );
  if (!reason) return;

  if (!confirm("Unassign this patient from the selected doctor?")) return;

  try {
    const { error } = await supabaseClient
      .from("doctor_patient_assignments")
      .delete()
      .eq("id", assignmentId);

    if (error) throw error;

    await logAdminAction({
      module: "doctors",
      action: "unassigned_patient",
      target_user_id: state.selectedDoctorId,
      description: `${state.currentAdminName} unassigned a patient from Dr. ${state.selectedDoctorName || state.selectedDoctorEmail}.`,
      reason,
    });

    await loadAssignmentsForDoctor(state.selectedDoctorId);
    await loadActivityFeed();
  } catch (err) {
    console.error("unassignPatient error:", err);
    alert(`❌ Failed to unassign: ${err.message}`);
  }
}

async function unassignAllFromDoctor() {
  if (!state.selectedDoctorId) return;

  const reason = prompt(
    "Reason to unassign ALL patients (required for audit):",
  );
  if (!reason) return;

  if (!confirm(`Unassign ALL patients from ${state.selectedDoctorName}?`))
    return;

  try {
    const { error } = await supabaseClient
      .from("doctor_patient_assignments")
      .delete()
      .eq("doctor_id", state.selectedDoctorId);

    if (error) throw error;

    await logAdminAction({
      module: "doctors",
      action: "unassigned_all",
      target_user_id: state.selectedDoctorId,
      description: `${state.currentAdminName} unassigned all patients from Dr. ${state.selectedDoctorName || state.selectedDoctorEmail}.`,
      reason,
    });

    await loadAssignmentsForDoctor(state.selectedDoctorId);
    await loadActivityFeed();
  } catch (err) {
    console.error("unassignAllFromDoctor error:", err);
    alert(`❌ Failed to unassign all: ${err.message}`);
  }
}

/* =========================
   15) REALTIME
   ========================= */
function setupRealtime() {
  // Listen for force-logout broadcast targeting THIS admin's own session
  // (relevant if another admin suspends/archives this admin account)
  if (state.currentAdminId) {
    supabaseClient
      .channel(`force-logout:${state.currentAdminId}`)
      .on("broadcast", { event: "force_logout" }, async () => {
        clearInterval(state._sessionWatcher);
        await supabaseClient.auth.signOut();
        resetState();
        showLogin();
        showAlert("Your account has been suspended or archived by an administrator.");
      })
      .subscribe();
  }

  // Activity feed updates
  supabaseClient
    .channel("realtime-admin-dashboard")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "platform_activity" },
      () => {
        // Keep activity feed fresh
        loadActivityFeed();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles" },
      () => {
        // Refresh users list when profiles change
        loadUsers();
        loadMetrics();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tickets" },
      () => {
        loadTickets();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "doctor_patient_assignments" },
      (payload) => {
        // If viewing a doctor, refresh assignment list
        if (state.selectedDoctorId) {
          loadAssignmentsForDoctor(state.selectedDoctorId);
        }
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") {
        console.warn("Realtime status:", status);
      }
    });
}

/* =========================
   16) GLOBAL EXPORT (for inline onclick)
   ========================= */
window.AdminApp = {
  viewUser,
  editUser,
  closeUserModal,
  changeUserStatus,
  archiveUser,
  restoreUser,
  viewTicket,
  updateTicketStatus,
  updateTicketPriority,
  toggleVerifyDoctor
};

// Hospital functions used via inline onclick in HTML
window.openCreateHospitalModal = openCreateHospitalModal;
window.openEditHospitalModal   = openEditHospitalModal;
window.toggleHospitalStatus    = toggleHospitalStatus;
window.applyHospitalFilters    = applyHospitalFilters;
window.onNewUserRoleChange     = onNewUserRoleChange;
window.openInviteDoctorModal   = openInviteDoctorModal;
window.filterInviteDoctorList  = filterInviteDoctorList;
window.sendDoctorInvite        = sendDoctorInvite;

// Utility functions used in inline HTML onclick attributes
window.hide = hide;
window.show = show;
window.$    = $;

// Dropdown helpers
window.toggleDropdown = function(btn) {
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    btn.classList.add('active');
  }
};
window.closeAllDropdowns = function() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.btn-more.active').forEach(b => b.classList.remove('active'));
};
// Close dropdowns when clicking anywhere else
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown-wrap')) closeAllDropdowns();
});

/* =========================
   Init
   ========================= */
document.addEventListener("DOMContentLoaded", bootstrap);

// Show success toast when returning from create-user page
(function checkCreateSuccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('created') === '1') {
    const name = decodeURIComponent(params.get('name') || 'User');
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => showSuccessToast(`${name} created successfully!`), 800);
  }
  if (params.get('hospital_created') === '1') {
    const hname = decodeURIComponent(params.get('hname') || 'Hospital');
    const hcode = decodeURIComponent(params.get('hcode') || '');
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => {
      showSuccessToast(`${hname} (${hcode}) created successfully!`);
      // Switch to hospitals tab
      const hospitalsBtn = document.querySelector('.nav-tab[data-target="hospitals"]');
      if (hospitalsBtn) hospitalsBtn.click();
    }, 800);
  }
})();

function showSuccessToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:9999;display:flex;align-items:center;gap:8px;font-family:inherit;animation:slideUp 0.3s ease;';
  toast.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

async function updateTicketPriority(ticketId, newPriority) {
  try {
    const { error } = await supabaseClient
      .from("tickets")
      .update({ priority: newPriority })
      .eq("id", ticketId);

    if (error) throw error;

    await supabaseClient.from("platform_activity").insert({
      module: "tickets",
      action: "priority_change",
      actor_id: state.currentAdminId || null,
      target_user_id: null,
      description: `${state.currentAdminName} changed ticket #${ticketId.substring(0, 8)} priority to ${newPriority.toUpperCase()}.`,
      created_at: new Date().toISOString(),
    });

    await loadTickets();
    await loadActivityFeed();
  } catch (err) {
    console.error("Priority update failed:", err);
    alert(`❌ Failed to update priority: ${err.message}`);
  }
}

// --- BETA FEEDBACK FORM LOGIC (UNIVERSAL) ---
document.addEventListener('DOMContentLoaded', () => {
  const fab = document.getElementById('feedback-fab');
  const modal = document.getElementById('feedback-modal');
  const closeBtn = document.querySelector('.close-feedback');
  const form = document.getElementById('beta-feedback-form');
  const statusDiv = document.getElementById('feedback-status');
  const submitBtn = document.getElementById('submit-feedback-btn');

  if (!fab || !modal) return;

  fab.addEventListener('click', () => modal.classList.remove('hidden'));
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    const type = document.getElementById('feedback-type').value;
    const message = document.getElementById('feedback-text').value;
    
    try {
      // Intelligently find the correct Supabase client for this specific page
      const dbClient = window.supabaseClient || window._supabase || window.supabase;
      
      if (!dbClient) throw new Error("Supabase client not found on this page.");

      const { data: { user } } = await dbClient.auth.getUser();
      const userEmail = user ? user.email : 'Anonymous Tester';

      const { error } = await dbClient
        .from('beta_feedback')
        .insert([
          { type: type, message: message, user_email: userEmail }
        ]);

      if (error) throw error;

      statusDiv.textContent = "Thank you! Your feedback has been logged.";
      statusDiv.style.color = "green";
      form.reset();
      
      setTimeout(() => {
        modal.classList.add('hidden');
        statusDiv.textContent = "";
        submitBtn.textContent = 'Submit Report';
        submitBtn.disabled = false;
      }, 2000);

    } catch (error) {
      console.error('Error submitting feedback:', error);
      statusDiv.textContent = "Failed to send feedback. Please try again.";
      statusDiv.style.color = "red";
      submitBtn.textContent = 'Submit Report';
      submitBtn.disabled = false;
    }
  });
});

// ==========================================
// DOCTOR ACTIVITY MONITORING LOGIC
// ==========================================
let allDoctorActivity = [];

async function loadDoctorActivity() {
    const tbody = document.getElementById('admin-doctor-activity-body');
    if (!tbody) return;

    // 1. Fetch only verified doctor IDs to act as our strict security filter
    const { data: docs } = await supabaseClient.from('profiles').select('id').eq('role', 'doctor');
    const docIds = docs ? docs.map(d => d.id) : [];

    if (docIds.length === 0) {
         tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#9ca3af; padding: 1.5rem;">No doctors found in system.</td></tr>';
         return;
    }

    // 2. Fetch activity where a doctor is involved (as actor OR as target)
    // actor_id = doctor did something; target_user_id = admin acted on this doctor
    const { data: asActor } = await supabaseClient
        .from('platform_activity')
        .select('*')
        .in('actor_id', docIds)
        .neq('module', 'users')
        .neq('module', 'tickets')
        .order('created_at', { ascending: false })
        .limit(100);

    const { data: asTarget } = await supabaseClient
        .from('platform_activity')
        .select('*')
        .in('target_user_id', docIds)
        .neq('module', 'users')
        .neq('module', 'tickets')
        .order('created_at', { ascending: false })
        .limit(100);

    // Merge, deduplicate by id, sort newest first
    const seen = new Set();
    const merged = [...(asActor || []), ...(asTarget || [])].filter(row => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100);

    const data = merged;
    const error = null;


    if (error) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:#dc2626; text-align:center; padding: 1rem;">Error loading telemetry: ${error.message}</td></tr>`;
        return;
    }

    allDoctorActivity = data || [];
    renderDoctorActivity(allDoctorActivity);
}

// Map raw DB action values to human-readable labels
function formatActivityAction(action, description) {
    // Use description first if it's meaningful
    if (description && description.length > 3 && !description.includes('****')) {
        return description;
    }
    const map = {
        'assigned_patient':   'Patient assigned to doctor',
        'unassigned_patient': 'Patient removed from doctor',
        'updated':            'Doctor profile updated',
        'suspended':          'Doctor account suspended',
        'activated':          'Doctor account activated',
        'verified':           'Doctor verified by admin',
        'revoked':            'Doctor verification revoked',
        'confirmed':          'Appointment confirmed',
        'completed':          'Appointment completed',
        'cancelled':          'Appointment cancelled',
        'declined':           'Appointment declined',
        'created':            'New record created',
        'deleted':            'Record deleted',
        'login':              'Doctor logged in',
    };
    return map[action?.toLowerCase()] || action || 'Activity logged';
}

function getActivityBadge(action) {
    const a = (action || '').toLowerCase();
    if (['confirmed', 'activated', 'verified', 'assigned_patient'].includes(a))
        return { label: 'Success', style: 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;' };
    if (['cancelled', 'declined', 'suspended', 'unassigned_patient'].includes(a))
        return { label: 'Alert', style: 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;' };
    if (['completed'].includes(a))
        return { label: 'Completed', style: 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;' };
    if (['updated', 'revoked'].includes(a))
        return { label: 'Updated', style: 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;' };
    return { label: 'Logged', style: 'background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb;' };
}

function renderDoctorActivity(data) {
    const tbody = document.getElementById('admin-doctor-activity-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#9ca3af; padding: 1.5rem;">No recent doctor activity found.</td></tr>';
        return;
    }

    // Build a name lookup from allDoctors
    const nameMap = {};
    (state.allDoctors || []).forEach(d => {
        nameMap[d.id] = d.full_name || d.email || 'Unknown Doctor';
    });

    data.forEach(act => {
        const dateStr = new Date(act.created_at).toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Doctor name — prefer actor_id lookup, fallback to target
        const doctorId = act.actor_id || act.target_user_id;
        const doctorName = nameMap[doctorId] || 'Unknown Doctor';

        // Human-readable action
        const actionText = formatActivityAction(act.action, act.description);

        // Badge
        const badge = getActivityBadge(act.action);

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid #f3f4f6; transition: background 0.2s;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='transparent'">
                <td style="padding: 0.75rem; color: #6b7280; font-size: 0.8rem; white-space:nowrap;">${dateStr}</td>
                <td style="padding: 0.75rem; font-size: 0.85rem; font-weight: 600; color: #374151;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="width:28px;height:28px;border-radius:50%;background:#d1fae5;color:#065f46;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0;">
                            ${doctorName.charAt(0).toUpperCase()}
                        </div>
                        ${escapeHtml(doctorName)}
                    </div>
                </td>
                <td style="padding: 0.75rem; color: #1f2937; font-size: 0.85rem;">${escapeHtml(actionText)}</td>
                <td style="padding: 0.75rem;">
                    <span style="padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; white-space:nowrap; ${badge.style}">
                        ${badge.label}
                    </span>
                </td>
            </tr>
        `;
    });
}

function filterDoctorActivity() {
    const query = document.getElementById('admin-doc-search').value.toLowerCase();
    const filtered = allDoctorActivity.filter(act => {
        const uid = (act.user_id || act.actor_id || act.email || '').toLowerCase();
        const det = (act.details || act.action || act.event_type || '').toLowerCase();
        return uid.includes(query) || det.includes(query);
    });
    renderDoctorActivity(filtered);
}
/* =====================================================
   TENANCY — HOSPITAL MANAGEMENT
   ===================================================== */

// ---- State ----
state.allHospitals = [];

// ---- Helpers ----
function generateHospitalCode(name) {
    return name.trim().substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
}

// ---- Load all hospitals with manager + member counts ----
async function loadHospitals() {
    const tbody = $('hospitalsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Loading...</td></tr>';

    const { data: hospitals, error } = await supabaseClient
        .from('hospitals')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:red">Error: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    state.allHospitals = hospitals || [];

    // Fetch member counts per hospital
    const ids = state.allHospitals.map(h => h.id);
    let doctorCounts = {}, patientCounts = {}, managerNames = {};

    if (ids.length) {
        // Count active doctors from hospital_doctor_memberships (the source of truth)
        const { data: memberships } = await supabaseClient
            .from('hospital_doctor_memberships')
            .select('hospital_id, status')
            .in('hospital_id', ids)
            .eq('status', 'active');

        (memberships || []).forEach(m => {
            doctorCounts[m.hospital_id] = (doctorCounts[m.hospital_id] || 0) + 1;
        });

        // Count patients from profiles.hospital_id (patients are still assigned this way)
        const { data: profiles } = await supabaseClient
            .from('profiles')
            .select('hospital_id, role, full_name, id')
            .in('hospital_id', ids)
            .is('deleted_at', null);

        (profiles || []).forEach(p => {
            if (p.role === 'patient') patientCounts[p.hospital_id] = (patientCounts[p.hospital_id] || 0) + 1;
        });

        // Resolve manager names
        for (const h of state.allHospitals) {
            if (h.manager_id) {
                const mgr = (profiles || []).find(p => p.id === h.manager_id);
                if (!mgr) {
                    // Manager may not have hospital_id set yet — fetch directly
                    const { data: mgrProfile } = await supabaseClient
                        .from('profiles')
                        .select('full_name')
                        .eq('id', h.manager_id)
                        .single();
                    managerNames[h.id] = mgrProfile?.full_name || 'Unknown';
                } else {
                    managerNames[h.id] = mgr.full_name;
                }
            }
        }
    }

    applyHospitalFilters(doctorCounts, patientCounts, managerNames);
}

function applyHospitalFilters(doctorCounts, patientCounts, managerNames) {
    // Allow calling without args (re-filter cached data)
    const _dc = doctorCounts || window._hdc || {};
    const _pc = patientCounts || window._hpc || {};
    const _mn = managerNames || window._hmn || {};
    window._hdc = _dc; window._hpc = _pc; window._hmn = _mn;

    const search = ($('hospitalSearch')?.value || '').trim().toLowerCase();
    const statusFilter = $('hospitalStatusFilter')?.value || 'all';

    let filtered = [...state.allHospitals];
    if (search) filtered = filtered.filter(h => h.name.toLowerCase().includes(search) || h.code.toLowerCase().includes(search));
    if (statusFilter !== 'all') filtered = filtered.filter(h => (h.status || 'active') === statusFilter);

    renderHospitals(filtered, _dc, _pc, _mn);
}

function renderHospitals(hospitals, doctorCounts, patientCounts, managerNames) {
    const tbody = $('hospitalsTableBody');
    tbody.innerHTML = '';

    if (!hospitals.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hospitals found.</td></tr>';
        return;
    }

    hospitals.forEach(h => {
        const status = h.status || 'active';
        const statusBadge = status === 'active'
            ? '<span class="badge badge-active">ACTIVE</span>'
            : '<span class="badge badge-suspended">SUSPENDED</span>';
        const managerDisplay = managerNames[h.id] || '<em style="color:#9ca3af">Not assigned</em>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong style="font-family:monospace;letter-spacing:1px;color:#2563eb">${escapeHtml(h.code)}</strong></td>
            <td><strong>${escapeHtml(h.name)}</strong></td>
            <td>${managerDisplay}</td>
            <td style="text-align:center">${doctorCounts[h.id] || 0}</td>
            <td style="text-align:center">${patientCounts[h.id] || 0}</td>
            <td>${statusBadge}</td>
            <td>${h.created_at ? escapeHtml(formatDate(h.created_at)) : 'N/A'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-edit" onclick="openEditHospitalModal('${h.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
                    <div class="dropdown-wrap">
                        <button class="btn btn-more" type="button" onclick="toggleDropdown(this)" title="More actions">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        <div class="dropdown-menu">
                            <button class="dropdown-item" style="color:#2563eb;" onclick="openInviteDoctorModal('${h.id}', '${escapeHtml(h.name)}'); closeAllDropdowns()">
                                <i class="fa-solid fa-user-plus"></i> Invite Doctor
                            </button>
                            <button class="dropdown-item" style="color:#16a34a;" onclick="openInviteNewDoctorModal('${h.id}', '${escapeHtml(h.name)}'); closeAllDropdowns()">
                                <i class="fa-solid fa-link"></i> Invite New
                            </button>
                            <div class="dropdown-divider"></div>
                            <button class="dropdown-item ${status === 'active' ? 'item-danger' : 'item-activate'}" onclick="toggleHospitalStatus('${h.id}', '${status}'); closeAllDropdowns()">
                                <i class="fa-solid fa-${status === 'active' ? 'ban' : 'circle-check'}"></i>
                                ${status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// ---- Open create hospital modal ----
async function openCreateHospitalModal() {
    window.location.href = 'create-hospital.html';
}

async function createHospital() {
    const name = $('hospitalName').value.trim();
    const managerId = $('hospitalManagerSelect').value || null;

    if (!name) { alert('Please enter a hospital name.'); return; }

    const code = generateHospitalCode(name);

    // Check code uniqueness
    const { data: existing } = await supabaseClient
        .from('hospitals')
        .select('id')
        .eq('code', code)
        .limit(1);

    if (existing && existing.length > 0) {
        alert(`A hospital with code "${code}" already exists. Please use a different name or adjust the code manually.`);
        return;
    }

    const { data: hospital, error } = await supabaseClient
        .from('hospitals')
        .insert({ name, code, status: 'active', manager_id: managerId, created_by: state.currentAdminId })
        .select()
        .single();

    if (error) { alert(`Failed to create hospital: ${error.message}`); return; }

    // If manager assigned, update their profile
    if (managerId && hospital) {
        await supabaseClient.from('profiles').update({ hospital_id: hospital.id }).eq('id', managerId);
    }

    await logAdminAction({
        module: 'hospitals',
        action: 'created',
        description: `${state.currentAdminName} created hospital "${name}" (${code}).`,
        reason: 'Hospital onboarding',
    });

    hide($('createHospitalModal'));
    alert(`✅ Hospital "${name}" created with code: ${code}`);
    await loadHospitals();
    populateHospitalDropdowns(); // refresh dropdowns elsewhere
}

// ---- Open edit hospital modal ----
async function openEditHospitalModal(hospitalId) {
    const hospital = state.allHospitals.find(h => h.id === hospitalId);
    if (!hospital) return;

    $('editHospitalId').value = hospital.id;
    $('editHospitalName').value = hospital.name;
    $('editHospitalStatus').value = hospital.status || 'active';

    // Populate manager dropdown — include current manager + unassigned managers
    $('editHospitalManager').innerHTML = '<option value="">— None —</option>';
    const { data: managers } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, hospital_id')
        .eq('role', 'hospital_manager')
        .is('deleted_at', null);

    (managers || []).forEach(m => {
        // Show managers not assigned to another hospital, or the current manager of this hospital
        if (!m.hospital_id || m.hospital_id === hospitalId || m.id === hospital.manager_id) {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.full_name} (${m.email})`;
            if (m.id === hospital.manager_id) opt.selected = true;
            $('editHospitalManager').appendChild(opt);
        }
    });

    show($('editHospitalModal'));

    $('editHospitalForm').onsubmit = async (e) => {
        e.preventDefault();
        await saveHospitalEdits(hospital);
    };
}

async function saveHospitalEdits(oldHospital) {
    const name = $('editHospitalName').value.trim();
    const status = $('editHospitalStatus').value;
    const managerId = $('editHospitalManager').value || null;

    const { error } = await supabaseClient
        .from('hospitals')
        .update({ name, status, manager_id: managerId, updated_at: new Date().toISOString() })
        .eq('id', oldHospital.id);

    if (error) { alert(`Failed to save: ${error.message}`); return; }

    // If manager changed, unassign old, assign new
    if (oldHospital.manager_id && oldHospital.manager_id !== managerId) {
        await supabaseClient.from('profiles').update({ hospital_id: null }).eq('id', oldHospital.manager_id);
    }
    if (managerId) {
        await supabaseClient.from('profiles').update({ hospital_id: oldHospital.id }).eq('id', managerId);
    }

    await logAdminAction({
        module: 'hospitals',
        action: 'updated',
        description: `${state.currentAdminName} updated hospital "${name}".`,
        reason: 'Hospital edit',
    });

    hide($('editHospitalModal'));
    await loadHospitals();
}

async function toggleHospitalStatus(hospitalId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const hospital = state.allHospitals.find(h => h.id === hospitalId);
    if (!confirm(`${newStatus === 'suspended' ? 'Suspend' : 'Activate'} "${hospital?.name}"?`)) return;

    const { error } = await supabaseClient
        .from('hospitals')
        .update({ status: newStatus })
        .eq('id', hospitalId);

    if (error) { alert(`Failed: ${error.message}`); return; }
    await loadHospitals();
}

// ---- Populate hospital dropdowns in Create User modal ----
async function populateHospitalDropdowns() {
    const { data: hospitals } = await supabaseClient
        .from('hospitals')
        .select('id, name, code')
        .eq('status', 'active')
        .order('name');

    const selects = ['newUserHospital', 'hospitalManagerSelect'];
    selects.forEach(selId => {
        const sel = $(selId);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = sel.id === 'hospitalManagerSelect'
            ? '<option value="">— None yet —</option>'
            : '<option value="">— Select Hospital —</option>';
        (hospitals || []).forEach(h => {
            const opt = document.createElement('option');
            opt.value = h.id;
            opt.textContent = `${h.name} (${h.code})`;
            if (opt.value === current) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

// ---- Show/hide hospital dropdown when creating users ----
function onNewUserRoleChange() {
    const role = $('newUserRole').value;
    const group = $('newUserHospitalGroup');
    const sel = $('newUserHospital');
    // Show hospital picker for doctors, patients, and hospital managers
    if (['doctor', 'patient', 'hospital_manager'].includes(role)) {
        group.style.display = 'block';
        sel.required = true;
        populateHospitalDropdowns();
    } else {
        group.style.display = 'none';
        sel.required = false;
    }
}


/* =====================================================
   DOCTOR HOSPITAL INVITATIONS — ADMIN SIDE
   ===================================================== */

let _inviteDoctorList = []; // cache for filtering

async function openInviteDoctorModal(hospitalId, hospitalName) {
    $('inviteHospitalId').value = hospitalId;
    $('inviteHospitalName').textContent = hospitalName;
    $('inviteDoctorSearch').value = '';
    $('inviteDoctorStatus').textContent = '';
    $('inviteDoctorList').innerHTML = '<p style="padding:12px; color:#9ca3af; font-size:0.85rem;">Loading doctors...</p>';
    show($('inviteDoctorModal'));

    // Query ALL doctors from profiles (not doctor_profiles)
    // so doctors who haven't completed their profile still appear
    const { data: doctorProfiles, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, status')
        .eq('role', 'doctor')
        .is('deleted_at', null)
        .order('full_name');

    if (error || !doctorProfiles) {
        $('inviteDoctorList').innerHTML = '<p style="padding:12px; color:#dc2626; font-size:0.85rem;">Error loading doctors.</p>';
        return;
    }

    // Fetch verification status separately
    const doctorIds = doctorProfiles.map(d => d.id);
    const { data: docProfs } = await supabaseClient
        .from('doctor_profiles')
        .select('id, specialty, is_verified')
        .in('id', doctorIds);

    const docProfMap = {};
    (docProfs || []).forEach(d => docProfMap[d.id] = d);

    // Get existing memberships for this hospital to avoid duplicate invites
    const { data: existing } = await supabaseClient
        .from('hospital_doctor_memberships')
        .select('doctor_id, status')
        .eq('hospital_id', hospitalId);

    const existingMap = {};
    (existing || []).forEach(m => existingMap[m.doctor_id] = m.status);

    _inviteDoctorList = doctorProfiles.map(d => ({
        ...d,
        specialty: docProfMap[d.id]?.specialty || 'General',
        is_verified: !!docProfMap[d.id]?.is_verified,
        existingStatus: existingMap[d.id] || null
    }));

    renderInviteDoctorList();
}

function filterInviteDoctorList() {
    renderInviteDoctorList();
}

function renderInviteDoctorList() {
    const term = ($('inviteDoctorSearch')?.value || '').toLowerCase().trim();
    const list = _inviteDoctorList.filter(d =>
        !term ||
        (d.full_name || '').toLowerCase().includes(term) ||
        (d.specialty || '').toLowerCase().includes(term) ||
        (d.email || '').toLowerCase().includes(term)
    );

    if (!list.length) {
        $('inviteDoctorList').innerHTML = `
            <div style="text-align:center; padding:2rem 1rem; color:#9ca3af;">
                <i class="fa-solid fa-magnifying-glass" style="font-size:1.5rem; margin-bottom:0.5rem; display:block; opacity:0.4;"></i>
                <p style="font-size:0.82rem;">No doctors found.</p>
            </div>`;
        return;
    }

    $('inviteDoctorList').innerHTML = list.map(d => {
        const initials = (d.full_name || 'D').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
        const verifiedBadge = d.is_verified
            ? '<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;background:#dbeafe;color:#1d4ed8;border-radius:9999px;font-size:0.62rem;font-weight:700;"><i class="fa-solid fa-shield-halved"></i> Verified</span>'
            : '<span style="padding:1px 6px;background:#f3f4f6;color:#9ca3af;border-radius:9999px;font-size:0.62rem;font-weight:700;">Unverified</span>';

        let actionHtml = '';
        if (d.existingStatus === 'active') {
            actionHtml = '<span style="padding:4px 10px;background:#dcfce7;color:#15803d;border-radius:9999px;font-size:0.72rem;font-weight:700;white-space:nowrap;"><i class="fa-solid fa-check" style="margin-right:3px;"></i>Member</span>';
        } else if (d.existingStatus === 'pending') {
            actionHtml = '<span style="padding:4px 10px;background:#fef9c3;color:#ca8a04;border-radius:9999px;font-size:0.72rem;font-weight:700;white-space:nowrap;"><i class="fa-solid fa-clock" style="margin-right:3px;"></i>Invited</span>';
        } else {
            actionHtml = `<button onclick="sendDoctorInvite('${d.id}', '${escapeHtml(d.full_name)}')"
                style="padding:5px 14px;background:#2563eb;color:#fff;border:none;border-radius:7px;
                       font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;
                       display:inline-flex;align-items:center;gap:4px;"
                onmouseover="this.style.opacity='0.85'"
                onmouseout="this.style.opacity='1'">
                <i class="fa-solid fa-paper-plane"></i> Invite
            </button>`;
        }

        return `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;
                        border-bottom:1px solid #f3f4f6;transition:background 0.12s;"
                 onmouseover="this.style.background='#f9fafb'"
                 onmouseout="this.style.background=''">
                <div style="width:36px;height:36px;border-radius:50%;background:#dbeafe;
                            display:flex;align-items:center;justify-content:center;
                            font-weight:700;color:#2563eb;font-size:0.78rem;flex-shrink:0;">
                    ${initials}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                        <span style="font-weight:600;font-size:0.85rem;color:#1a1a2e;">
                            ${escapeHtml(d.full_name || 'Doctor')}
                        </span>
                        ${verifiedBadge}
                    </div>
                    <div style="font-size:0.72rem;color:#6b7280;margin-top:1px;">
                        ${escapeHtml(d.specialty || 'General')}
                    </div>
                </div>
                <div style="flex-shrink:0;">${actionHtml}</div>
            </div>`;
    }).join('');
}

async function sendDoctorInvite(doctorId, doctorName) {
    const hospitalId = $('inviteHospitalId').value;
    const hospitalName = $('inviteHospitalName').textContent;

    if (!confirm(`Send invitation to ${doctorName} to join ${hospitalName}?`)) return;

    const { error } = await supabaseClient
        .from('hospital_doctor_memberships')
        .insert({
            hospital_id: hospitalId,
            doctor_id: doctorId,
            status: 'pending',
            invited_by: state.currentAdminId,
            invited_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

    if (error) {
        $('inviteDoctorStatus').innerHTML = `<span style="color:#dc2626;">Failed: ${escapeHtml(error.message)}</span>`;
        return;
    }

    // Update local cache so button changes to INVITED immediately
    const doc = _inviteDoctorList.find(d => d.id === doctorId);
    if (doc) doc.existingStatus = 'pending';
    renderInviteDoctorList();

    $('inviteDoctorStatus').innerHTML = `<span style="color:#16a34a;">✅ Invitation sent to ${escapeHtml(doctorName)}. They will see it in their Hospitals dashboard.</span>`;

    await logAdminAction({
        module: 'hospitals',
        action: 'invited_doctor',
        target_user_id: doctorId,
        description: `${state.currentAdminName} invited ${doctorName} to join ${hospitalName}.`,
        reason: 'Hospital doctor invite',
    });
}


/* =====================================================
   INVITE NEW DOCTOR (create account via link)
   ===================================================== */

function openInviteNewDoctorModal(hospitalId, hospitalName) {
    $('inviteNewHospitalId').value = hospitalId;
    $('inviteNewHospitalName').textContent = hospitalName;
    $('inviteNewEmail').value = '';
    $('inviteNewDoctorStatus').innerHTML = '';
    $('inviteNewDoctorLink').style.display = 'none';

    const modal = $('inviteNewDoctorModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    $('inviteNewDoctorForm').onsubmit = async (e) => {
        e.preventDefault();
        await generateDoctorInviteLink();
    };
}

async function generateDoctorInviteLink() {
    const hospitalId   = $('inviteNewHospitalId').value;
    const hospitalName = $('inviteNewHospitalName').textContent;
    const email        = $('inviteNewEmail').value.trim();

    if (!email) return;

    const statusEl = $('inviteNewDoctorStatus');
    statusEl.innerHTML = '<span style="color:#6b7280;">Generating link...</span>';

    // Generate a secure random token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Store invite in doctor_invites table
    const { error } = await supabaseClient
        .from('doctor_invites')
        .insert({
            token,
            hospital_id: hospitalId,
            email,
            invited_by: state.currentAdminId,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });

    if (error) {
        statusEl.innerHTML = `<span style="color:#dc2626;">Failed: ${escapeHtml(error.message)}</span>`;
        return;
    }

    // Build the invite URL pointing to doctor-signup.html
    const base = window.location.href.replace(/\/admin\/.*$/, '/');
    const inviteUrl = `${base}doctor-signup.html?token=${token}&hospital_id=${encodeURIComponent(hospitalId)}&hospital_name=${encodeURIComponent(hospitalName)}&email=${encodeURIComponent(email)}`;

    $('inviteLinkBox').value = inviteUrl;
    $('inviteNewDoctorLink').style.display = 'block';
    statusEl.innerHTML = `<span style="color:#16a34a;">✅ Invite link generated for <strong>${escapeHtml(email)}</strong>. Copy and share it with the doctor.</span>`;

    await logAdminAction({
        module: 'hospitals',
        action: 'invited_new_doctor',
        description: `${state.currentAdminName} generated a doctor signup invite for ${email} to join ${hospitalName}.`,
        reason: 'New doctor invite',
    });
}

function copyInviteLink() {
    const box = $('inviteLinkBox');
    box.select();
    box.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(box.value).then(() => {
        const btn = box.nextElementSibling;
        btn.textContent = 'Copied!';
        btn.style.background = '#16a34a';
        setTimeout(() => {
            btn.textContent = 'Copy';
            btn.style.background = '#2563eb';
        }, 2000);
    });
}

// Expose new functions on window
window.openInviteNewDoctorModal = openInviteNewDoctorModal;
window.copyInviteLink = copyInviteLink;