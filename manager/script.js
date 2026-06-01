'use strict';

/* =====================================================
   INSTADOC — HOSPITAL MANAGER PORTAL
   ===================================================== */

const SB_URL = 'https://ioaqlcltvakuqqehkyor.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvYXFsY2x0dmFrdXFxZWhreW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTk1MzksImV4cCI6MjA4MTczNTUzOX0._7ISJbfJzryBJWmtRuN72F-JZpYdvJxsltwwhombPtE';
const sb = window.supabase.createClient(SB_URL, SB_KEY);

// ---- State ----
let currentUser   = null;
let currentHospital = null; // { id, name, code }
let allDoctors    = [];
let allAppointments = [];
let existingDoctorPickerList = [];

/* =====================================================
   BOOT
   ===================================================== */
async function boot() {
    const { data: { session } } = await sb.auth.getSession();

    if (!session?.user) {
        window.location.href = '../index.html';
        return;
    }

    // Verify role
    const { data: profile } = await sb.from('profiles')
        .select('id, full_name, email, role, hospital_id, status, deleted_at')
        .eq('id', session.user.id)
        .single();

    if (!profile || profile.role !== 'hospital_manager' || profile.deleted_at || profile.status === 'suspended') {
        await sb.auth.signOut();
        window.location.href = '../index.html';
        return;
    }

    if (!profile.hospital_id) {
        document.getElementById('loading-screen').innerHTML = `
            <div style="text-align:center; padding:2rem;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem; color:#f59e0b; margin-bottom:1rem; display:block;"></i>
                <h2 style="font-size:1.1rem; font-weight:700;">No Hospital Assigned</h2>
                <p style="color:#6b7280; font-size:0.85rem; margin-top:0.5rem;">Your account hasn't been linked to a hospital yet. Please contact the Instadoc admin.</p>
                <button onclick="logout()" style="margin-top:1.5rem; padding:8px 20px; background:#2f8f46; color:#fff; border:none; border-radius:8px; font-size:0.85rem; cursor:pointer; font-family:'Poppins',sans-serif;">Log Out</button>
            </div>`;
        return;
    }

    currentUser = session.user;
    currentUser.profile = profile;

    // Load hospital info
    const { data: hospital } = await sb.from('hospitals')
        .select('id, name, code, status')
        .eq('id', profile.hospital_id)
        .single();

    if (!hospital || hospital.status === 'suspended') {
        document.getElementById('loading-screen').innerHTML = `
            <div style="text-align:center; padding:2rem;">
                <i class="fa-solid fa-hospital-slash" style="font-size:2rem; color:#dc2626; margin-bottom:1rem; display:block;"></i>
                <h2 style="font-size:1.1rem; font-weight:700;">Hospital Suspended</h2>
                <p style="color:#6b7280; font-size:0.85rem; margin-top:0.5rem;">Your hospital account has been suspended. Contact Instadoc support.</p>
                <button onclick="logout()" style="margin-top:1.5rem; padding:8px 20px; background:#dc2626; color:#fff; border:none; border-radius:8px; font-size:0.85rem; cursor:pointer; font-family:'Poppins',sans-serif;">Log Out</button>
            </div>`;
        return;
    }

    currentHospital = hospital;

    // Populate UI
    document.getElementById('hospital-code-pill').textContent = hospital.code;
    document.getElementById('hospital-name-topbar').textContent = hospital.name;
    document.getElementById('manager-name-topbar').textContent = profile.full_name || profile.email;

    // Set greeting
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    document.getElementById('overview-greeting').textContent = `${greet}, ${(profile.full_name || '').split(' ')[0] || 'Manager'} 👋`;

    // Show UI
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('topbar').style.display = 'flex';
    document.getElementById('main-layout').style.display = 'flex';

    // Load all data
    await Promise.allSettled([
        loadDoctors(),
        loadAppointments(),
        loadStats(),
        loadInvitations(),
    ]);
}

/* =====================================================
   NAVIGATION
   ===================================================== */
function switchView(name, btn) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('view-' + name)?.classList.add('active');
    if (btn) btn.classList.add('active');

    if (name === 'schedules') renderSchedules();
    if (name === 'appointments') renderAppointments();
    if (name === 'invitations') loadInvitations();
}

/* =====================================================
   STATS
   ===================================================== */
async function loadStats() {
    // Doctors (active memberships)
    const { count: docCount } = await sb.from('hospital_doctor_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('hospital_id', currentHospital.id)
        .eq('status', 'active');

    // Patients
    const { count: patCount } = await sb.from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('hospital_id', currentHospital.id)
        .eq('role', 'patient')
        .is('deleted_at', null);

    // Appointments this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const { count: apptCount } = await sb.from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('hospital_id', currentHospital.id)
        .gte('appointment_date', weekStart.toISOString());

    // Pending invites
    const { count: pendingCount } = await sb.from('hospital_doctor_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('hospital_id', currentHospital.id)
        .eq('status', 'pending');

    document.getElementById('stat-doctors').textContent      = docCount ?? 0;
    document.getElementById('stat-patients').textContent     = patCount ?? 0;
    document.getElementById('stat-appointments').textContent = apptCount ?? 0;
    document.getElementById('stat-pending').textContent      = pendingCount ?? 0;

    // Nav badge
    if (pendingCount > 0) {
        const badge = document.getElementById('pending-badge');
        badge.textContent = pendingCount;
        badge.style.display = 'inline';
    }

    // Overview appointments (last 5)
    renderOverviewAppointments();
    renderOnlineDoctors();
}

/* =====================================================
   DOCTORS
   ===================================================== */
async function loadDoctors() {
    // Get all memberships for this hospital
    const { data: memberships } = await sb.from('hospital_doctor_memberships')
        .select('doctor_id, status, invited_at, accepted_at')
        .eq('hospital_id', currentHospital.id)
        .in('status', ['active', 'pending']);

    if (!memberships?.length) {
        allDoctors = [];
        renderDoctors();
        return;
    }

    const doctorIds = memberships.map(m => m.doctor_id);

    // Get profiles
    const { data: profiles } = await sb.from('profiles')
        .select('id, full_name, email')
        .in('id', doctorIds);

    // Get doctor_profiles (specialty, schedule, is_verified, is_online)
    const { data: docProfiles } = await sb.from('doctor_profiles')
        .select('id, specialty, is_verified, is_online, schedule')
        .in('id', doctorIds);

    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p);
    const docProfileMap = {};
    (docProfiles || []).forEach(d => docProfileMap[d.id] = d);

    allDoctors = memberships.map(m => ({
        ...profileMap[m.doctor_id],
        ...docProfileMap[m.doctor_id],
        membership_status: m.status,
        invited_at: m.invited_at,
        accepted_at: m.accepted_at,
    })).filter(d => d.id);

    renderDoctors();
    renderSchedules();
}

function renderDoctors() {
    const tbody = document.getElementById('doctors-table-body');
    const search = document.getElementById('doctor-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('doctor-status-filter')?.value || 'all';

    let list = allDoctors.filter(d => {
        const matchSearch = !search ||
            (d.full_name || '').toLowerCase().includes(search) ||
            (d.email || '').toLowerCase().includes(search) ||
            (d.specialty || '').toLowerCase().includes(search);
        const matchStatus = statusFilter === 'all' || d.membership_status === statusFilter;
        return matchSearch && matchStatus;
    });

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty"><i class="fa-solid fa-user-slash"></i>No doctors found.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(d => {
        const verifiedBadge = d.is_verified
            ? '<span class="badge badge-green">Verified</span>'
            : '<span class="badge badge-yellow">Unverified</span>';
        const statusBadge = d.membership_status === 'active'
            ? '<span class="badge badge-green">Active</span>'
            : '<span class="badge badge-yellow">Pending</span>';
        const joinedDate = d.accepted_at ? formatDate(d.accepted_at) : (d.invited_at ? `Invited ${formatDate(d.invited_at)}` : '—');

        return `<tr>
            <td>
                <div style="font-weight:600;">${esc(d.full_name || 'Doctor')}</div>
                <div style="font-size:0.75rem; color:#9ca3af;">${esc(d.email || '')}</div>
            </td>
            <td>${esc(d.specialty || 'General')}</td>
            <td>${verifiedBadge}</td>
            <td>${statusBadge}</td>
            <td style="font-size:0.78rem; color:#9ca3af;">${joinedDate}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-outline" style="font-size:0.75rem; padding:4px 10px;" onclick="openScheduleDetail('${d.id}')">Schedule</button>
                    ${d.membership_status === 'active' ? `<button class="btn btn-red" style="font-size:0.75rem; padding:4px 10px;" onclick="removeDoctor('${d.id}', '${esc(d.full_name || 'Doctor')}')">Remove</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function filterDoctors() { renderDoctors(); }

async function removeDoctor(doctorId, doctorName) {
    if (!confirm(`Remove ${doctorName} from ${currentHospital.name}? They will no longer be visible to your patients.`)) return;

    const { error } = await sb.from('hospital_doctor_memberships')
        .update({ status: 'removed', updated_at: new Date().toISOString() })
        .eq('hospital_id', currentHospital.id)
        .eq('doctor_id', doctorId);

    if (error) { showToast('Failed: ' + error.message, 'error'); return; }
    showToast(`${doctorName} removed from hospital.`, 'info');
    await loadDoctors();
    await loadStats();
}

/* =====================================================
   SCHEDULES
   ===================================================== */
function renderSchedules() {
    const container = document.getElementById('schedules-list');
    const activeDoctors = allDoctors.filter(d => d.membership_status === 'active');

    if (!activeDoctors.length) {
        container.innerHTML = `<div class="empty"><i class="fa-regular fa-clock"></i>No active doctors yet.</div>`;
        return;
    }

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    container.innerHTML = activeDoctors.map(d => {
        const schedule = d.schedule || {};
        const onlineBadge = d.is_online
            ? '<span class="badge badge-green" style="font-size:0.68rem;"><i class="fa-solid fa-circle" style="font-size:0.5rem;"></i> Online</span>'
            : '<span class="badge badge-gray" style="font-size:0.68rem;">Offline</span>';

        const scheduleRows = days.map(day => {
            const s = schedule[day];
            if (!s || !s.active) return `<div class="schedule-row inactive"><span class="schedule-day">${day}</span><span class="schedule-time">—</span><span class="schedule-time">—</span><span class="badge badge-gray" style="font-size:0.68rem;">Off</span></div>`;
            return `<div class="schedule-row"><span class="schedule-day">${day}</span><span class="schedule-time">${s.start || '—'}</span><span class="schedule-time">${s.end || '—'}</span><span class="badge badge-green" style="font-size:0.68rem;">Open</span></div>`;
        }).join('');

        return `
            <div class="card">
                <div class="card-title" style="justify-content:space-between;">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div style="width:36px;height:36px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-weight:700;color:#2563eb;font-size:0.85rem;">${getInitials(d.full_name)}</div>
                        <div>
                            <div style="font-size:0.9rem;">${esc(d.full_name || 'Doctor')}</div>
                            <div style="font-size:0.72rem; color:#9ca3af; font-weight:400;">${esc(d.specialty || 'General')}</div>
                        </div>
                    </div>
                    ${onlineBadge}
                </div>
                <div style="display:grid; grid-template-columns:50px 1fr 1fr 70px; gap:4px; font-size:0.72rem; color:#9ca3af; padding:0 0.75rem; margin-bottom:4px;">
                    <span></span><span>Start</span><span>End</span><span></span>
                </div>
                <div class="schedule-grid">${scheduleRows}</div>
            </div>`;
    }).join('');
}

function openScheduleDetail(doctorId) {
    const doc = allDoctors.find(d => d.id === doctorId);
    if (!doc) return;

    document.getElementById('schedule-modal-name').textContent = doc.full_name || 'Doctor';
    document.getElementById('schedule-modal-specialty').textContent = doc.specialty || 'General';

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const schedule = doc.schedule || {};
    const grid = document.getElementById('schedule-modal-grid');

    grid.innerHTML = days.map(day => {
        const s = schedule[day];
        const active = s?.active;
        return `<div class="schedule-row ${active ? '' : 'inactive'}">
            <span class="schedule-day">${day}</span>
            <span class="schedule-time">${active ? (s.start || '—') : '—'}</span>
            <span class="schedule-time">${active ? (s.end || '—') : '—'}</span>
            <span class="badge ${active ? 'badge-green' : 'badge-gray'}" style="font-size:0.68rem;">${active ? 'Open' : 'Off'}</span>
        </div>`;
    }).join('');

    openModal('schedule-detail-modal');
}

/* =====================================================
   APPOINTMENTS (doctor + time only — no health data)
   ===================================================== */
async function loadAppointments() {
    const { data } = await sb.from('appointments')
        .select('id, doctor_name, doctor_id, appointment_date, type, status')
        .eq('hospital_id', currentHospital.id)
        .order('appointment_date', { ascending: false })
        .limit(200);

    allAppointments = data || [];
    renderOverviewAppointments();
    renderOnlineDoctors();

    // Populate doctor filter dropdown
    const sel = document.getElementById('appt-doctor-filter');
    const doctorNames = [...new Set(allAppointments.map(a => a.doctor_name).filter(Boolean))];
    sel.innerHTML = '<option value="all">All Doctors</option>' +
        doctorNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function renderOverviewAppointments() {
    const tbody = document.getElementById('overview-appts-body');
    const recent = allAppointments.slice(0, 5);
    if (!recent.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">No appointments yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = recent.map(a => apptRow(a)).join('');
}

function renderAppointments() {
    const tbody = document.getElementById('appointments-table-body');
    const doctorFilter = document.getElementById('appt-doctor-filter')?.value || 'all';
    const statusFilter = document.getElementById('appt-status-filter')?.value || 'all';

    let list = allAppointments.filter(a => {
        const matchDoctor = doctorFilter === 'all' || a.doctor_name === doctorFilter;
        const matchStatus = statusFilter === 'all' || a.status === statusFilter;
        return matchDoctor && matchStatus;
    });

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">No appointments found.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(a => apptRow(a)).join('');
}

function apptRow(a) {
    const statusColors = { pending:'badge-yellow', confirmed:'badge-blue', completed:'badge-green', cancelled:'badge-red' };
    const badgeClass = statusColors[a.status] || 'badge-gray';
    return `<tr>
        <td><strong>${esc(a.doctor_name || '—')}</strong></td>
        <td>${a.appointment_date ? formatDateTime(a.appointment_date) : '—'}</td>
        <td>${esc(a.type || '—')}</td>
        <td><span class="badge ${badgeClass}">${esc((a.status || '—').toUpperCase())}</span></td>
    </tr>`;
}

function filterAppointments() { renderAppointments(); }

function renderOnlineDoctors() {
    const container = document.getElementById('online-doctors-list');
    const online = allDoctors.filter(d => d.is_online && d.membership_status === 'active');
    if (!online.length) {
        container.innerHTML = `<p style="color:#9ca3af; font-size:0.85rem;">No doctors are currently online.</p>`;
        return;
    }
    container.innerHTML = online.map(d => `
        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0; border-bottom:1px solid #f3f4f6;">
            <div style="width:36px;height:36px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;font-weight:700;color:#16a34a;font-size:0.82rem;">${getInitials(d.full_name)}</div>
            <div>
                <div style="font-weight:600; font-size:0.88rem;">${esc(d.full_name || 'Doctor')}</div>
                <div style="font-size:0.75rem; color:#9ca3af;">${esc(d.specialty || 'General')}</div>
            </div>
            <span class="badge badge-green" style="margin-left:auto; font-size:0.68rem;"><i class="fa-solid fa-circle" style="font-size:0.5rem;"></i> Online</span>
        </div>`).join('');
}

/* =====================================================
   INVITATIONS
   ===================================================== */
async function loadInvitations() {
    const tbody = document.getElementById('invitations-table-body');
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Loading...</td></tr>`;

    // Hospital doctor memberships (existing doctor invites)
    const { data: memberships } = await sb.from('hospital_doctor_memberships')
        .select('doctor_id, status, invited_at, profiles(full_name, email)')
        .eq('hospital_id', currentHospital.id)
        .order('invited_at', { ascending: false });

    // New doctor invites (invite links)
    const { data: linkInvites } = await sb.from('doctor_invites')
        .select('email, created_at, expires_at, used_at')
        .eq('hospital_id', currentHospital.id)
        .order('created_at', { ascending: false });

    const rows = [];

    (memberships || []).forEach(m => {
        const name = m.profiles?.full_name || m.profiles?.email || 'Unknown';
        const statusBadge = m.status === 'active'
            ? '<span class="badge badge-green">Accepted</span>'
            : m.status === 'pending'
            ? '<span class="badge badge-yellow">Pending</span>'
            : '<span class="badge badge-gray">Declined/Removed</span>';
        rows.push(`<tr>
            <td><strong>${esc(name)}</strong><div style="font-size:0.75rem;color:#9ca3af;">${esc(m.profiles?.email || '')}</div></td>
            <td><span class="badge badge-blue">Existing Doctor</span></td>
            <td>${statusBadge}</td>
            <td style="font-size:0.78rem;color:#9ca3af;">${m.invited_at ? formatDate(m.invited_at) : '—'}</td>
        </tr>`);
    });

    (linkInvites || []).forEach(i => {
        const expired = new Date(i.expires_at) < new Date();
        const usedBadge = i.used_at
            ? '<span class="badge badge-green">Used</span>'
            : expired
            ? '<span class="badge badge-red">Expired</span>'
            : '<span class="badge badge-yellow">Pending</span>';
        rows.push(`<tr>
            <td><strong>${esc(i.email)}</strong></td>
            <td><span class="badge badge-gray">New Doctor Link</span></td>
            <td>${usedBadge}</td>
            <td style="font-size:0.78rem;color:#9ca3af;">${i.created_at ? formatDate(i.created_at) : '—'}</td>
        </tr>`);
    });

    tbody.innerHTML = rows.length
        ? rows.join('')
        : `<tr><td colspan="4" class="empty"><i class="fa-solid fa-envelope-open"></i>No invitations sent yet.</td></tr>`;
}

/* =====================================================
   INVITE EXISTING DOCTOR
   ===================================================== */
async function openInviteExistingModal() {
    document.getElementById('existing-doc-search').value = '';
    document.getElementById('invite-existing-status').innerHTML = '';
    document.getElementById('existing-doctor-picker').innerHTML = '<p style="padding:12px; color:#9ca3af; font-size:0.82rem;">Loading...</p>';
    openModal('invite-existing-modal');

    // Load all verified doctors NOT already in this hospital
    const { data: allVerified } = await sb.from('doctor_profiles')
        .select('id, full_name, specialty, is_verified')
        .eq('is_verified', true);

    const { data: existing } = await sb.from('hospital_doctor_memberships')
        .select('doctor_id, status')
        .eq('hospital_id', currentHospital.id);

    const existingMap = {};
    (existing || []).forEach(m => existingMap[m.doctor_id] = m.status);

    existingDoctorPickerList = (allVerified || []).map(d => ({ ...d, existingStatus: existingMap[d.id] || null }));
    renderExistingDoctorPicker();
}

function filterExistingDoctorPicker() { renderExistingDoctorPicker(); }

function renderExistingDoctorPicker() {
    const term = (document.getElementById('existing-doc-search')?.value || '').toLowerCase();
    const list = existingDoctorPickerList.filter(d =>
        !term || (d.full_name || '').toLowerCase().includes(term) || (d.specialty || '').toLowerCase().includes(term)
    );
    const container = document.getElementById('existing-doctor-picker');
    if (!list.length) { container.innerHTML = '<p style="padding:12px; color:#9ca3af; font-size:0.82rem;">No doctors found.</p>'; return; }

    container.innerHTML = list.map(d => {
        let action = '';
        if (d.existingStatus === 'active') action = '<span class="badge badge-green">Member</span>';
        else if (d.existingStatus === 'pending') action = '<span class="badge badge-yellow">Invited</span>';
        else action = `<button class="btn btn-primary" style="font-size:0.75rem; padding:4px 12px;" onclick="sendExistingInvite('${d.id}', '${esc(d.full_name || 'Doctor')}')">Invite</button>`;

        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.65rem 0.85rem; border-bottom:1px solid #f3f4f6;">
            <div>
                <div style="font-weight:600; font-size:0.88rem;">${esc(d.full_name || 'Doctor')}</div>
                <div style="font-size:0.75rem; color:#9ca3af;">${esc(d.specialty || 'General')}</div>
            </div>
            ${action}
        </div>`;
    }).join('');
}

async function sendExistingInvite(doctorId, doctorName) {
    const { error } = await sb.from('hospital_doctor_memberships').insert({
        hospital_id: currentHospital.id,
        doctor_id: doctorId,
        status: 'pending',
        invited_by: currentUser.id,
        invited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    if (error && !error.message.includes('duplicate')) {
        document.getElementById('invite-existing-status').innerHTML = `<span style="color:#dc2626;">Failed: ${esc(error.message)}</span>`;
        return;
    }

    // Update picker
    const doc = existingDoctorPickerList.find(d => d.id === doctorId);
    if (doc) doc.existingStatus = 'pending';
    renderExistingDoctorPicker();

    document.getElementById('invite-existing-status').innerHTML = `<span style="color:#16a34a;">✅ Invite sent to ${esc(doctorName)}. They'll see it in their dashboard.</span>`;
    showToast('Invitation sent!', 'success');

    // Log activity
    await sb.from('platform_activity').insert({
        module: 'hospitals',
        action: 'invited_doctor',
        actor_id: currentUser.id,
        description: `${currentUser.profile.full_name} invited ${doctorName} to join ${currentHospital.name}.`,
        created_at: new Date().toISOString()
    });

    await loadStats();
}

/* =====================================================
   INVITE NEW DOCTOR (link)
   ===================================================== */
function openInviteNewModal() {
    document.getElementById('new-doctor-email').value = '';
    document.getElementById('invite-new-status').innerHTML = '';
    document.getElementById('invite-new-link-box').style.display = 'none';
    openModal('invite-new-modal');
}

async function generateNewDoctorInvite() {
    const email = document.getElementById('new-doctor-email').value.trim();
    if (!email) { showToast('Please enter an email address.', 'error'); return; }

    const statusEl = document.getElementById('invite-new-status');
    statusEl.innerHTML = '<span style="color:#6b7280;">Generating...</span>';

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await sb.from('doctor_invites').insert({
        token,
        hospital_id: currentHospital.id,
        email,
        invited_by: currentUser.id,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
    });

    if (error) { statusEl.innerHTML = `<span style="color:#dc2626;">Failed: ${esc(error.message)}</span>`; return; }

    const base = window.location.href.replace(/\/manager\/.*$/, '/');
    const link = `${base}doctor-signup.html?token=${token}&hospital_id=${encodeURIComponent(currentHospital.id)}&hospital_name=${encodeURIComponent(currentHospital.name)}&email=${encodeURIComponent(email)}`;

    document.getElementById('invite-link-input').value = link;
    document.getElementById('invite-new-link-box').style.display = 'block';
    statusEl.innerHTML = `<span style="color:#16a34a;">✅ Link generated for <strong>${esc(email)}</strong>.</span>`;
    showToast('Invite link ready!', 'success');

    await loadInvitations();
}

function copyInviteLink() {
    const input = document.getElementById('invite-link-input');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => showToast('Link copied!', 'success'));
}

/* =====================================================
   MODAL HELPERS
   ===================================================== */
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// Close on backdrop click
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
    }
});

/* =====================================================
   AUTH
   ===================================================== */
async function logout() {
    await sb.auth.signOut();
    window.location.href = '../index.html';
}

/* =====================================================
   HELPERS
   ===================================================== */
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}
function formatDate(d) {
    const dt = new Date(d);
    return isNaN(dt) ? '—' : dt.toLocaleDateString('en-GB');
}
function formatDateTime(d) {
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3000);
}

// Boot on load
document.addEventListener('DOMContentLoaded', boot);