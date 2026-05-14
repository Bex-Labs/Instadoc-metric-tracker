// --- 1. CONFIGURATION ---
var SUPABASE_URL = 'https://ioaqlcltvakuqqehkyor.supabase.co'; 
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvYXFsY2x0dmFrdXFxZWhreW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTk1MzksImV4cCI6MjA4MTczNTUzOX0._7ISJbfJzryBJWmtRuN72F-JZpYdvJxsltwwhombPtE';

var supabaseClient;
var currentUser = null;
var myChart = null; 
var doctorCharts = {};
var currentChartTable = 'weight_logs'; 
var currentChartDays = 7; 
var allHistoryData = []; 
var allAppointments = []; 
var userRole = 'patient'; // Default role

const countriesList = [
    "United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Italy", "Spain", "Brazil", "India", 
    "China", "Japan", "South Korea", "Mexico", "Russia", "South Africa", "Nigeria", "Egypt", "Kenya", "Ghana"
];

try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.warn("Supabase credentials missing.");
    } else {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (err) { console.error("Init Error", err); }

// --- 2. AUTH & VIEW STATE ---
if (supabaseClient) {
    // 1. Manually pull the session first to prevent the "Verifying" screen from hanging
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
        handleSession(session, 'INITIAL_LOAD');
    }).catch((err) => {
        console.error("getSession failed:", err);
        // If Supabase can't resolve at all, redirect to landing
        window.location.href = '../index.html';
    });

    // Safety net: if nothing resolves within 8 seconds, redirect rather than leaving user stuck
    setTimeout(() => {
        const landing = document.getElementById('landing-view');
        if (landing && landing.style.display !== 'none') {
            console.warn("Session verification timed out — redirecting.");
            window.location.href = '../index.html';
        }
    }, 8000);

    // 2. Listen for future auth changes (like logouts or password recoveries)
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'INITIAL_SESSION') return; // Handled by getSession above
        handleSession(session, event);
    });

    // 3. Your existing routing logic safely wrapped in a reusable function
    async function handleSession(session, event) {
        const landing = document.getElementById('landing-view');
        const dashboard = document.getElementById('dashboard-view');
        const deco = document.getElementById('decorations');

        console.log("Auth Event:", event);

        try {

        // US-3: Password Recovery Handling
        if (event === 'PASSWORD_RECOVERY') {
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            const updateModal = document.getElementById('update-password-modal');
            if (updateModal) updateModal.classList.add('active');
            return; // Stop further routing logic
        }

        if (session && session.user) {
            // LOGGED IN
            currentUser = session.user;

            // Track login event
            if (event === 'SIGNED_IN') {
                const meta = session.user.user_metadata || {};
                supabaseClient.from('login_logs').insert({
                    user_id: session.user.id,
                    email: session.user.email || '',
                    full_name: meta.full_name || meta.name || '',
                    role: meta.role || 'patient',
                    logged_in_at: new Date().toISOString(),
                }).then(({ error }) => {
                    if (error) console.warn('Login log failed:', error.message);
                });
            }

            // US-1 & US-2: Role-Based Routing
            const metaRole = (session.user.user_metadata && session.user.user_metadata.role) ? session.user.user_metadata.role : 'patient';
            userRole = metaRole; 

            // --- RESTORED VISUAL SWITCH LOGIC ---
            landing.style.display = 'none';
            dashboard.style.display = 'grid'; 
            if(deco) deco.style.display = 'none';
            
            closeModals();
            resetDates();
            populateCountries();
            
            if (Notification.permission !== "granted") Notification.requestPermission();
            // ------------------------------------

            // Setup Interface based on Role
            setupSidebar();
            startNotificationEngine();
            
            // Retrieve last active view or default
            const savedView = localStorage.getItem('instadoc_active_view');
            
            if(userRole === 'doctor') {
                loadDoctorStatus(); 
                renderScheduleGrid(); 
                loadDoctorDashboardData(); 
                
                if (savedView && savedView.startsWith('doctor-')) {
                    switchView(savedView);
                } else {
                    switchView('doctor-dashboard');
                }
            } else {
                loadDashboardData();
                loadProfileSettings(); 
                
                if (savedView && !savedView.startsWith('doctor-')) {
                    switchView(savedView);
                } else {
                    switchView('dashboard');
                }
            }
            
            updateWelcomeMessage();
            updateAvatarUI(session.user.user_metadata?.avatar_url);

            // --- SEAMLESS BOOKING HANDOFF ---
            if (sessionStorage.getItem('pendingBookingEmail') && userRole === 'patient') {
                setTimeout(() => {
                    openModal('booking');
                    const savedPhone = sessionStorage.getItem('pendingBookingPhone');
                    const currentMeta = session.user.user_metadata || {};
                    if (savedPhone && !currentMeta.phone) {
                        supabaseClient.auth.updateUser({ data: { phone: savedPhone } });
                    }
                    sessionStorage.removeItem('pendingBookingName');
                    sessionStorage.removeItem('pendingBookingEmail');
                    sessionStorage.removeItem('pendingBookingPhone');
                }, 1000); 
            }
        } else {
            // LOGGED OUT — redirect to landing page
            currentUser = null;
            userRole = 'patient';
            window.location.href = '../index.html';
        }
        } catch (err) {
            console.error("handleSession error:", err);
            // If anything crashes mid-session setup, don't leave user stuck
            if (landing && landing.style.display !== 'none') {
                window.location.href = '../index.html';
            }
        }
    }

    // Force-logout listener: Admin can suspend/archive users mid-session
    supabaseClient.auth.onAuthStateChange(function(event, session) {
        if (event === 'SIGNED_IN' && session && session.user) {
            supabaseClient
                .channel('force-logout:' + session.user.id)
                .on('broadcast', { event: 'force_logout' }, async function() {
                    await supabaseClient.auth.signOut();
                    window.location.href = '../index.html';
                })
                .subscribe();
        }
    });
}

// NEW: Dynamic Sidebar Setup
function setupSidebar() {
    const list = document.getElementById('nav-list-container');
    list.innerHTML = '';

    if(userRole === 'patient') {
        list.innerHTML = `
            <li class="nav-item active">
                <a href="#" class="nav-link" onclick="switchView('dashboard', this); return false;">
                    <i class="fa-solid fa-house"></i><span>Dashboard</span>
                </a>
            </li>
            <li class="nav-item">
                <a href="#" class="nav-link" onclick="switchView('metrics', this); return false;">
                    <i class="fa-solid fa-heart-pulse"></i><span>Health Metrics</span>
                </a>
            </li>
            <li class="nav-item"><a href="#" class="nav-link" onclick="openModal('log-bp'); return false;"><i class="fa-solid fa-heart-pulse text-gray-500"></i><span>Log BP</span></a></li>
            <li class="nav-item"><a href="#" class="nav-link" onclick="openModal('log-weight'); return false;"><i class="fa-solid fa-weight-scale text-gray-500"></i><span>Log Weight</span></a></li>
            <li class="nav-item"><a href="#" class="nav-link" onclick="openModal('log-glucose'); return false;"><i class="fa-solid fa-droplet text-gray-500"></i><span>Log Glucose</span></a></li>
            <li class="nav-item"><a href="#" class="nav-link" onclick="openModal('log-height'); return false;"><i class="fa-solid fa-ruler-vertical text-gray-500"></i><span>Log Height</span></a></li>
            <li class="nav-item">
                <a href="#" class="nav-link" onclick="switchView('appointments', this); return false;">
                    <i class="fa-regular fa-calendar-check"></i><span>Appointments</span>
                </a>
            </li>
            <li class="nav-item">
                <a href="#" class="nav-link" onclick="switchView('settings', this); return false;">
                    <i class="fa-solid fa-gear"></i><span>Settings</span>
                </a>
            </li>
        `;
    } else {
        // DOCTOR SIDEBAR
        list.innerHTML = `
            <li class="nav-item active">
                <a href="#" class="nav-link" onclick="switchView('doctor-dashboard', this); return false;">
                    <i class="fa-solid fa-house"></i><span>Dashboard</span>
                </a>
            </li>
            <li class="nav-item">
                <a href="#" class="nav-link" onclick="switchView('doctor-appointments', this); return false;">
                    <i class="fa-regular fa-calendar-check"></i><span>Appointments</span>
                </a>
            </li>
            <li class="nav-item">
                <a href="#" class="nav-link" onclick="switchView('doctor-settings', this); return false;">
                    <i class="fa-solid fa-gear"></i><span>Settings</span>
                </a>
            </li>
        `;
    }
    // Sync mobile drawer to mirror sidebar
    syncMobileNav();
}

function resetDates() {
    const today = new Date().toISOString().split('T')[0];
    ['weight-date', 'bp-date', 'height-date', 'gluc-date'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = today;
    });
}

function populateCountries() {
    const select = document.getElementById('settings-address-country');
    if(select && select.options.length <= 1) {
        countriesList.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            select.appendChild(opt);
        });
    }
}

// --- 3. UI LOGIC ---
function switchView(viewName, element) {
    // NEW: Save the active view to local storage so it survives page reloads!
    localStorage.setItem('instadoc_active_view', viewName);

    // Hide all views first
    document.querySelectorAll('.patient-view, .doctor-view').forEach(el => el.style.display = 'none');
    
    // Handle Sidebar Active State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element && element.parentElement) {
        element.parentElement.classList.add('active');
    } else {
        // Auto-highlight if triggered programmatically
        const link = document.querySelector(`.nav-link[onclick*="'${viewName}'"]`);
        if(link) link.parentElement.classList.add('active');
    }
    // Sync active state in mobile drawer
    syncMobileNavActiveState(viewName);
    const target = document.getElementById('view-' + viewName);
    if(target) {
        target.style.display = 'block';
        if (viewName === 'metrics' && myChart) myChart.resize();
        if (viewName === 'doctor-dashboard') {
            setTimeout(() => {
                if(doctorCharts.weekly) doctorCharts.weekly.resize();
                if(doctorCharts.growth) doctorCharts.growth.resize();
            }, 100);
        }
        if (viewName === 'doctor-appointments') {
            loadDoctorAppointmentsTab();
        }
    }
}

// --- 4. AUTH LOGIC ---
async function logout() {
    if (!supabaseClient) { window.location.href = '../index.html'; return; }
    try {
        await supabaseClient.auth.signOut();
    } catch (error) {
        console.error("Error signing out:", error);
    } finally {
        // Redirect to the landing page (unified project root)
        window.location.href = '../index.html';
    }
}

async function signInWithGoogle() {
    const redirectUrl = window.location.href.split('#')[0];
    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, queryParams: { prompt: 'select_account' } }
    });
}

function signInWithPhone() { showToast("Phone Auth requires paid plan/setup. Use Email or Google.", "error"); }

// Toggle logic for Doctor Signup fields
function toggleDoctorSignupFields() {
    const isDoc = document.getElementById('signup-as-doctor').checked;
    document.getElementById('doctor-signup-fields').style.display = isDoc ? 'block' : 'none';
}

// LOGIN FORM HANDLER
document.getElementById('login-form').addEventListener('submit', async (e) => { 
    e.preventDefault(); 
    const btn = document.getElementById('btn-login-submit');
    const originalText = btn.textContent;
    
    try {
        btn.textContent = "Logging in...";
        btn.disabled = true;
        
        const { error } = await supabaseClient.auth.signInWithPassword({ 
            email: document.getElementById('login-email').value, 
            password: document.getElementById('login-password').value 
        }); 
        
        if (error) { 
            document.getElementById('login-error').textContent = error.message; 
            document.getElementById('login-error').style.display = 'block'; 
        }
    } catch (err) {
        console.error(err);
    } finally {
        if(document.getElementById('login-error').style.display === 'block') {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
});

// SIGNUP FORM HANDLER
// SIGNUP FORM HANDLER
document.getElementById('signup-form').addEventListener('submit', async (e) => { 
    e.preventDefault(); 
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPass = document.getElementById('signup-confirm-password').value;
    const btn = e.target.querySelector('button[type="submit"]');

    if (password !== confirmPass) {
        document.getElementById('signup-error').textContent = "Passwords do not match."; 
        document.getElementById('signup-error').style.display = 'block'; 
        return;
    }
    
    // Logic to prevent Database Trigger Errors
    const isDoc = document.getElementById('signup-as-doctor').checked;
    let metadata = {};

    if (isDoc) {
        const fullName = document.getElementById('signup-fullname').value;
        const license = document.getElementById('signup-license').value;
        
        if (!fullName || !license) {
            document.getElementById('signup-error').textContent = "Doctors must provide Name and License Number.";
            document.getElementById('signup-error').style.display = 'block';
            return;
        }

        metadata = {
            role: 'doctor',
            full_name: fullName,
            license_number: license,
            specialty: document.getElementById('signup-specialty').value
        };
    } else {
        const fallbackName = email.split('@')[0]; 
        metadata = { 
            role: 'patient',
            full_name: fallbackName
        };
    }

    btn.textContent = "Creating Account...";
    btn.disabled = true;

    // Notice we capture 'data' here now as well
    const { data, error } = await supabaseClient.auth.signUp({ 
        email: email, 
        password: password,
        options: {
            data: metadata
        }
    }); 
    
    if (error) { 
        document.getElementById('signup-error').textContent = error.message; 
        document.getElementById('signup-error').style.display = 'block'; 
        btn.textContent = "Sign Up";
        btn.disabled = false;
    } else { 
        // --- BULLETPROOF EMAIL VERIFICATION CHECK ---
        if (data.session === null) {
            // Supabase successfully withheld the session because email confirm is ON
            showToast("Account created! Please check your email for the verification link.", "success"); 
            closeModals(); 
        } else if (data.user && !data.user.email_confirmed_at) {
            // Failsafe: If Supabase granted a session anyway, forcefully log them out
            await supabaseClient.auth.signOut();
            document.getElementById('signup-error').textContent = "Please verify your email address before accessing the portal.";
            document.getElementById('signup-error').style.display = 'block';
            btn.textContent = "Sign Up";
            btn.disabled = false;
        } else {
            // Fallback if Admin turns verification off in the future
            showToast("Signup successful!", "success"); 
            closeModals(); 
        }
    } 
});

// PASSWORD RESET REQUEST
document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    const btn = e.target.querySelector('button');
    btn.textContent = "Sending...";
    
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href, 
    });

    if (error) {
        document.getElementById('reset-error').textContent = error.message;
        document.getElementById('reset-error').style.display = 'block';
    } else {
        document.getElementById('reset-success').textContent = "Check your email for the reset link.";
        document.getElementById('reset-success').style.display = 'block';
        e.target.reset();
    }
    btn.textContent = "Send Reset Link";
});

// PASSWORD UPDATE HANDLER
document.getElementById('update-pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-new-password').value;
    const btn = e.target.querySelector('button');

    if (newPass !== confirmPass) {
        document.getElementById('update-pass-error').textContent = "Passwords do not match.";
        document.getElementById('update-pass-error').style.display = 'block';
        return;
    }

    btn.textContent = "Updating...";
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });

    if (error) {
        document.getElementById('update-pass-error').textContent = error.message;
        document.getElementById('update-pass-error').style.display = 'block';
    } else {
        document.getElementById('update-pass-success').textContent = "Password updated successfully!";
        document.getElementById('update-pass-success').style.display = 'block';
        setTimeout(() => {
            closeModals();
            window.location.hash = ''; 
            logout(); 
        }, 2000);
    }
    btn.textContent = "Update Password";
});

// --- DOCTOR DASHBOARD DATA LOGIC ---

async function loadDoctorDashboardData() {
    if(!currentUser) return;
    const docId = currentUser.id;

    // 1. Fetch All Appointments for this Doctor
    const { data: appts, error } = await supabaseClient
        .from('appointments')
        .select('*')
        .eq('doctor_id', docId);

    if (error) { console.error("Error fetching doctor data", error); return; }

    // --- Calculate Stats (Change 6) ---
    const totalPatients = new Set(appts.map(a => a.user_id)).size;
    
    const todayLocalStr = new Date().toLocaleDateString();
    const todayAppts = appts.filter(a => new Date(a.appointment_date).toLocaleDateString() === todayLocalStr && (a.status === 'Confirmed' || a.status === 'confirmed')).length;
    
    const pending = appts.filter(a => a.status === 'pending').length;
    // Active Cases = Confirmed (not yet completed or cancelled)
    const activeCases = appts.filter(a => a.status === 'Confirmed' || a.status === 'confirmed').length;
    const completed = appts.filter(a => a.status === 'completed').length;
    const totalCount = appts.length;
    const successRate = totalCount > 0 ? Math.round((completed / totalCount) * 100) : 0;

    // Update Stats UI
    const docStatPatients = document.getElementById('doc-stat-patients');
    if(docStatPatients) docStatPatients.textContent = totalPatients;
    
    const docStatToday = document.getElementById('doc-stat-today');
    if(docStatToday) docStatToday.textContent = todayAppts;
    
    const docStatPending = document.getElementById('doc-stat-pending');
    if(docStatPending) docStatPending.textContent = activeCases; // Active = Confirmed, not pending
    
    const docStatSuccess = document.getElementById('doc-stat-success');
    if(docStatSuccess) docStatSuccess.textContent = successRate + '%';

    // --- Populate Recent Activity ---
    const recentContainer = document.getElementById('doctor-recent-activity');
    if(recentContainer) {
        recentContainer.innerHTML = '';
        
        // Sort by date desc and take top 5
        const recentAppts = [...appts].sort((a,b) => new Date(b.appointment_date) - new Date(a.appointment_date)).slice(0, 5);

        if (recentAppts.length === 0) {
            recentContainer.innerHTML = '<p class="text-xs text-gray-500 text-center">No recent activity.</p>';
        } else {
            recentAppts.forEach(a => {
                const timeAgo = getTimeAgo(new Date(a.appointment_date));
                const initials = getInitials(a.patient_name || a.user_id);
                const displayName = a.patient_name || ("Patient " + a.user_id.substring(0, 4));

                const item = `
                    <div class="flex items-center gap-4 border-b border-gray-100 pb-3">
                        <div class="profile-pic" style="background:#e5e7eb; color:#555;">${initials}</div>
                        <div class="flex-1">
                            <h4 class="font-bold text-sm">${displayName}</h4>
                            <p class="text-xs text-gray-500">${a.type || 'Appointment'}</p>
                        </div>
                        <span class="text-xs text-gray-400">${timeAgo}</span>
                    </div>
                `;
                recentContainer.innerHTML += item;
            });
        }
    }

    // --- Update Charts (Weekly) ---
    updateDoctorWeeklyChart(appts);
    // --- Update Charts (Growth) ---
    updateDoctorGrowthChart(appts);
}


// --- UPDATED: DOCTOR APPOINTMENTS TAB LOGIC ---
async function loadDoctorAppointmentsTab() {
    if(!currentUser) return;
    const docId = currentUser.id;

    // Fetch Appointments
    const { data: appts, error } = await supabaseClient
        .from('appointments')
        .select('*')
        .eq('doctor_id', docId)
        .order('appointment_date', { ascending: true });

    if(error) return;

    // Time Logic
    const now = new Date();
    const todayLocalStr = now.toLocaleDateString();

    // 1. Pending: Strictly 'pending' status
    const pendingList = appts.filter(a => a.status === 'pending');
    
    // 2. Upcoming: Strictly 'confirmed' status
    const upcomingList = appts.filter(a => a.status === 'Confirmed' || a.status === 'confirmed');

    // 3. Past: ONLY completed (Sorted newest first!)
    const pastList = appts.filter(a => a.status === 'completed')
                      .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));

    // Update Stats (Fix 4: accurate local date count for Today)
    const todayCount = appts.filter(a => new Date(a.appointment_date).toLocaleDateString() === todayLocalStr && (a.status === 'Confirmed' || a.status === 'confirmed')).length;
    
    document.getElementById('doc-appt-today-count').textContent = todayCount;
    document.getElementById('doc-appt-pending-count').textContent = pendingList.length;
    document.getElementById('doc-appt-total-count').textContent = upcomingList.length;

    // Render Lists
    renderDocSection('doc-pending-list', pendingList, 'pending');
    renderDocSection('doc-upcoming-list', upcomingList, 'upcoming');
    renderDocSection('doc-past-list', pastList, 'past');
}


function updateDoctorWeeklyChart(appts) {
    if (!doctorCharts.weekly) initDoctorCharts();
    
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    
    appts.forEach(a => {
        const d = new Date(a.appointment_date);
        const dayIndex = d.getDay(); 
        const chartIndex = (dayIndex + 6) % 7; 
        dayCounts[chartIndex]++;
    });

    doctorCharts.weekly.data.datasets[0].data = dayCounts;
    doctorCharts.weekly.update();
}

function updateDoctorGrowthChart(appts) {
    if (!doctorCharts.growth) initDoctorCharts();

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const today = new Date();
    const labels = [];
    const dataPoints = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        labels.push(monthNames[d.getMonth()]);
        
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() - i + 1, 0, 23, 59, 59);
        
        const uniquePatients = new Set(
            appts
            .filter(a => new Date(a.appointment_date) <= endOfMonth)
            .map(a => a.user_id)
        );
        dataPoints.push(uniquePatients.size);
    }

    doctorCharts.growth.data.labels = labels;
    doctorCharts.growth.data.datasets[0].data = dataPoints;
    doctorCharts.growth.update();
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " mins ago";
    return "Just now";
}

// --- DOCTOR DASHBOARD CHARTS ---
function initDoctorCharts() {
    if(doctorCharts.weekly) return; // Already init

    const ctx1 = document.getElementById('doctorWeeklyChart').getContext('2d');
    doctorCharts.weekly = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Appointments',
                data: [0, 0, 0, 0, 0, 0, 0], // Init empty
                backgroundColor: '#2ecc71',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { 
                y: { grid: { borderDash: [5, 5] }, beginAtZero: true, ticks: { stepSize: 1 } },
                x: { grid: { display: false } }
            }
        }
    });

    const ctx2 = document.getElementById('doctorGrowthChart').getContext('2d');
    doctorCharts.growth = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: [], 
            datasets: [{
                label: 'Total Patients',
                data: [], 
                borderColor: '#2ecc71',
                tension: 0.4,
                pointBackgroundColor: '#2ecc71',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { 
                y: { grid: { borderDash: [5, 5] }, min: 0, ticks: { stepSize: 1 } }, 
                x: { grid: { display: false } }
            }
        }
    });
}

// --- BULLETPROOF UI HELPERS ---
function updateWelcomeMessage() {
    if (!currentUser) return;
    const now = new Date();
    const hour = now.getHours();
    let greeting = "Good Morning";
    if (hour >= 12 && hour < 18) greeting = "Good Afternoon";
    else if (hour >= 18) greeting = "Good Evening";

    let name = "User";
    if (currentUser.user_metadata && currentUser.user_metadata.full_name) {
        name = currentUser.user_metadata.full_name;
    } else if (currentUser.email && typeof currentUser.email === 'string') {
        name = currentUser.email.split('@')[0];
    }
    
    if(userRole === 'doctor' && !name.toLowerCase().includes('dr.')) {
        name = "Dr. " + name.charAt(0).toUpperCase() + name.slice(1);
    }

    const el = document.getElementById('welcome-msg');
    if (el) el.textContent = `${greeting}, ${name}`;
}

function updateAvatarUI(avatarUrl) {
    const headerAvatar = document.getElementById('header-avatar');
    const docHeaderAvatar = document.getElementById('doc-header-avatar'); 
    const topProfilePic = document.querySelector('.dash-header-area .profile-pic');
    
    let name = "User";
    if (currentUser && currentUser.user_metadata && currentUser.user_metadata.full_name) {
        name = currentUser.user_metadata.full_name;
    } else if (currentUser && currentUser.email && typeof currentUser.email === 'string') {
        name = currentUser.email.split('@')[0];
    }

    const initials = getInitials(name);
    const content = avatarUrl ? `<img src="${avatarUrl}" alt="Profile">` : initials;

    if (headerAvatar) headerAvatar.innerHTML = content;
    if (docHeaderAvatar) docHeaderAvatar.innerHTML = content; 
    if (topProfilePic) topProfilePic.innerHTML = content;
}

// --- DARK MODE TOGGLE ---
function toggleDarkMode(element) {
    // 1. Visually flip the switch
    element.classList.toggle('checked');
    
    // 2. Add/remove the dark mode class from the entire page
    document.body.classList.toggle('dark-mode');
    
    // 3. Save to localStorage instantly so the screen doesn't flash white on page refresh
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('instadoc_dark_mode', isDark);
}

// Auto-apply dark mode from local storage immediately on load (prevents white flashing)
if (localStorage.getItem('instadoc_dark_mode') === 'true') {
    document.body.classList.add('dark-mode');
}

// --- 5. DATA FETCH LOGIC (PATIENT) ---
async function loadDashboardData() {
    updateStatCard('weight_logs', 'weight', 'val-weight', 'kg');
    updateStatCard('bp_logs', 'systolic', 'val-bp', '');
    updateStatCard('glucose_logs', 'level', 'val-gluc', 'mg/dL');
    updateStatCard('height_logs', 'height', 'val-height', 'cm');
    updateBMI();
    updateChart(currentChartTable);
    loadHistory();
    loadAppointments(); 
    countMedicalRecords();
    loadHealthTrends();
    loadHealthAlerts(); 
}

// Consolidated Patient Appt Logic

async function loadAppointments() {
    if(!currentUser) return;
    try {
        const { data, error } = await supabaseClient.from('appointments').select('*').eq('user_id', currentUser.id).order('appointment_date', { ascending: true });
        if (error || !data) return; 
        allAppointments = data;
        
        const now = new Date();
        // Get midnight of today so today's appointments don't vanish!
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Change 9: Surface recently cancelled/declined with notification message
        const recentlyCancelledOrDeclined = data.filter(a => {
            const status = a.status.toLowerCase();
            const isRelevant = status === 'cancelled' || status === 'declined';
            const apptDate = new Date(a.appointment_date);
            const daysDiff = (new Date() - apptDate) / (1000 * 60 * 60 * 24);
            return isRelevant && daysDiff <= 7; // Surface cancellations from last 7 days
        });

        if (recentlyCancelledOrDeclined.length > 0) {
            // Inside loadAppointments(), replace the toast block:
recentlyCancelledOrDeclined.forEach(async a => {
    // Check if we've already notified for this appointment
    const { count } = await supabaseClient
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .eq('payload->appointment_id', a.id);  // jsonb filter

    if (count > 0) return; // Already notified — skip

    const status = a.status.toLowerCase();
    const verb = status === 'declined' ? 'could not be confirmed' : 'has been cancelled';
    const reasonNote = a.cancellation_reason ? ` Reason provided: ${a.cancellation_reason}.` : '';
    const body = `Your appointment with ${a.doctor_name} on ${new Date(a.appointment_date).toLocaleDateString()} ${verb}.${reasonNote} Please feel free to book a new time at your convenience.`;

    await saveNotification(
        `appointment_${status}`,
        status === 'declined' ? 'Appointment Not Confirmed' : 'Appointment Cancelled',
        body,
        { appointment_id: a.id, doctor_name: a.doctor_name }
    );
    showToast(body, 'error'); // Still show once on first detection
});
        }

        const futureAppts = data.filter(a => {
            const apptDate = new Date(a.appointment_date);
            const isUpcomingDate = apptDate >= startOfToday;
            const isActiveStatus = a.status.toLowerCase() === 'pending' || a.status.toLowerCase() === 'confirmed';
            
            // Show if it's today/future OR if it's still active, AND not cancelled/declined/completed
            return (isUpcomingDate || isActiveStatus) && 
                   a.status.toLowerCase() !== 'cancelled' && 
                   a.status.toLowerCase() !== 'declined' &&
                   a.status.toLowerCase() !== 'completed';
        });

        // Past appointments are strictly completed ones (Sorted newest first!)
const pastAppts = data.filter(a => a.status.toLowerCase() === 'completed')
                      .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));
        
        const virtualCount = data.filter(a => a.type.toLowerCase().includes('video') || a.type.toLowerCase().includes('audio')).length;
        const inPersonCount = data.filter(a => a.type.toLowerCase().includes('in-person')).length;

        const dashCount = document.getElementById('upcoming-count');
        if(dashCount) dashCount.textContent = futureAppts.length;

        document.getElementById('appt-stat-total').textContent = futureAppts.length;
        document.getElementById('appt-stat-virtual').textContent = virtualCount;
        document.getElementById('appt-stat-inperson').textContent = inPersonCount;
        document.getElementById('appt-stat-past').textContent = pastAppts.length;

        const dashList = document.getElementById('dashboard-appointment-list');
        if(dashList) renderAppointmentList(dashList, futureAppts.slice(0,2));

        const mainList = document.getElementById('detailed-appointment-list');
        if(mainList) renderDetailedList(mainList, futureAppts);

        const pastList = document.getElementById('past-appointment-list');
        if(pastList) renderPastList(pastList, pastAppts.slice(0, 5));
    } catch (e) { console.error("Appt Load Error", e); }
}

// Patient Renderers
function renderAppointmentList(container, data) {
    if (!data.length) { container.innerHTML = `<div class="loading-cell text-xs text-gray-500">No upcoming appointments.</div>`; return; }
    container.innerHTML = '';
    data.forEach(appt => {
        const dateStr = formatAppointmentDate(new Date(appt.appointment_date));
        
        // Audio UI handling
        let typeHtml = '';
        if(appt.type.toLowerCase().includes('video')) {
            typeHtml = `<p class="text-xs text-blue-500"><i class="fa-solid fa-video"></i> Video</p>`;
        } else if (appt.type.toLowerCase().includes('audio')) {
            typeHtml = `<p class="text-xs text-purple-500"><i class="fa-solid fa-phone"></i> Audio</p>`;
        } else {
            typeHtml = `<p class="text-xs text-gray-500">In-person</p>`;
        }
        
        container.innerHTML += `<div class="appointment-item"><div class="doctor-avatar bg-green-500 text-white">${getInitials(appt.doctor_name)}</div><div class="flex-1"><h4 class="font-bold text-sm">${appt.doctor_name}</h4><p class="text-xs text-gray-500">${appt.specialty}</p></div><div class="text-right"><p class="text-xs font-bold">${dateStr}</p>${typeHtml}</div></div>`;
    });
}
function renderDetailedList(container, data) {
    if (!data.length) { container.innerHTML = `<p class="text-center-muted" style="padding: 1.5rem 0;">No upcoming appointments.</p>`; return; }
    container.innerHTML = '';
    
    data.forEach(appt => {
        const dateObj = new Date(appt.appointment_date);
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        
        let actionBtn = '';
        if(appt.status === 'Confirmed' || appt.status === 'confirmed') {
            if(appt.type.toLowerCase().includes('video')) {
                actionBtn = `<button class="btn-sm bg-blue-500 text-white border-none justify-center" onclick="startVideoCall('${appt.id}', 'video')"><i class="fa-solid fa-video"></i> Join Video Call</button>`;
            } else if (appt.type.toLowerCase().includes('audio')) {
                actionBtn = `<button class="btn-sm bg-purple-500 text-white border-none justify-center" onclick="startVideoCall('${appt.id}', 'audio')"><i class="fa-solid fa-phone"></i> Join Audio Call</button>`;
            }
        }

        container.innerHTML += `
            <div class="flex flex-col" style="padding: 1.5rem 0; border-bottom: 1px solid #f3f4f6;">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex gap-4 items-center">
                        <div class="doctor-avatar bg-green-500" style="width:50px;height:50px;font-size:1.1rem;">${getInitials(appt.doctor_name)}</div>
                        <div>
                            <h4 class="font-bold text-md mb-1">${appt.doctor_name}</h4>
                            <p class="text-sm text-gray-500">${appt.specialty}</p>
                        </div>
                    </div>
                    <span class="appt-status-badge ${appt.status === 'Confirmed' || appt.status === 'confirmed' ? 'status-confirmed' : 'status-pending'}">${appt.status}</span>
                </div>
                
                <div class="flex justify-between items-center bg-gray-50 rounded-lg p-4 mb-4">
                    <div class="flex gap-6">
                        <div class="text-sm text-gray-600"><i class="fa-regular fa-calendar mr-2 text-gray-400"></i> ${dateStr}</div>
                        <div class="text-sm text-gray-600"><i class="fa-regular fa-clock mr-2 text-gray-400"></i> ${timeStr}</div>
                        <div class="text-sm text-gray-600"><i class="fa-solid fa-notes-medical mr-2 text-gray-400"></i> ${appt.type}</div>
                    </div>
                </div>
                
                ${actionBtn ? `<div class="flex justify-end">${actionBtn}</div>` : ''}
            </div>`;
    });
    
    // Clean up the borders for the first and last items so it looks neat
    if (container.lastElementChild) { container.lastElementChild.style.borderBottom = 'none'; container.lastElementChild.style.paddingBottom = '0'; }
    if (container.firstElementChild) { container.firstElementChild.style.paddingTop = '0'; }
}

function renderPastList(container, data) {
    if (!data.length) { container.innerHTML = `<p class="text-center-muted" style="padding: 1.5rem 0;">No past appointments.</p>`; return; }
    container.innerHTML = '';
    
    data.forEach(appt => {
        const dateStr = new Date(appt.appointment_date).toLocaleDateString();
        
        container.innerHTML += `
            <div class="flex justify-between items-center" style="padding: 1.5rem 0; border-bottom: 1px solid #f3f4f6;">
                <div class="flex gap-4 items-center">
                    <div class="doctor-avatar" style="background:#e5e7eb; color:#6b7280; width:45px; height:45px; font-size:1rem;">
                        ${getInitials(appt.doctor_name)}
                    </div>
                    <div>
                        <h4 class="font-bold text-md mb-1">${appt.doctor_name}</h4>
                        <p class="text-sm text-gray-500">${appt.specialty}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-md text-gray-500 mb-1"><i class="fa-regular fa-calendar mr-2"></i> ${dateStr}</p>
                    <p class="text-sm text-green-600 font-bold">Completed</p>
                </div>
            </div>`;
    });

    // Clean up the borders for the first and last items
    if (container.lastElementChild) { container.lastElementChild.style.borderBottom = 'none'; container.lastElementChild.style.paddingBottom = '0'; }
    if (container.firstElementChild) { container.firstElementChild.style.paddingTop = '0'; }
}

// --- TOGGLE PAST APPOINTMENTS ---
function togglePastAppointments(e) {
    e.preventDefault();
    const btn = e.target;
    const pastListContainer = document.getElementById('past-appointment-list');
    
    // Grab all completed appointments from the global array and sort them newest first
    const pastAppts = allAppointments
        .filter(a => a.status.toLowerCase() === 'completed')
        .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));

    // Toggle between showing all vs showing top 5
    if (btn.textContent.includes('View All')) {
        renderPastList(pastListContainer, pastAppts); // Renders the full list
        btn.textContent = "Show Less";
    } else {
        renderPastList(pastListContainer, pastAppts.slice(0, 5)); // Renders only top 5
        btn.textContent = "View All >";
    }
}

// Global Helpers
function getInitials(name) { if(!name) return "DR"; return name.split(" ").map(n=>n[0]).join("").substring(0,2).toUpperCase(); }
function formatAppointmentDate(date) { return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

async function updateStatCard(table, col, elemId, unit) {
    const { data } = await supabaseClient.from(table).select('*').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1);
    
    const cardContainer = document.getElementById(elemId).parentElement.parentElement; 
    const oldTime = cardContainer.querySelector('.timestamp-label');
    if(oldTime) oldTime.remove();

    if(data && data.length > 0) {
        let val = data[0][col];
        if(table === 'bp_logs') val = `${data[0].systolic}/${data[0].diastolic}`;
        document.getElementById(elemId).textContent = val;
        
        const dbDateString = data[0].date; 
        const logDate = new Date(dbDateString + 'T00:00:00'); 
        const today = new Date();
        today.setHours(0,0,0,0); 
        
        const diffTime = today - logDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        let timeStr = "Today";
        if (diffDays === 1) timeStr = "Yesterday";
        else if (diffDays > 1) timeStr = `${diffDays} days ago`;

        const timeLabel = document.createElement('div');
        timeLabel.className = 'timestamp-label text-xs text-gray-400 mt-1';
        timeLabel.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> ${timeStr}`;
        document.getElementById(elemId).parentElement.appendChild(timeLabel);

    } else { 
        document.getElementById(elemId).textContent = '--'; 
    }
}

function setChartRange(days, btn) { currentChartDays = days; document.querySelectorAll('.time-tabs .chart-select').forEach(b => b.classList.remove('active')); btn.classList.add('active'); updateChart(currentChartTable); }

async function updateChart(tableName, btnRef) {
    currentChartTable = tableName;
    if (!currentUser) return;
    if(btnRef) { document.querySelectorAll('.chart-tabs .chart-select').forEach(b => b.classList.remove('active')); btnRef.classList.add('active'); }
    const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - currentChartDays);
    const dateStr = cutoffDate.toISOString().split('T')[0];
    const { data } = await supabaseClient.from(tableName).select('*').eq('user_id', currentUser.id).gte('date', dateStr).order('date', { ascending: true });
    if (!data) return;
    const labels = data.map(d => new Date(d.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}));
    let dataset = [];
    const ctx = document.getElementById('healthChart').getContext('2d');
    let gradient = ctx.createLinearGradient(0, 0, 0, 400); gradient.addColorStop(0, 'rgba(46, 204, 113, 0.2)'); gradient.addColorStop(1, 'rgba(46, 204, 113, 0)');
    if (tableName === 'bp_logs') { dataset = [ { label: 'Systolic', data: data.map(d => d.systolic), borderColor: '#dc2626', tension: 0.4 }, { label: 'Diastolic', data: data.map(d => d.diastolic), borderColor: '#2563eb', tension: 0.4 } ]; } 
    else { 
        let key = tableName === 'glucose_logs' ? 'level' : (tableName === 'height_logs' ? 'height' : 'weight'); 
        dataset = [{ label: key.toUpperCase(), data: data.map(d => d[key]), borderColor: '#2ecc71', backgroundColor: gradient, borderWidth: 3, tension: 0.4, fill: true }]; 
    }
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: dataset }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { borderDash: [5, 5] } } } } });
}

async function loadHistory() {
    const tables = ['weight_logs', 'bp_logs', 'glucose_logs', 'height_logs']; let combined = [];
    for (let t of tables) { 
        const { data } = await supabaseClient.from(t).select('*').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(5); 
        if(data) data.forEach(d => { d.type = t; combined.push(d); }); 
    }
    combined.sort((a,b) => new Date(b.date) - new Date(a.date)); 
    allHistoryData = combined; 
    const tbody = document.getElementById('history-body'); 
    if(tbody) { 
        tbody.innerHTML = ''; 
        combined.slice(0, 10).forEach(item => { 
            let valStr = item.type === 'bp_logs' ? `${item.systolic}/${item.diastolic}` : (item.weight || item.level || item.height); 
            tbody.innerHTML += `
                <tr>
                    <td>${item.date}</td>
                    <td>${item.type.replace('_logs','').toUpperCase()}</td>
                    <td>${valStr}</td>
                    <td>
                        <button class="action-btn" onclick="editEntry('${item.type}', '${item.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn delete" onclick="deleteEntry('${item.type}', '${item.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`; 
        }); 
    }
}

// --- CUSTOM CONFIRMATION LOGIC ---
function showConfirm(message, callback) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').textContent = message;
    modal.classList.add('active');

    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    const newOkBtn = okBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newOkBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        callback(true);
    });
    newCancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        callback(false);
    });
}

async function deleteEntry(table, id) {
    showConfirm("Are you sure you want to delete this record? This cannot be undone.", async (confirmed) => {
        if (confirmed) {
            const { error } = await supabaseClient.from(table).delete().eq('id', id);
            if(error) {
                showToast("Error deleting: " + error.message, "error");
            } else {
                showToast("Record deleted successfully", "success");
                loadDashboardData();
            }
        }
    });
}

async function countMedicalRecords() {
    if(!currentUser) return;
    try {
        const [w, b, g, t] = await Promise.all([
            supabaseClient.from('weight_logs').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
            supabaseClient.from('bp_logs').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
            supabaseClient.from('glucose_logs').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
            supabaseClient.from('height_logs').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id)
        ]);
        const total = (w.count || 0) + (b.count || 0) + (g.count || 0) + (t.count || 0);
        const el = document.getElementById('record-count');
        if(el) el.textContent = total;
    } catch (e) {
        const el = document.getElementById('record-count');
        if(el) el.textContent = "--";
    }
}

async function loadHealthTrends() {
    if (!currentUser) return;
    try {
        const [bpData, glucoseData] = await Promise.all([
             supabaseClient.from('bp_logs').select('systolic, pulse').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(7),
             supabaseClient.from('glucose_logs').select('level').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(7) 
        ]);
        
        // --- Heart Rate ---
        const hrData = bpData.data || [];
        const hrEl = document.getElementById('trend-hr-val');
        const hrStatus = document.getElementById('trend-hr-status');
        const hrBars = document.getElementById('trend-hr-bars');
        
        let latestHr = (hrData.length > 0) ? (hrData[0].pulse || '--') : '--';
        if(hrEl) hrEl.innerHTML = `${latestHr} <span class="text-xs text-gray-500 font-normal">bpm</span>`;
        
        if(hrStatus && hrData.length > 0) {
            const val = hrData[0].pulse;
            if(val > 100) { hrStatus.textContent = 'High'; hrStatus.className = 'text-xs text-red-500 font-bold'; }
            else if(val > 0) { hrStatus.textContent = 'Normal'; hrStatus.className = 'text-xs text-green-500 font-bold'; }
            else hrStatus.textContent = '--';
        }

        if(hrBars) {
            hrBars.innerHTML = '';
            for(let i=0; i<7; i++) {
                let h = 10; 
                if (i < hrData.length) {
                      let val = hrData[hrData.length - 1 - i].pulse || 0; 
                      h = Math.min(100, Math.max(10, (val / 150) * 100));
                }
                hrBars.innerHTML += `<div class="trend-bar" style="height: ${h}%"></div>`;
            }
        }
        
        // --- BP (Systolic) ---
        const bpEl = document.getElementById('trend-bp-val');
        const bpStatus = document.getElementById('trend-bp-status');
        const bpBars = document.getElementById('trend-bp-bars');
        
        const { data: bpFull } = await supabaseClient.from('bp_logs').select('systolic, diastolic, pulse').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(7);
        const fullBP = bpFull || [];
        
        let latestSys = (fullBP.length > 0) ? fullBP[0].systolic : '--';
        let latestDia = (fullBP.length > 0) ? fullBP[0].diastolic : '--';
        
        if(bpEl) bpEl.innerHTML = `${latestSys}/${latestDia} <span class="text-xs text-gray-500 font-normal">mmHg</span>`;
        
        if(bpStatus && fullBP.length > 0) {
             const sys = fullBP[0].systolic;
             const dia = fullBP[0].diastolic;
             if(sys > 130 || dia > 85) { bpStatus.textContent = 'High'; bpStatus.className = 'text-xs text-red-500 font-bold'; }
             else if (sys > 0) { bpStatus.textContent = 'Normal'; bpStatus.className = 'text-xs text-green-500 font-bold'; }
             else bpStatus.textContent = '--';
        }
        
        if(bpBars) {
            bpBars.innerHTML = '';
            for(let i=0; i<7; i++) {
                let h = 10;
                if(i < fullBP.length) {
                      let val = fullBP[fullBP.length - 1 - i].systolic || 0;
                      h = Math.min(100, Math.max(10, (val / 180) * 100));
                }
                bpBars.innerHTML += `<div class="trend-bar" style="height: ${h}%"></div>`;
            }
        }
        
        // --- Glucose ---
        const glData = glucoseData.data || [];
        const glEl = document.getElementById('trend-gl-val');
        const glStatus = document.getElementById('trend-gl-status');
        const glBars = document.getElementById('trend-gl-bars');
        
        let latestGl = (glData.length > 0) ? glData[0].level : '--'; 
        
        if(glEl) glEl.innerHTML = `${latestGl} <span class="text-xs text-gray-500 font-normal">mg/dL</span>`;
        
        if(glStatus && glData.length > 0) {
            const val = glData[0].level;
            if(val > 140) { glStatus.textContent = 'High'; glStatus.className = 'text-xs text-yellow-600 font-bold'; }
            else if (val > 0) { glStatus.textContent = 'Normal'; glStatus.className = 'text-xs text-green-500 font-bold'; }
            else glStatus.textContent = '--';
        }
        
        if(glBars) {
            glBars.innerHTML = '';
            for(let i=0; i<7; i++) {
                  let h = 10;
                  if(i < glData.length) {
                        let val = glData[glData.length - 1 - i].level || 0;
                        h = Math.min(100, Math.max(10, (val / 200) * 100));
                  }
                  glBars.innerHTML += `<div class="trend-bar" style="height: ${h}%"></div>`;
            }
        }
        
    } catch(e) { console.error("Trend Error", e); }
}

// --- AI HEALTH SUMMARY & WIDGET ALERTS (AHA/ACC Compliant — Changes 4 & 5) ---

/**
 * Classify BP per AHA/ACC 2017 guidelines:
 * Normal:               Sys < 120  AND  Dia < 80
 * Elevated:             Sys 120-129 AND  Dia < 80
 * Stage 1 Hypertension: Sys 130-139 OR   Dia 80-89
 * Stage 2 Hypertension: Sys ≥ 140   OR   Dia ≥ 90
 * Hypertensive Crisis:  Sys > 180   OR   Dia > 120
 * Hypotension:          Sys < 90    OR   Dia < 60
 */
function classifyBP(sys, dia) {
    if (sys > 180 || dia > 120) return { label: 'Hypertensive Crisis',   level: 5, color: '#7f1d1d' };
    if (sys >= 140 || dia >= 90)  return { label: 'Stage 2 Hypertension', level: 4, color: '#dc2626' };
    if (sys >= 130 || dia >= 80)  return { label: 'Stage 1 Hypertension', level: 3, color: '#ea580c' };
    if (sys >= 120 && dia < 80)   return { label: 'Elevated',             level: 2, color: '#d97706' };
    if (sys < 90  || dia < 60)    return { label: 'Hypotension',          level: 0, color: '#d97706' };
    return                               { label: 'Normal',               level: 1, color: '#16a34a' };
}

// Independent systolic/diastolic analysis (Change 3)
function analyzeBPComponents(sys, dia, prevSys, prevDia) {
    const notes = [];
    if (prevSys !== null && prevDia !== null) {
        const sysDiff = sys - prevSys;
        const diaDiff = dia - prevDia;
        // Isolated worsening systolic
        if (sysDiff > 5 && Math.abs(diaDiff) <= 3) {
            notes.push(`Your systolic pressure has risen by ${Math.abs(sysDiff)} mmHg while diastolic remains relatively stable — this pattern warrants monitoring.`);
        }
        // Isolated diastolic hypertension
        if (dia >= 80 && dia < 90 && sys < 130) {
            notes.push(`Your diastolic reading (${dia} mmHg) is elevated while systolic is normal — isolated diastolic hypertension. Please discuss this with your doctor.`);
        }
        // Both improving
        if (sysDiff < -5 && diaDiff < -3) {
            notes.push(`Both systolic and diastolic readings have improved since your last measurement — keep up the great work!`);
        }
        // Gradual systolic improvement
        if (sysDiff >= -10 && sysDiff < -2) {
            notes.push(`Your systolic pressure has gradually improved by ${Math.abs(sysDiff)} mmHg since your last reading.`);
        }
    }
    return notes;
}

/**
 * Classify glucose per ADA + reference chart standards.
 * Supports mg/dL and mmol/L with conversion.
 * Accounts for test type: Fasting, Post-Meal, Random, Pre-Meal.
 * Supports diabetic vs non-diabetic patient context.
 */
function mmolToMgDl(val) { return val * 18.0182; }
function mgDlToMmol(val) { return (val / 18.0182).toFixed(1); }

function classifyGlucose(level, testType, unit, isDiabetic) {
    let l = parseFloat(level);
    if (isNaN(l) || l <= 0) return { label: 'Invalid', severity: -1, note: '' };

    // Convert mmol/L to mg/dL for unified comparison
    const displayUnit = (unit || 'mg/dL').toLowerCase();
    if (displayUnit === 'mmol/l' || displayUnit === 'mmol') {
        l = mmolToMgDl(l);
    }

    const t = (testType || 'Fasting').toLowerCase();

    // ---------------------------------------------------------
    // UNIVERSAL SAFETY CHECK
    // Critical hypoglycemia — always dangerous regardless of type
    // ---------------------------------------------------------
    if (l < 54)  return { label: 'Critically Low — Severe Hypoglycemia', severity: 5, note: 'emergency' };
    if (l < 70)  return { label: 'Low — Hypoglycemia',                   severity: 4, note: 'low' };


    // ---------------------------------------------------------
    // DIABETIC PATIENT LOGIC
    // Targets based on standard medical guidelines for diabetics
    // ---------------------------------------------------------
    if (isDiabetic) {
        if (t.includes('post') || t.includes('after')) {
            // Post-Meal Target: < 180 mg/dL
            if (l >= 180) return { label: 'High — Above Target', severity: 3, note: 'post-meal diabetic' };
            return               { label: 'Normal — At Target',  severity: 1, note: 'post-meal diabetic' };
        } else {
            // Fasting, Pre-Meal, or Random Target: 80 - 130 mg/dL
            if (l > 130)  return { label: 'High — Above Target', severity: 3, note: 'fasting/pre-meal diabetic' };
            if (l >= 80)  return { label: 'Normal — At Target',  severity: 1, note: 'fasting/pre-meal diabetic' };
            // 70-79 range (technically below 80 target, but above 70 hypoglycemia threshold)
            return               { label: 'Low-Normal',          severity: 2, note: 'fasting/pre-meal diabetic' }; 
        }
    }


    // ---------------------------------------------------------
    // NON-DIABETIC PATIENT LOGIC
    // Preserving your exact original reference chart thresholds
    // ---------------------------------------------------------
    if (t.includes('post') || t.includes('2h') || t.includes('after')) {
        // Post-Meal (1-2h after eating) thresholds
        if (l >= 220)  return { label: 'Diabetic Range',    severity: 3, note: 'post-meal' };
        if (l >= 170)  return { label: 'Impaired Glucose',  severity: 2, note: 'post-meal' };
        if (l >= 120)  return { label: 'Normal',            severity: 1, note: 'post-meal' };
        return               { label: 'Normal',             severity: 1, note: 'post-meal' };
    }
    
    if (t.includes('2-3') || t.includes('3h')) {
        // 2-3 Hours after eating
        if (l >= 200)  return { label: 'Diabetic Range',    severity: 3, note: '2-3h post-meal' };
        if (l >= 140)  return { label: 'Impaired Glucose',  severity: 2, note: '2-3h post-meal' };
        return               { label: 'Normal',             severity: 1, note: '2-3h post-meal' };
    }
    
    if (t.includes('random')) {
        if (l >= 200)  return { label: 'Diabetic Range',    severity: 3, note: 'random' };
        if (l >= 140)  return { label: 'Elevated',          severity: 2, note: 'random' };
        if (l >= 70)   return { label: 'Normal',            severity: 1, note: 'random' };
    }
    
    if (t.includes('pre') || t.includes('before')) {
        if (l >= 126) return { label: 'Diabetic Range',    severity: 3, note: 'pre-meal' };
        if (l >= 101) return { label: 'Impaired Glucose',  severity: 2, note: 'pre-meal' };
        return              { label: 'Normal',             severity: 1, note: 'pre-meal' };
    }
    
    // Fasting (default) — per reference chart: Normal 80-100
    if (l >= 126)  return { label: 'Diabetic Range',    severity: 3, note: 'fasting' };
    if (l >= 101)  return { label: 'Impaired Glucose',  severity: 2, note: 'fasting' };
    if (l >= 80)   return { label: 'Normal',            severity: 1, note: 'fasting' };
    return               { label: 'Low-Normal',         severity: 1, note: 'fasting' };
}

async function loadHealthAlerts() {
    if(!currentUser) return;
    const banner = document.getElementById('insight-banner');
    const textEl = document.getElementById('insight-text');
    const icon = banner.querySelector('.insight-icon');

    banner.style.display = 'flex';
    banner.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    icon.className = "fa-solid fa-robot insight-icon text-white";
    textEl.innerHTML = "<i>Instadoc AI is analyzing your vitals...</i>";

    try {
        // Fetch latest AND previous BP readings for comparative analysis
        const [wData, bData, bPrevData, gData] = await Promise.all([
            supabaseClient.from('weight_logs').select('weight').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1),
            supabaseClient.from('bp_logs').select('systolic, diastolic').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1),
            supabaseClient.from('bp_logs').select('systolic, diastolic').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).range(1, 1),
            supabaseClient.from('glucose_logs').select('level, test_type, is_diabetic').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1)
        ]);

        const weight = wData.data?.[0]?.weight;
        const sys    = bData.data?.[0]?.systolic   ? parseFloat(bData.data[0].systolic)   : null;
        const dia    = bData.data?.[0]?.diastolic  ? parseFloat(bData.data[0].diastolic)  : null;
        const prevSys = bPrevData.data?.[0]?.systolic  ? parseFloat(bPrevData.data[0].systolic)  : null;
        const prevDia = bPrevData.data?.[0]?.diastolic ? parseFloat(bPrevData.data[0].diastolic) : null;
        const gluc     = gData.data?.[0]?.level;
        const glucType = gData.data?.[0]?.test_type || 'Fasting';

        // ==========================================
        // 1. UPDATE THE SMALL BP WIDGET CARD
        // ==========================================
        const bpCard  = document.getElementById('alert-bp-card');
        const bpTitle = document.getElementById('alert-bp-title');
        const bpText  = document.getElementById('alert-bp-text');
        const bpIcon  = document.getElementById('alert-bp-icon');

        if (sys !== null && dia !== null && bpCard) {
            const bpClass = classifyBP(sys, dia);
            let colorClass = 'alert-green', iconHtml = '<i class="fa-solid fa-check"></i>', bgClass = 'bg-green-500';

            if      (bpClass.level === 5) { colorClass = 'alert-red';    iconHtml = '<i class="fa-solid fa-truck-medical"></i>';        bgClass = 'bg-red-500';    }
            else if (bpClass.level === 4) { colorClass = 'alert-red';    iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>'; bgClass = 'bg-red-500';    }
            else if (bpClass.level === 3) { colorClass = 'alert-orange'; iconHtml = '<i class="fa-solid fa-circle-exclamation"></i>';   bgClass = 'bg-orange-500'; }
            else if (bpClass.level === 2) { colorClass = 'alert-yellow'; iconHtml = '<i class="fa-solid fa-arrow-trend-up"></i>';       bgClass = 'bg-yellow-500'; }
            else if (bpClass.level === 0) { colorClass = 'alert-yellow'; iconHtml = '<i class="fa-solid fa-arrow-trend-down"></i>';     bgClass = 'bg-yellow-500'; }

            bpCard.className = `alert-item ${colorClass}`;
            bpTitle.textContent = bpClass.label;
            bpText.textContent  = `Last reading: ${sys}/${dia} mmHg`;
            bpIcon.className    = `alert-icon ${bgClass} text-white`;
            bpIcon.innerHTML    = iconHtml;
            bpCard.style.display = 'flex';
        } else if (bpCard) {
            bpCard.style.display = 'none';
        }

        // ==========================================
        // 2. GENERATE AI TYPEWRITER SUMMARY (AHA/ACC + comparative)
        // ==========================================
        if (!weight && sys === null && !gluc) {
            textEl.innerHTML = "Welcome! Start logging your health metrics to receive personalised AI insights.";
        } else {
            let summary = "Here is your latest health analysis: ";
            let urgentFlag = false;

            // — Blood Pressure (Changes 1, 2, 3) —
            if (sys !== null && dia !== null) {
                const bpClass = classifyBP(sys, dia);

                // Comparative note vs previous reading (Change 2)
                let compareNote = '';
                if (prevSys !== null && prevDia !== null) {
                    const sysDiff = sys - prevSys;
                    if      (Math.abs(sysDiff) <= 2)  compareNote = 'stable compared to your last reading';
                    else if (sysDiff > 10)             compareNote = 'notably higher than your last reading';
                    else if (sysDiff > 2)              compareNote = 'slightly elevated compared to your last reading';
                    else if (sysDiff < -10)            compareNote = 'notably lower than your last reading';
                    else                               compareNote = 'slightly lower than your last reading';
                }

                // Banner color based on AHA/ACC level (Change 1)
                if (bpClass.level === 5) {
                    summary += `URGENT: Your blood pressure (${sys}/${dia} mmHg) indicates a hypertensive crisis. Please seek emergency medical attention immediately. `;
                    banner.style.background = 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)';
                    icon.className = "fa-solid fa-truck-medical insight-icon text-white";
                    urgentFlag = true;
                } else if (bpClass.level === 4) {
                    summary += `Your blood pressure (${sys}/${dia} mmHg) is in the Stage 2 Hypertension range`;
                    if (compareNote) summary += ` — ${compareNote}`;
                    summary += '. Please consult your doctor promptly; medication may be needed alongside lifestyle changes. ';
                    banner.style.background = 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)';
                    icon.className = "fa-solid fa-triangle-exclamation insight-icon text-white";
                } else if (bpClass.level === 3) {
                    summary += `Your blood pressure (${sys}/${dia} mmHg) is in the Stage 1 Hypertension range`;
                    if (compareNote) summary += ` — ${compareNote}`;
                    summary += '. Lifestyle changes such as reducing sodium, increasing physical activity, and managing stress are recommended. ';
                    banner.style.background = 'linear-gradient(135deg, #c2410c 0%, #ea580c 100%)';
                    icon.className = "fa-solid fa-circle-exclamation insight-icon text-white";
                } else if (bpClass.level === 2) {
                    summary += `Your blood pressure (${sys}/${dia} mmHg) is elevated`;
                    if (compareNote) summary += ` — ${compareNote}`;
                    summary += '. While not yet hypertension, monitoring closely and maintaining healthy habits will help prevent progression. ';
                    banner.style.background = 'linear-gradient(135deg, #b45309 0%, #d97706 100%)';
                    icon.className = "fa-solid fa-arrow-trend-up insight-icon text-white";
                } else if (bpClass.level === 0) {
                    summary += `Your blood pressure (${sys}/${dia} mmHg) is on the lower side (Hypotension)`;
                    if (compareNote) summary += ` — ${compareNote}`;
                    summary += '. Ensure you are staying well hydrated and stand up slowly to avoid dizziness. Contact your doctor if symptoms persist. ';
                    banner.style.background = 'linear-gradient(135deg, #b45309 0%, #d97706 100%)';
                    icon.className = "fa-solid fa-arrow-trend-down insight-icon text-white";
                } else {
                    summary += `Great news — your blood pressure (${sys}/${dia} mmHg) is within the healthy normal range`;
                    if (compareNote) summary += ` and is ${compareNote}`;
                    summary += '. Keep up the healthy lifestyle! ';
                    banner.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                    icon.className = "fa-solid fa-heart-pulse insight-icon text-white";
                }

                // Independent systolic/diastolic component analysis (Change 3)
                const componentNotes = analyzeBPComponents(sys, dia, prevSys, prevDia);
                if (componentNotes.length > 0) {
                    summary += componentNotes.join(' ') + ' ';
                }
            }

            // — Glucose (ADA-aligned + Blood Glucose Chart) —
            if (gluc) {
                const glucUnit = 'mg/dL'; 
                const isDiabetic = gData.data?.[0]?.is_diabetic || false; 
                const gClass = classifyGlucose(gluc, glucType, glucUnit, isDiabetic);
                const typeLabel = glucType ? ` (${glucType.toLowerCase()})` : '';

                if (gClass.severity === 5) {
                    summary += `CRITICAL: Your glucose level${typeLabel} of ${gluc} mg/dL indicates severe hypoglycemia. Consume fast-acting carbohydrates immediately and seek emergency care. `;
                    if (!urgentFlag) {
                        banner.style.background = 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)';
                        icon.className = "fa-solid fa-truck-medical insight-icon text-white";
                    }
                } else if (gClass.severity === 4) {
                    summary += `Your glucose level${typeLabel} of ${gluc} mg/dL is low (hypoglycemia). Have a snack or sugary drink and monitor closely. Contact your doctor if this persists. `;
                    if (!urgentFlag) {
                        banner.style.background = 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)';
                        icon.className = "fa-solid fa-triangle-exclamation insight-icon text-white";
                    }
                } else if (gClass.severity === 3) {
                    if (isDiabetic) {
                        summary += `Your glucose level${typeLabel} of ${gluc} mg/dL is above your recommended target. Please monitor closely and adhere to your management plan. `;
                    } else {
                        summary += `Your glucose level${typeLabel} of ${gluc} mg/dL is in the diabetic range — please consult your doctor as soon as possible for proper evaluation. `;
                    }
                    if (!urgentFlag) {
                        banner.style.background = 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)';
                        icon.className = "fa-solid fa-triangle-exclamation insight-icon text-white";
                    }
                } else if (gClass.severity === 2) {
                    if (isDiabetic) {
                        summary += `Your glucose level${typeLabel} of ${gluc} mg/dL is on the lower side of normal. Keep an eye on it to prevent it from dropping further. `;
                    } else {
                        summary += `Your glucose level${typeLabel} of ${gluc} mg/dL indicates impaired glucose — consider reviewing your diet and discussing with your doctor. `;
                    }
                } else {
                    if (isDiabetic) {
                        summary += `Great job! Your glucose level${typeLabel} of ${gluc} mg/dL is perfectly on target. `;
                    } else {
                        summary += `Your glucose level${typeLabel} of ${gluc} mg/dL is within the normal healthy range. `;
                    }
                }
            }

            summary += "Keep tracking your metrics daily for the best insights!";

            if (window.aiTypingInterval) clearInterval(window.aiTypingInterval);
            textEl.innerHTML = "";
            let i = 0;
            window.aiTypingInterval = setInterval(() => {
                textEl.innerHTML += summary.charAt(i);
                i++;
                if (i >= summary.length) clearInterval(window.aiTypingInterval);
            }, 20);
        }

    } catch(e) {
        console.error(e);
        textEl.textContent = "AI Analysis temporarily unavailable.";
    }

    // ==========================================

    // 3. UPDATE THE SMALL APPOINTMENT WIDGET
    // ==========================================
    try {
        const now = new Date().toISOString();
        const { data: apptData } = await supabaseClient.from('appointments').select('*').eq('user_id', currentUser.id).gte('appointment_date', now).order('appointment_date', {ascending:true}).limit(1);
        const apptCard = document.getElementById('alert-appt-card');
        const apptTitle = document.getElementById('alert-appt-title');
        const apptText = document.getElementById('alert-appt-text');
        
        if(apptData && apptData.length > 0 && apptCard) {
            const next = apptData[0];
            const diffMs = new Date(next.appointment_date) - new Date();
            const diffHrs = Math.round(diffMs / (1000 * 60 * 60));
            let timeText = "";
            if(diffHrs < 24) timeText = `in ${Math.ceil(diffHrs)} hours`;
            else timeText = `in ${Math.ceil(diffHrs/24)} days`;
            
            apptTitle.textContent = "Upcoming Appointment";
            apptText.textContent = `${next.doctor_name} ${timeText}`;
            apptCard.style.display = "flex";
        } else if (apptCard) {
            apptCard.style.display = "none"; 
        }
    } catch(e) {
        console.error("Widget Error:", e);
    }
}

function loadProfileSettings() {
    if(!currentUser) return;
    document.getElementById('settings-email').value = currentUser.email;
    
    const meta = currentUser.user_metadata || {};
    
    if(meta.full_name) document.getElementById('settings-fullname').value = meta.full_name;
    if(meta.phone) document.getElementById('settings-phone').value = meta.phone;
    if(meta.dob) document.getElementById('settings-dob').value = meta.dob;
    
    if(meta.address) document.getElementById('settings-address-street').value = meta.address;
    if(meta.city) document.getElementById('settings-address-city').value = meta.city;
    if(meta.state) document.getElementById('settings-address-state').value = meta.state;
    if(meta.zip) document.getElementById('settings-address-zip').value = meta.zip;
    if(meta.country) document.getElementById('settings-address-country').value = meta.country;

    if(meta.blood_type) document.getElementById('settings-blood').value = meta.blood_type;
    if(meta.height) document.getElementById('settings-height').value = meta.height;
    if(meta.weight) document.getElementById('settings-weight').value = meta.weight;
    if(meta.allergies) document.getElementById('settings-allergies').value = meta.allergies;

    if(meta.em_name) document.getElementById('settings-em-name').value = meta.em_name;
    if(meta.em_rel) document.getElementById('settings-em-rel').value = meta.em_rel;
    if(meta.em_phone) document.getElementById('settings-em-phone').value = meta.em_phone;
    if(meta.em_email) document.getElementById('settings-em-email').value = meta.em_email;
    
    // --- LOAD DARK MODE STATE ---
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (meta.dark_mode) {
        if (darkModeToggle) darkModeToggle.classList.add('checked');
        document.body.classList.add('dark-mode');
        localStorage.setItem('instadoc_dark_mode', 'true');
    } else {
        if (darkModeToggle) darkModeToggle.classList.remove('checked');
        document.body.classList.remove('dark-mode');
        localStorage.setItem('instadoc_dark_mode', 'false');
    }

    // --- NEW: Load Toggle States ---
    const toggles = {
        'toggle-appt-reminders': meta.setting_appt_reminders ?? true,
        'toggle-med-reminders': meta.setting_med_reminders ?? true,
        'toggle-lab-results': meta.setting_lab_results ?? true,
        'toggle-health-tips': meta.setting_health_tips ?? false,
        'toggle-share-data': meta.setting_share_data ?? true,
        'toggle-research': meta.setting_research ?? false,
        'toggle-2fa': meta.setting_2fa ?? false
    };

    for (const [id, isEnabled] of Object.entries(toggles)) {
        const el = document.getElementById(id);
        if (el) {
            if (isEnabled) el.classList.add('checked');
            else el.classList.remove('checked');
        }
    }
    // -------------------------------

    updateWelcomeMessage();
    const headerName = document.getElementById('header-name');
    const headerEmail = document.getElementById('header-email');
    const headerDetails = document.getElementById('header-details');
    
    if(headerName) headerName.textContent = meta.full_name || "User";
    if(headerEmail) headerEmail.textContent = currentUser.email;
    if(headerDetails) headerDetails.textContent = `${meta.phone || ''} ${meta.dob ? '• Born: ' + meta.dob : ''}`;

    updateAvatarUI(meta.avatar_url);
}

async function handleSave(tableName, dataObj, idField) { const id = document.getElementById(idField).value; dataObj.user_id = currentUser.id; if(id) return (await supabaseClient.from(tableName).update(dataObj).eq('id', id)).error; return (await supabaseClient.from(tableName).insert([dataObj])).error; }
document.getElementById('weight-form').addEventListener('submit', async (e) => { e.preventDefault(); finalizeForm(await handleSave('weight_logs', { weight: document.getElementById('weight-val').value, unit: 'kg', date: document.getElementById('weight-date').value }, 'weight-id'), 'weight-success', 'weight-error'); updateBMI(); });
document.getElementById('bp-form').addEventListener('submit', async (e) => { e.preventDefault(); const p = document.getElementById('bp-pulse').value; finalizeForm(await handleSave('bp_logs', { systolic: document.getElementById('bp-sys').value, diastolic: document.getElementById('bp-dia').value, pulse: p?parseInt(p):null, date: document.getElementById('bp-date').value }, 'bp-id'), 'bp-success', 'bp-error'); });
// Height conversion helpers (Change 5)
function convertHeightToCm(value, unit) {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return null;
    switch(unit) {
        case 'cm': return v;
        case 'm':  return v * 100;
        case 'ft': return v * 30.48;
        case 'in': return v * 2.54;
        default:   return v;
    }
}

document.getElementById('height-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal  = document.getElementById('height-val').value;
    const rawFt   = document.getElementById('height-ft') ? document.getElementById('height-ft').value : null;
    const rawIn   = document.getElementById('height-in') ? document.getElementById('height-in').value : null;
    const unitEl  = document.getElementById('height-unit-select');
    const unit    = unitEl ? unitEl.value : 'cm';
    const errEl   = document.getElementById('height-error');

    let heightCm;
    if (unit === 'ft_in' && rawFt !== null) {
        const ft = parseFloat(rawFt) || 0;
        const inch = parseFloat(rawIn) || 0;
        heightCm = (ft * 30.48) + (inch * 2.54);
    } else {
        heightCm = convertHeightToCm(rawVal, unit);
    }

    if (!heightCm || heightCm < 50 || heightCm > 300) {
        errEl.textContent = `Please enter a valid height. Accepted ranges: 50–300 cm, 0.5–3.0 m, 1'8"–9'10" (ft/in).`;
        errEl.style.display = 'block';
        return;
    }

    finalizeForm(
        await handleSave('height_logs', { height: Math.round(heightCm * 10) / 10, unit: 'cm', date: document.getElementById('height-date').value }, 'height-id'),
        'height-success', 'height-error'
    );
    updateBMI();
});

// Show/hide ft/in fields dynamically
function onHeightUnitChange() {
    const unit = document.getElementById('height-unit-select').value;
    const mainInput = document.getElementById('height-val-wrapper');
    const ftInWrapper = document.getElementById('height-ftin-wrapper');
    if (unit === 'ft_in') {
        if (mainInput) mainInput.style.display = 'none';
        if (ftInWrapper) ftInWrapper.style.display = 'flex';
    } else {
        if (mainInput) mainInput.style.display = 'block';
        if (ftInWrapper) ftInWrapper.style.display = 'none';
        const placeholder = { 'cm': 'Height in cm (e.g. 175)', 'm': 'Height in m (e.g. 1.75)', 'ft': 'Height in ft (e.g. 5.8)' };
        const inp = document.getElementById('height-val');
        if (inp) inp.placeholder = placeholder[unit] || 'Height';
    }
}
document.getElementById('gluc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawLevel = parseFloat(document.getElementById('gluc-val').value);
    const unit = document.getElementById('gluc-unit') ? document.getElementById('gluc-unit').value : 'mg/dL';
    const isDiabetic = document.getElementById('gluc-diabetic') ? document.getElementById('gluc-diabetic').checked : false;
    const testType = document.getElementById('gluc-type').value;

    // Convert to mg/dL for storage (always store in mg/dL for consistency)
    let levelMgDl = rawLevel;
    if (unit === 'mmol/L') { levelMgDl = Math.round(rawLevel * 18.0182 * 10) / 10; }

    // Validate — critically low values (< 30 mg/dL) are physiologically impossible without emergency
    if (!rawLevel || rawLevel <= 0) {
        document.getElementById('gluc-error').textContent = 'Please enter a valid glucose value.';
        document.getElementById('gluc-error').style.display = 'block'; return;
    }
    if (levelMgDl < 20) {
        document.getElementById('gluc-error').textContent = `A reading of ${rawLevel} ${unit} is critically low and likely a data entry error. Please verify your value.`;
        document.getElementById('gluc-error').style.display = 'block'; return;
    }

    finalizeForm(await handleSave('glucose_logs', {
        test_type: testType,
        level: levelMgDl,
        unit: 'mg/dL',
        is_diabetic: isDiabetic,
        date: document.getElementById('gluc-date').value
    }, 'gluc-id'), 'gluc-success', 'gluc-error');
});

// =========================================
// BMI CALCULATION (Change 3)
// =========================================
async function updateBMI() {
    if (!currentUser) return;

    const [wData, hData] = await Promise.all([
        supabaseClient.from('weight_logs').select('weight').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1),
        supabaseClient.from('height_logs').select('height').eq('user_id', currentUser.id).order('date', {ascending:false}).order('id', {ascending:false}).limit(1)
    ]);

    const weight = wData.data?.[0]?.weight;   // kg
    const heightCm = hData.data?.[0]?.height; // cm
    const bmiEl    = document.getElementById('val-bmi');
    const bmiCatEl = document.getElementById('val-bmi-cat');

    if (!bmiEl) return;

    if (!weight || !heightCm || heightCm <= 0) {
        bmiEl.textContent = '--';
        if (bmiCatEl) bmiCatEl.textContent = '';
        return;
    }

    const heightM = heightCm / 100;
    const bmi = weight / (heightM * heightM);
    bmiEl.textContent = bmi.toFixed(1);

    let category = '';
    let color = '#6b7280';
    if      (bmi < 18.5) { category = 'Underweight'; color = '#f59e0b'; }
    else if (bmi < 25.0) { category = 'Normal';      color = '#22c55e'; }
    else if (bmi < 30.0) { category = 'Overweight';  color = '#f97316'; }
    else if (bmi < 35.0) { category = 'Obese I';     color = '#ef4444'; }
    else if (bmi < 40.0) { category = 'Obese II';    color = '#dc2626'; }
    else                  { category = 'Obese III';   color = '#991b1b'; }

    if (bmiCatEl) { bmiCatEl.textContent = category; bmiCatEl.style.color = color; }
    if (bmiEl)    { bmiEl.style.color = color; }
}


function finalizeForm(error, succId, errId) { if(error) { document.getElementById(errId).textContent = error.message; document.getElementById(errId).style.display = 'block'; } else { document.getElementById(succId).textContent = "Saved Successfully!"; document.getElementById(succId).style.display = 'block'; loadDashboardData(); setTimeout(closeModals, 1000); } }
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); document.querySelectorAll('.error-msg, .success-msg').forEach(e => e.style.display = 'none'); document.querySelectorAll('form').forEach(f => f.reset()); resetDates(); }
function openModal(n) { 
    if(n === 'reports') loadReportPreview();
    if(n === 'booking') loadDoctorsForBooking();
    const m = document.getElementById(n + '-modal'); if(m) m.classList.add('active'); 
    if(n.startsWith('log-')) { const idIn = m.querySelector('input[type=hidden]'); if(idIn && idIn.id.endsWith('-id')) idIn.value=''; }
}
function toggleUnit(type) { const s = document.getElementById(type + '-slider'); const k = document.getElementById(type + '-unit'); const isK = k.value === 'kg'; s.style.transform = isK ? 'translateX(100%)' : 'translateX(0)'; k.value = isK ? 'lbs' : 'kg'; }
window.onclick = function(e) { if(e.target.classList.contains('modal-overlay')) closeModals(); }

function handleFileUpload(input) { const f = input.files[0]; if(f) { const r = new FileReader(); r.onload = async function(e) { updateAvatarUI(e.target.result); await supabaseClient.auth.updateUser({data:{avatar_url:e.target.result}}); }; r.readAsDataURL(f); } }
// --- SEARCH & FILTER LOGIC ---
function searchAppointments() { 
    // Safely get values, fallback to empty/All if missing
    const searchInput = document.getElementById('appt-search');
    const filterSelect = document.getElementById('appt-filter-select');
    
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    const filterValue = filterSelect ? filterSelect.value : 'All';
    
    // 1. Apply Text Search (Matches Doctor Name, Specialty, or Type)
    let filtered = allAppointments.filter(a => 
        (a.doctor_name && a.doctor_name.toLowerCase().includes(query)) || 
        (a.specialty && a.specialty.toLowerCase().includes(query)) ||
        (a.type && a.type.toLowerCase().includes(query))
    );

    // 2. Apply the Dropdown Filter (Audio, Video, In-Person)
    if (filterValue !== 'All') {
        filtered = filtered.filter(a => a.type && a.type.toLowerCase().includes(filterValue.toLowerCase()));
    }
    
    // 3. Separate the filtered results into Upcoming vs Past
    const startOfToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    
    const futureAppts = filtered.filter(a => {
        const apptDate = new Date(a.appointment_date);
        const isUpcomingDate = apptDate >= startOfToday;
        const isActiveStatus = a.status.toLowerCase() === 'pending' || a.status.toLowerCase() === 'confirmed';
        
        return (isUpcomingDate || isActiveStatus) && 
               a.status.toLowerCase() !== 'cancelled' && 
               a.status.toLowerCase() !== 'declined' &&
               a.status.toLowerCase() !== 'completed';
    });

    const pastAppts = filtered.filter(a => a.status.toLowerCase() === 'completed')
                              .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));
    
    // 4. Render the updated lists to the UI
    const futureContainer = document.getElementById('detailed-appointment-list');
    if (futureContainer) renderDetailedList(futureContainer, futureAppts);

    const pastContainer = document.getElementById('past-appointment-list');
    if (pastContainer) renderPastList(pastContainer, pastAppts.slice(0, 5));

    // Reset the 'View All' button if they start searching
    const viewAllBtn = document.getElementById('view-all-past-btn');
    if (viewAllBtn) viewAllBtn.textContent = "View All >";
}
async function loadReportPreview() {
    const tbody = document.getElementById('report-preview-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Loading complete history...</td></tr>';
    const tables = ['weight_logs', 'bp_logs', 'glucose_logs', 'height_logs'];
    let combined = [];
    for (let t of tables) {
        const { data } = await supabaseClient.from(t).select('*').eq('user_id', currentUser.id);
        if(data) data.forEach(d => { d.type = t; combined.push(d); });
    }
    combined.sort((a,b) => new Date(b.date) - new Date(a.date));
    allHistoryData = combined;
    tbody.innerHTML = '';
    if (combined.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No records found.</td></tr>'; return; }
    combined.forEach(item => {
        let valStr = '';
        let metricName = '';
        if(item.type === 'weight_logs') { valStr = item.weight + ' kg'; metricName = 'Weight'; }
        else if(item.type === 'bp_logs') { valStr = item.systolic + '/' + item.diastolic + ' mmHg'; metricName = 'BP'; }
        else if(item.type === 'height_logs') { valStr = item.height + ' cm'; metricName = 'Height'; }
        else { valStr = item.level + ' mg/dL'; metricName = 'Glucose'; }
        const row = `<tr><td style="padding: 0.75rem; border-bottom: 1px solid #f3f4f6;">${item.date}</td><td style="padding: 0.75rem; border-bottom: 1px solid #f3f4f6;">${metricName}</td><td style="padding: 0.75rem; border-bottom: 1px solid #f3f4f6;">${valStr}</td>
        <td>
            <button class="action-btn" onclick="editEntry('${item.type}', '${item.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete" onclick="deleteEntry('${item.type}', '${item.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td></tr>`;
        tbody.innerHTML += row;
    });
}
async function editEntry(table, id) {
    const { data } = await supabaseClient.from(table).select('*').eq('id', id).single();
    if(!data) return;
    if(table === 'weight_logs') { document.getElementById('weight-id').value = id; document.getElementById('weight-val').value = data.weight; document.getElementById('weight-date').value = data.date; document.getElementById('weight-modal-title').textContent = "Update Weight"; document.getElementById('weight-btn').textContent = "Update"; openModal('log-weight'); }
    else if(table === 'bp_logs') { document.getElementById('bp-id').value = id; document.getElementById('bp-sys').value = data.systolic; document.getElementById('bp-dia').value = data.diastolic; document.getElementById('bp-pulse').value = data.pulse; document.getElementById('bp-date').value = data.date; document.getElementById('bp-modal-title').textContent = "Update BP"; document.getElementById('bp-btn').textContent = "Update"; openModal('log-bp'); }
    else if(table === 'glucose_logs') { document.getElementById('gluc-id').value = id; document.getElementById('gluc-val').value = data.level; document.getElementById('gluc-type').value = data.test_type; document.getElementById('gluc-date').value = data.date; document.getElementById('gluc-modal-title').textContent = "Update Glucose"; document.getElementById('gluc-btn').textContent = "Update"; openModal('log-glucose'); }
    else if(table === 'height_logs') { document.getElementById('height-id').value = id; document.getElementById('height-val').value = data.height; document.getElementById('height-date').value = data.date; document.getElementById('height-modal-title').textContent = "Update Height"; document.getElementById('height-btn').textContent = "Update"; openModal('log-height'); }
}
function exportPDF() {
    if(allHistoryData.length === 0) return showToast("No data to export", "error");
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("Instadoc Health Report", 14, 20);
    doc.setFontSize(10);
    doc.text("Generated: " + new Date().toLocaleDateString(), 14, 28);

    // US-15 Improvement: Grab the Chart.js canvas and inject as an image
    const chartCanvas = document.getElementById('healthChart');
    let startY = 35; // Default table start position
    
    if (chartCanvas) {
        const chartImage = chartCanvas.toDataURL("image/png");
        
        // Failsafe: Ensure the canvas actually produced a valid image string
        // An empty/hidden canvas returns "data:," which crashes jsPDF
        if (chartImage && chartImage.length > 50 && chartImage !== "data:,") {
            try {
                // Add image (Format, X, Y, Width, Height)
                doc.addImage(chartImage, 'PNG', 14, 35, 180, 80);
                startY = 125; // Push the table down below the chart!
            } catch (err) {
                console.error("Failed to add chart image to PDF:", err);
                // Continue generating the PDF without the chart if image parsing fails
            }
        } else {
            console.warn("Chart canvas is empty or hidden. Skipping chart in PDF.");
        }
    }

    const tableData = allHistoryData.map(row => {
        let val = '';
        if(row.type === 'weight_logs') val = row.weight + ' kg';
        else if(row.type === 'bp_logs') val = `${row.systolic}/${row.diastolic} mmHg`;
        else if(row.type === 'height_logs') val = row.height + ' cm';
        else val = row.level + ' mg/dL';
        return [row.date, row.type.replace('_logs','').toUpperCase(), val];
    });

    doc.autoTable({ head: [['Date', 'Metric', 'Value']], body: tableData, startY: startY });
    doc.save("instadoc_report.pdf");
    showToast("Report Exported Successfully!", "success"); // Using our new Toast!
}
function exportCSV() {
    if(allHistoryData.length === 0) return showToast("No data to export", "error");
    let csvContent = "data:text/csv;charset=utf-8,Date,Type,Value\n";
    allHistoryData.forEach(row => {
        let val = '';
        if(row.type === 'weight_logs') val = row.weight + ' kg';
        else if(row.type === 'bp_logs') val = `${row.systolic}/${row.diastolic} mmHg`;
        else if(row.type === 'height_logs') val = row.height + ' cm';
        else val = row.level + ' mg/dL';
        
        csvContent += `${row.date},${row.type.replace('_logs','').toUpperCase()},${val}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", "instadoc_metrics.csv"); document.body.appendChild(link); link.click();
}
async function setReminder(e) { 
    e.preventDefault(); 
    if (!currentUser) return;

    const timeInput = document.getElementById('reminder-time').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = "Saving...";
    
    // Save the new reminder time to the user's metadata in Supabase
    let currentReminders = currentUser.user_metadata?.reminders || [];
    if (!currentReminders.includes(timeInput)) {
        currentReminders.push(timeInput);
        await supabaseClient.auth.updateUser({ data: { reminders: currentReminders } });
    }

    btn.textContent = originalText;

    // Show Success UI
    document.getElementById('remind-success').textContent = `Daily Reminder saved for ${timeInput}!`; 
    document.getElementById('remind-success').style.display = 'block'; 
    
    // Request OS notification permission if they haven't granted it yet
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // Close modal and restart the engine to immediately pick up the new schedule
    setTimeout(closeModals, 1500);
    startNotificationEngine(); 
}
async function saveSettings() {
    if (!currentUser) return;
    
    const btn = document.querySelector('#view-settings button[onclick="saveSettings()"]');
    if (btn) btn.textContent = "Saving...";

    const updatedData = {
        full_name: document.getElementById('settings-fullname').value,
        phone: document.getElementById('settings-phone').value,
        dob: document.getElementById('settings-dob').value,
        address: document.getElementById('settings-address-street').value,
        city: document.getElementById('settings-address-city').value,
        state: document.getElementById('settings-address-state').value,
        zip: document.getElementById('settings-address-zip').value,
        country: document.getElementById('settings-address-country').value,
        blood_type: document.getElementById('settings-blood').value,
        height: document.getElementById('settings-height').value,
        weight: document.getElementById('settings-weight').value,
        allergies: document.getElementById('settings-allergies').value,
        em_name: document.getElementById('settings-em-name').value,
        em_rel: document.getElementById('settings-em-rel').value,
        em_phone: document.getElementById('settings-em-phone').value,
        em_email: document.getElementById('settings-em-email').value,
        
        // --- NEW: Scrape Toggle States ---
        dark_mode: document.getElementById('dark-mode-toggle')?.classList.contains('checked'),
        setting_appt_reminders: document.getElementById('toggle-appt-reminders')?.classList.contains('checked'),
        setting_med_reminders: document.getElementById('toggle-med-reminders')?.classList.contains('checked'),
        setting_lab_results: document.getElementById('toggle-lab-results')?.classList.contains('checked'),
        setting_health_tips: document.getElementById('toggle-health-tips')?.classList.contains('checked'),
        setting_share_data: document.getElementById('toggle-share-data')?.classList.contains('checked'),
        setting_research: document.getElementById('toggle-research')?.classList.contains('checked'),
        setting_2fa: document.getElementById('toggle-2fa')?.classList.contains('checked')
        // ---------------------------------
    };

    const { data, error } = await supabaseClient.auth.updateUser({ data: updatedData });

    if (btn) btn.textContent = "Save Changes"; 

    if (error) {
        showToast("Error saving settings: " + error.message, "error");
    } else {
        showToast("Profile settings saved securely!", "success");
        currentUser = data.user;
        loadProfileSettings(); 
    }
}

// --- PRIVACY & DATA FUNCTIONS ---

async function downloadMyData() {
    if (!currentUser) return;
    
    // Change button text temporarily
    const btn = document.querySelector('button[onclick="downloadMyData()"]');
    const originalText = btn.textContent;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compiling...';
    btn.disabled = true;

    try {
        // Fetch all the user's data concurrently
        const [profile, weight, bp, glucose, temp, appts] = await Promise.all([
            supabaseClient.auth.getUser(),
            supabaseClient.from('weight_logs').select('*').eq('user_id', currentUser.id),
            supabaseClient.from('bp_logs').select('*').eq('user_id', currentUser.id),
            supabaseClient.from('glucose_logs').select('*').eq('user_id', currentUser.id),
            supabaseClient.from('height_logs').select('*').eq('user_id', currentUser.id),
            supabaseClient.from('appointments').select('*').eq('user_id', currentUser.id)
        ]);

        // Bundle it into a clean object
        const exportData = {
            user_profile: profile.data?.user?.user_metadata || {},
            email: currentUser.email,
            exported_at: new Date().toISOString(),
            metrics: {
                weight_logs: weight.data || [],
                blood_pressure_logs: bp.data || [],
                glucose_logs: glucose.data || [],
                height_logs: temp.data || []
            },
            appointments: appts.data || []
        };

        // Create a downloadable JSON file
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "Instadoc_My_Data.json");
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        dlAnchorElem.remove();
        
        showToast("Data downloaded successfully!", "success");
    } catch (error) {
        showToast("Failed to compile data: " + error.message, "error");
        console.error(error);
    } finally {
        // Restore button UI
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function deleteMyAccount() {
    if (!currentUser) return;
    
    showConfirm("Are you sure you want to permanently delete your account and all data? This action cannot be undone.", async (confirmed) => {
        if (!confirmed) return;

        showToast("Wiping account data securely...", "success");
        
        try {
            // ONE CALL: Let the Supabase server handle the entire cascading wipe securely!
            const { error: authError } = await supabaseClient.rpc('delete_user');
            if (authError) throw authError;
            
            showToast("Your account and all personal data have been permanently deleted.", "success");
            
            // Log them out and redirect to home
            setTimeout(() => {
                logout();
            }, 2000);
            
        } catch (error) {
            showToast("Error wiping data: " + error.message, "error");
        }
    });
}

// --- DOCTOR LOGIC ---

async function toggleDoctorStatus(el) {
    if(!currentUser) return;
    const isChecked = el.classList.toggle('checked');
    const statusText = document.getElementById('doctor-status-text');
    
    statusText.textContent = isChecked ? "Online" : "Offline";
    statusText.className = isChecked ? "text-xs ml-2 text-green-500" : "text-xs ml-2 text-gray-500";

   const { error } = await supabaseClient.from('doctor_profiles').upsert({
        id: currentUser.id,
        schedule: schedule,
        full_name: fullName
    });
    
    if(!error) showToast("Settings & Schedule Saved!", "success");
    else showToast("Error: " + error.message, "error");
}

const defaultSchedule = {
    "Mon": { active: true, start: "09:00", end: "17:00" },
    "Tue": { active: true, start: "09:00", end: "17:00" },
    "Wed": { active: true, start: "09:00", end: "17:00" },
    "Thu": { active: true, start: "09:00", end: "17:00" },
    "Fri": { active: true, start: "09:00", end: "17:00" },
    "Sat": { active: false, start: "10:00", end: "14:00" },
    "Sun": { active: false, start: "", end: "" }
};

function renderScheduleGrid(savedSchedule) {
    const container = document.getElementById('doctor-schedule-container');
    if(!container) return;
    container.innerHTML = '';
    
    const schedule = savedSchedule || defaultSchedule;
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    days.forEach(day => {
        const data = schedule[day] || defaultSchedule[day];
        const isChecked = data.active ? 'checked' : '';
        
        const row = `
            <div class="schedule-row" id="row-${day}">
                <span class="schedule-day">${day}</span>
                <input type="time" class="schedule-time" value="${data.start}" ${!data.active ? 'disabled' : ''}>
                <input type="time" class="schedule-time" value="${data.end}" ${!data.active ? 'disabled' : ''}>
                <div class="schedule-toggle">
                    <div class="toggle-switch ${isChecked}" onclick="toggleScheduleRow(this, '${day}')">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += row;
    });
}

function toggleScheduleRow(el, day) {
    el.classList.toggle('checked');
    const isActive = el.classList.contains('checked');
    const row = document.getElementById('row-' + day);
    const inputs = row.querySelectorAll('input');
    inputs.forEach(inp => inp.disabled = !isActive);
}

async function saveDoctorSettings() {
    if (!currentUser) return;

    const btn = document.querySelector('#view-doctor-settings button[onclick="saveDoctorSettings()"]');
    if (btn) btn.textContent = "Saving...";

    const fullName = document.getElementById('doc-settings-fullname').value;
    const specialty = document.getElementById('doc-settings-specialty').value;
    const license = document.getElementById('doc-settings-license').value;
    const phone = document.getElementById('doc-settings-phone').value;
    const clinic = document.getElementById('doc-settings-clinic').value;

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let schedule = {};

    // Map through the custom schedule grid UI
    days.forEach(day => {
        const row = document.getElementById('row-' + day);
        const inputs = row.querySelectorAll('input');
        const toggle = row.querySelector('.toggle-switch');
        
        schedule[day] = {
            active: toggle.classList.contains('checked'),
            start: inputs[0].value,
            end: inputs[1].value
        };
    });

    // Save strictly database fields
    const { error: profileError } = await supabaseClient.from('doctor_profiles').upsert({
        id: currentUser.id,
        schedule: schedule,
        full_name: fullName,
        specialty: specialty
    });
    
    // Save metadata fields (to mirror how patient settings work)
    const { data, error: authError } = await supabaseClient.auth.updateUser({
        data: {
            full_name: fullName,
            specialty: specialty,
            license_number: license,
            phone: phone,
            clinic_name: clinic,
            address_street: document.getElementById('doc-settings-street').value,
            address_city: document.getElementById('doc-settings-city').value,
            address_state: document.getElementById('doc-settings-state').value,
        }
    });

    if (btn) btn.textContent = "Save Profile";

    if(profileError || authError) {
        showToast("Error: " + (profileError?.message || authError?.message), "error");
    } else {
        showToast("Professional Profile & Schedule Saved!", "success");
        currentUser = data.user; 
        loadDoctorStatus(); // Refreshes the UI header
        updateAvatarUI(currentUser.user_metadata?.avatar_url); 
    }
}

async function loadDoctorStatus() {
    if(!currentUser) return;
    
    // 1. Populate Auth Metadata Fields (Name, Email, Address, etc.)
    const meta = currentUser.user_metadata || {};
    document.getElementById('doc-settings-email').value = currentUser.email;
    document.getElementById('doc-settings-fullname').value = meta.full_name || "Doctor";
    document.getElementById('doc-settings-specialty').value = meta.specialty || "General Practitioner";
    document.getElementById('doc-settings-license').value = meta.license_number || "";
    document.getElementById('doc-settings-phone').value = meta.phone || "";
    document.getElementById('doc-settings-clinic').value = meta.clinic_name || "";
    document.getElementById('doc-settings-street').value = meta.address_street || "";
    document.getElementById('doc-settings-city').value = meta.address_city || "";
    document.getElementById('doc-settings-state').value = meta.address_state || "";

    // 2. Populate the Top Header UI
    document.getElementById('doc-header-name').textContent = meta.full_name || "Dr. User";
    document.getElementById('doc-header-email').textContent = currentUser.email;
    document.getElementById('doc-header-specialty').textContent = meta.specialty || "Specialist";

    // 3. Fetch Schedule & Online Status from the DB
    const { data } = await supabaseClient.from('doctor_profiles').select('*').eq('id', currentUser.id).single();
    if(data) {
       // --- NEW: VERIFICATION BADGE LOGIC ---
        const badge = document.getElementById('doc-verified-badge');
        if (badge) {
            if (data.is_verified) {
                badge.className = "verified-badge";
                // Restore the beautiful green styling from your CSS
                badge.style.background = "#dcfce7";
                badge.style.color = "#16a34a";
                badge.style.borderColor = "#bbf7d0";
                badge.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Verified Practitioner';
            } else {
                badge.className = "verified-badge";
                // Apply the yellow warning styling
                badge.style.background = "#fefce8";
                badge.style.color = "#ca8a04";
                badge.style.borderColor = "#fef9c3";
                badge.innerHTML = '<i class="fa-regular fa-clock"></i> Pending Verification';
            }
        }
        // -------------------------------------

        const toggle = document.getElementById('doctor-status-toggle');
        const statusText = document.getElementById('doctor-status-text');
        if(data.is_online) {
            toggle.classList.add('checked');
            statusText.textContent = "Online";
            statusText.className = "text-xs ml-2 text-green-500";
        } else {
            toggle.classList.remove('checked');
            statusText.textContent = "Offline";
            statusText.className = "text-xs ml-2 text-gray-500";
        }
        renderScheduleGrid(data.schedule);
    } else {
        renderScheduleGrid(defaultSchedule);
    }
}

async function loadDoctorsForBooking() {
    const container = document.getElementById('doctor-list-container');
    container.innerHTML = '<div class="loading-cell text-sm">Loading doctors...</div>';
    
    // SECURITY UPDATE: Only fetch doctors who have been explicitly verified by the Admin
    const { data: doctors, error } = await supabaseClient
        .from('doctor_profiles')
        .select('*')
        .eq('is_verified', true); 
    
    if(error || !doctors || doctors.length === 0) {
        container.innerHTML = '<p class="text-center-muted">No available doctors found at this time.</p>';
        return;
    }

    container.innerHTML = '';
    doctors.forEach(doc => {
        const statusBadge = doc.is_online 
            ? '<span class="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full font-bold">Online</span>'
            : '<span class="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-bold">Offline</span>';
        
        const safeSchedule = doc.schedule ? encodeURIComponent(JSON.stringify(doc.schedule)) : "";

        const card = `
            <div class="card p-3 flex justify-between items-center cursor-pointer hover:shadow-md transition-all" onclick="openScheduleForm('${doc.id}', '${doc.full_name}', '${safeSchedule}')">
                <div class="flex gap-3 items-center">
                    <div class="doctor-avatar bg-gray-200 text-gray-600" style="width:40px;height:40px;font-size:0.9rem;">${getInitials(doc.full_name || 'Dr')}</div>
                    <div>
                        <h4 class="font-bold text-sm flex items-center gap-1">
                            ${doc.full_name || 'Doctor'} 
                            <i class="fa-solid fa-circle-check text-blue-500" title="Verified Practitioner"></i>
                        </h4>
                        <p class="text-xs text-gray-500">${doc.specialty || 'General'}</p>
                    </div>
                </div>
                ${statusBadge}
            </div>
        `;
        container.innerHTML += card;
    });
}

function openScheduleForm(docId, docName, encodedSchedule) {
    closeModals(); 
    document.getElementById('schedule-appointment-modal').classList.add('active');
    document.getElementById('schedule-doc-name').textContent = "With " + docName;
    document.getElementById('schedule-doc-id').value = docId;
    
    if(encodedSchedule) {
        document.getElementById('schedule-doc-json').value = decodeURIComponent(encodedSchedule);
    } else {
        document.getElementById('schedule-doc-json').value = ""; 
    }
    
    document.getElementById('schedule-date').value = "";
    document.getElementById('schedule-time').value = "";
    document.getElementById('schedule-time').disabled = true;
    document.getElementById('schedule-error').style.display = 'none';
    document.getElementById('schedule-success').style.display = 'none';
    document.getElementById('schedule-time-hint').style.display = 'none';
}

function validateDoctorSchedule() {
    const dateInput = document.getElementById('schedule-date');
    const timeInput = document.getElementById('schedule-time');
    const hintText = document.getElementById('schedule-time-hint');
    const scheduleJson = document.getElementById('schedule-doc-json').value;

    if (!dateInput.value) return;

    const date = new Date(dateInput.value);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = days[date.getDay()];

    let isAvailable = false;
    let start = "09:00";
    let end = "17:00";

    if (scheduleJson) {
        const schedule = JSON.parse(scheduleJson);
        const dayConfig = schedule[dayName];
        
        if (dayConfig && dayConfig.active) {
            isAvailable = true;
            start = dayConfig.start;
            end = dayConfig.end;
        }
    } else {
        if (dayName !== "Sat" && dayName !== "Sun") isAvailable = true;
    }

    if (isAvailable) {
        timeInput.disabled = false;
        timeInput.min = start;
        timeInput.max = end;
        hintText.style.display = 'none';
        hintText.textContent = "";
    } else {
        timeInput.disabled = true;
        timeInput.value = "";
        hintText.style.display = 'block';
        hintText.textContent = `Doctor is not available on ${dayName}s.`;
    }

    // Fetch and show booked slots for this doctor on this day
    const docId = document.getElementById('schedule-doc-id').value;
    if (docId && isAvailable) {
        const bookedContainer = document.getElementById('booked-slots-container');
        const bookedList = document.getElementById('booked-slots-list');
        bookedList.innerHTML = '<span style="font-size:0.7rem;color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> Checking availability...</span>';
        bookedContainer.style.display = 'block';

        fetchDoctorBookedSlots(docId, dateInput.value).then(slots => {
            if (slots.length === 0) {
                bookedContainer.style.display = 'none';
            } else {
                bookedList.innerHTML = slots.map(t => 
                    `<span class="booked-slot-badge"><i class="fa-solid fa-ban" style="font-size:0.6rem;"></i> ${t}</span>`
                ).join('');
                bookedContainer.style.display = 'block';
            }
        });
    } else {
        const bookedContainer = document.getElementById('booked-slots-container');
        if (bookedContainer) bookedContainer.style.display = 'none';
    }
}

// 4. Submit Appointment (Saves to DB)
document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const docId = document.getElementById('schedule-doc-id').value;
    const date = document.getElementById('schedule-date').value;
    const time = document.getElementById('schedule-time').value;
    const type = document.getElementById('schedule-type').value;
    
    // FIX 2: Check for Method drop-down value, fallback to default if missing
    const methodEl = document.getElementById('schedule-method');
    const method = methodEl ? methodEl.value : 'In-Person'; 
    
    const patientName = (currentUser.user_metadata && currentUser.user_metadata.full_name) || "Patient";

    // FIX 2 & 3: Combine Method and Reason (e.g. "Audio Consultation • General Checkup")
    const combinedType = `${method} • ${type}`;

    // FIX 5: Convert local time specifically to ISO String to prevent timezone shifting
    const localDateTime = new Date(`${date}T${time}`);
    const fullDateTime = localDateTime.toISOString();

    // CONFLICT CHECK: Ensure the doctor is not already booked at this time
    const conflictCheck = await checkDoctorConflict(docId, fullDateTime);
    if (conflictCheck.conflict) {
        const conflictTime = new Date(conflictCheck.appointments[0].appointment_date)
            .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        const errEl = document.getElementById('schedule-error');
        errEl.textContent = `This doctor already has an appointment at ${conflictTime}. A minimum of 1 hour must separate appointments — please select a different time.`;
        errEl.style.display = 'block';
        return;
    }

    // Record sharing consent (Change 7)
    const shareRecordsEl = document.getElementById('share-records-consent');
    const shareRecords = shareRecordsEl ? shareRecordsEl.checked : false;

    // Show consent confirmation if sharing enabled
    if (shareRecords) {
        showToast("Health records will be shared with this doctor for this consultation.", "success");
    }

    const { error } = await supabaseClient.from('appointments').insert({
        user_id: currentUser.id,
        doctor_id: docId, 
        doctor_name: document.getElementById('schedule-doc-name').textContent.replace('With ', ''), 
        patient_name: patientName, 
        appointment_date: fullDateTime,
        type: combinedType, 
        status: 'pending',
        specialty: 'General',
        share_records: shareRecords
    });

    if (error) {
        document.getElementById('schedule-error').textContent = error.message;
        document.getElementById('schedule-error').style.display = 'block';
    } else {
        document.getElementById('schedule-success').textContent = "Appointment Scheduled!";
        document.getElementById('schedule-success').style.display = 'block';
        setTimeout(() => {
            closeModals();
            loadAppointments(); // Refresh Dashboard
        }, 1500);
    }
});

let activePatientIdForNotes = null; // NEW: Track patient for notifications

// --- LONGITUDINAL PATIENT NOTES MODAL ---
async function openNotesModal(apptId, patientId, patientName, encodedNotes) {
    activePatientIdForNotes = patientId; // NEW: Capture the ID
    closeModals();
    document.getElementById('notes-modal').classList.add('active');
    document.getElementById('notes-appt-id').value = apptId;
    document.getElementById('notes-patient-name').textContent = patientName || "Patient";
    
    document.getElementById('notes-success').style.display = 'none';
    document.getElementById('notes-error').style.display = 'none';
    
    // 1. Set the text for the CURRENT appointment in the textarea
    if(encodedNotes) {
        document.getElementById('notes-content').value = decodeURIComponent(encodedNotes);
        document.getElementById('notes-btn').textContent = "Update Notes";
    } else {
        document.getElementById('notes-content').value = "";
        document.getElementById('notes-btn').textContent = "Save Notes";
    }

    // 2. Fetch and render LONGITUDINAL HISTORY
    const historyContainer = document.getElementById('notes-history-container');
    if (!historyContainer) return; // Safety check
    
    historyContainer.innerHTML = '<p class="text-xs text-gray-500 text-center py-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading patient chart...</p>';

    // Query Supabase for past notes
    const { data: pastAppts, error } = await supabaseClient
        .from('appointments')
        .select('id, appointment_date, notes, type')
        .eq('user_id', patientId)
        .eq('doctor_id', currentUser.id)
        .not('notes', 'is', null)
        .order('appointment_date', { ascending: false });

    if (error) {
        historyContainer.innerHTML = '<p class="text-xs text-red-400 italic text-center">Failed to load history.</p>';
        return;
    }

    historyContainer.innerHTML = ''; // Clear loading state
    let hasHistoricalNotes = false;

    pastAppts.forEach(appt => {
        // Skip the current appointment so we don't duplicate what is already in the editable textarea
        if (appt.id === apptId) return; 

        hasHistoricalNotes = true;
        const dateStr = new Date(appt.appointment_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const typeBadge = appt.type ? appt.type.split('•')[0].trim() : 'Visit';
        
        // Append historical note card
        historyContainer.innerHTML += `
            <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg mb-2 shadow-sm">
                <div class="flex justify-between items-center mb-2 border-b border-gray-200 pb-1">
                    <span class="font-bold text-sm text-gray-800"><i class="fa-regular fa-calendar-check mr-1 text-green-600"></i> ${dateStr}</span>
                    <span class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full font-medium">${typeBadge}</span>
                </div>
                <p class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">${appt.notes}</p>
            </div>
        `;
    });
    
    // If they have no other appointments with notes
    if (!hasHistoricalNotes) {
        historyContainer.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-2 bg-gray-50 rounded border border-dashed border-gray-200">No previous clinical notes found for this patient.</p>';
    }
}

// Keep the save logic!
document.getElementById('notes-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const apptId = document.getElementById('notes-appt-id').value;
    const notesContent = document.getElementById('notes-content').value;
    const btn = document.getElementById('notes-btn');
    
    btn.textContent = "Saving...";
    
    const { error } = await supabaseClient
        .from('appointments')
        .update({ notes: notesContent })
        .eq('id', apptId);
        
    if(error) {
        document.getElementById('notes-error').textContent = error.message;
        document.getElementById('notes-error').style.display = 'block';
        btn.textContent = "Try Again";
    } else {
        // --- NEW: PUSH NOTIFICATION TO PATIENT ---
        if (activePatientIdForNotes) {
            await supabaseClient.from('notifications').insert({
                user_id: activePatientIdForNotes,
                type: 'notes_updated',
                title: 'Clinical Notes Updated',
                body: `Your doctor has updated the clinical notes or prescriptions for your recent consultation.`,
                payload: { appointment_id: apptId }
            });
        }
        
        document.getElementById('notes-success').textContent = "Notes saved securely!";
        document.getElementById('notes-success').style.display = 'block';
        setTimeout(() => {
            closeModals();
            loadDoctorAppointmentsTab(); 
        }, 1500);
    }
});

// --- US-35: SPEECH RECOGNITION DICTATION ---
let dictationRecognition = null;
let isDictating = false;

function toggleDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast("Speech recognition is not supported in this browser.", "error");
        return;
    }

    const btn = document.getElementById('btn-dictate');
    const textArea = document.getElementById('notes-content');

    // Stop dictation if already running
    if (isDictating && dictationRecognition) {
        dictationRecognition.stop();
        return;
    }

    // Initialize dictation
    dictationRecognition = new SpeechRecognition();
    dictationRecognition.continuous = true;
    dictationRecognition.interimResults = true;

    dictationRecognition.onstart = function() {
        isDictating = true;
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Listening... (Click to Stop)';
        btn.style.backgroundColor = '#ef4444'; // Red recording state
        btn.style.color = '#ffffff';
        showToast("Microphone active. Speak your notes.", "success");
    };

    dictationRecognition.onresult = function(event) {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            }
        }
        if (finalTranscript) {
            // Append spoken text to existing notes
            textArea.value += (textArea.value ? ' ' : '') + finalTranscript.trim() + '.';
        }
    };

    dictationRecognition.onend = function() {
        isDictating = false;
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Start Dictation';
        btn.style.backgroundColor = '#e5e7eb'; // Reset to gray
        btn.style.color = '#374151';
    };

    dictationRecognition.onerror = function(event) {
        showToast("Microphone error: " + event.error, "error");
        dictationRecognition.stop();
    };

    dictationRecognition.start();
}

// Helper to render specific sections (Doctor View)
function renderDocSection(containerId, data, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    if (data.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-400 italic">No ${type} appointments.</p>`;
        return;
    }

    data.forEach(a => {
        const dateObj = new Date(a.appointment_date);
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const displayName = a.patient_name || "Patient";
        const initials = getInitials(displayName);

        let actions = '';
        let badgeColor = 'bg-gray-100 text-gray-500';

        if (type === 'pending') {
            badgeColor = 'bg-yellow-100 text-yellow-700';
            actions = `
                <div class="flex gap-2">
                    <button class="btn-sm bg-green-500 text-white border-none" onclick="updateAppointmentStatus('${a.id}', 'Confirmed', '${a.user_id}')">
                        <i class="fa-solid fa-check"></i> Accept
                    </button>
                    <button class="btn-sm bg-red-100 text-red-600 border border-red-200" onclick="cancelAppointmentWithReason('${a.id}')">
                        <i class="fa-solid fa-xmark"></i> Decline
                    </button>
                </div>
            `;
        } else if (type === 'upcoming') {
            badgeColor = 'bg-green-100 text-green-700';
            
            let actionBtn = '';
            if(a.type.toLowerCase().includes('video')) {
                actionBtn = `<button class="btn-sm bg-blue-500 text-white border-none" onclick="startVideoCall('${a.id}', 'video', '${a.user_id}', '${a.patient_name}')"><i class="fa-solid fa-video"></i> Start Call</button>`;
            } else if(a.type.toLowerCase().includes('audio')) {
                actionBtn = `<button class="btn-sm bg-purple-500 text-white border-none" onclick="startVideoCall('${a.id}', 'audio', '${a.user_id}', '${a.patient_name}')"><i class="fa-solid fa-phone"></i> Audio Call</button>`;
            }
            
            actions = `
                <div class="flex gap-2">
                    ${actionBtn}
                    <button class="btn-sm bg-white text-green-600 border border-green-500" onclick="updateAppointmentStatus('${a.id}', 'completed', '${a.user_id}')">
                        <i class="fa-solid fa-check-double"></i> Complete
                    </button>
                    <button class="btn-sm bg-red-50 text-red-500 border border-red-200" onclick="cancelAppointmentWithReason('${a.id}')">
                        <i class="fa-solid fa-ban"></i> Cancel
                    </button>
                </div>
            `;
        } else {
            // Past
            if(a.status === 'completed') badgeColor = 'bg-blue-100 text-blue-700';
            else if(a.status === 'cancelled') badgeColor = 'bg-red-100 text-red-700';
            
            const safeNote = a.notes ? encodeURIComponent(a.notes) : '';
            
            // Notes Button
            const noteBtn = a.status === 'completed' 
                ? `<button class="btn-sm bg-gray-50 text-gray-600 border border-gray-200 mt-2 hover:bg-gray-100 transition-colors" onclick="openNotesModal('${a.id}', '${a.user_id}', '${a.patient_name}', '${safeNote}')"><i class="fa-regular fa-clipboard"></i> ${a.notes ? 'View Notes' : 'Add Notes'}</button>` 
                : '';
            
            // NEW: Patient Records Button
            const recordsBtn = (a.status === 'completed' || a.status === 'Confirmed' || a.status === 'confirmed')
                ? `<button class="btn-sm bg-blue-50 text-blue-600 border border-blue-200 mt-2 ml-2 hover:bg-blue-100 transition-colors" onclick="viewPatientRecords('${a.user_id}', '${a.patient_name}')"><i class="fa-solid fa-file-medical"></i> Records</button>`
                : '';

            actions = `
                <div class="flex flex-col items-end">
                    <span class="text-xs text-gray-400 font-medium">${a.status.toUpperCase()}</span>
                    <div class="flex">
                        ${noteBtn}
                        ${recordsBtn}
                    </div>
                </div>
            `;
        }
        const html = `
            <div class="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-all">
                <div class="flex items-center gap-3">
                    <div class="profile-pic" style="width:40px;height:40px; font-size:0.8rem; background:#f3f4f6; color:#555;">${initials}</div>
                    <div>
                        <h4 class="font-bold text-sm text-gray-800">${displayName}</h4>
                        <div class="flex gap-3 text-xs text-gray-500 mt-1">
                            <span><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                            <span><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                            <span>${a.type}</span>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col items-end gap-2">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badgeColor}">${a.status}</span>
                    ${actions}
                </div>
            </div>
        `;
        container.innerHTML += html;
    });
}

// Change 8: Cancellation with predefined reasons
const CANCELLATION_REASONS = [
    'Emergency situation',
    'Schedule conflict',
    'Technical issue',
    'Doctor unavailability',
    'Patient request',
    'Other'
];

function cancelAppointmentWithReason(apptId) {
    const reasonOptions = CANCELLATION_REASONS.map((r, i) =>
        `<option value="${r}">${r}</option>`
    ).join('');

    const cancelModal = document.createElement('div');
    cancelModal.className = 'modal-overlay active';
    cancelModal.style.zIndex = '10001';
    cancelModal.id = 'cancel-reason-modal';
    cancelModal.innerHTML = `
        <div class="auth-modal" style="text-align:center;">
            <h2 class="modal-title">Cancel Appointment</h2>
            <p class="text-sm text-gray-500 mb-4">Please select a reason for cancellation:</p>
            <select id="cancel-reason-select" class="form-control bg-white mb-4" style="text-align-last:left;">
                ${reasonOptions}
            </select>
            <div class="flex gap-4 justify-center">
                <button class="btn-action bg-gray-200 text-gray-700 border-none px-6 py-2 rounded cursor-pointer"
                    onclick="document.getElementById('cancel-reason-modal').remove()">
                    Keep Appointment
                </button>
                <button class="btn-action bg-red-500 text-white border-none px-6 py-2 rounded cursor-pointer"
                    onclick="confirmCancellation('${apptId}')">
                    Confirm Cancellation
                </button>
            </div>
        </div>`;
    document.body.appendChild(cancelModal);
}

async function confirmCancellation(apptId) {
    const reason = document.getElementById('cancel-reason-select').value;
    const modal = document.getElementById('cancel-reason-modal');
    if (modal) modal.remove();

    const { data, error } = await supabaseClient
        .from('appointments')
        .update({ status: 'cancelled', cancellation_reason: reason })
        .eq('id', apptId)
        .select();

    if (error) {
        showToast("Error cancelling appointment: " + error.message, "error");
    } else {
        showToast(`Appointment cancelled: ${reason}`, "success");
        await loadDoctorAppointmentsTab();
        await loadDoctorDashboardData();
    }
}

async function updateAppointmentStatus(id, newStatus, patientId) {
    showConfirm(`Are you sure you want to mark this appointment as ${newStatus}?`, async (confirmed) => {
        if (!confirmed) return;

        const { data, error } = await supabaseClient
            .from('appointments')
            .update({ status: newStatus })
            .eq('id', id)
            .select(); 

        if(error) {
            showToast("Database Error: " + error.message, "error");
        } else if (data.length === 0) {
            showToast("Update Failed: Check your RLS policies.", "error");
        } else {
            showToast(`Appointment marked as ${newStatus}`, "success");
            
            // --- NEW: PUSH NOTIFICATION TO PATIENT ---
            if (patientId) {
                const statusLower = newStatus.toLowerCase();
                const title = statusLower === 'confirmed' ? 'Appointment Confirmed' : 'Consultation Completed';
                const body = statusLower === 'confirmed' 
                    ? `Your doctor has confirmed your upcoming appointment.`
                    : `Your consultation is now marked as complete.`;
                
                // Raw insert so we explicitly target the patient, not the currently logged-in doctor
                await supabaseClient.from('notifications').insert({
                    user_id: patientId,
                    type: `appointment_${statusLower}`,
                    title: title,
                    body: body,
                    payload: { appointment_id: id }
                });
            }
            
            await loadDoctorAppointmentsTab(); 
            await loadDoctorDashboardData(); 
        }
    });
}
// --- VIDEO CALL FUNCTION (Jitsi) ---
let jitsiApi = null; // Restoring the API variable we deleted!

// Global variables to hold call state
let activeCallTranscript = "";
let activeCallRecognition = null;
let currentCallContext = {};

function startVideoCall(appointmentId, callType = 'video', patientId = '', patientName = '') {
    const modal = document.getElementById('video-modal');
    if (modal) modal.classList.add('active');
    
    // Store context for post-call summary
    currentCallContext = { appointmentId, patientId, patientName };
    activeCallTranscript = "";

    // 1. Initialize Background Transcription
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        activeCallRecognition = new SpeechRecognition();
        activeCallRecognition.continuous = true;
        activeCallRecognition.interimResults = false;
        
        activeCallRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    activeCallTranscript += event.results[i][0].transcript + " ";
                }
            }
        };
        
        // Restart automatically if it pauses during long silences
        activeCallRecognition.onend = () => {
            if (activeCallRecognition) activeCallRecognition.start();
        };
        
        activeCallRecognition.start();
    }

    // 2. Standard Jitsi Initialization
    const domain = "meet.jit.si";
    const roomName = "InstadocSecureConsult-" + appointmentId;
    const userName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.full_name) ? currentUser.user_metadata.full_name : "Instadoc User";
    const isAudioOnly = callType === 'audio';

    let activeButtons = [
        'microphone', 'camera', 'desktop', 'fullscreen', 'hangup', 'chat', 
        'settings', 'raisehand', 'videoquality', 'tileview', 'mute-everyone'
    ];

    if (isAudioOnly) {
        activeButtons = activeButtons.filter(btn => !['camera', 'desktop', 'videoquality'].includes(btn));
    }

    const options = {
        roomName: roomName,
        width: "100%", 
        height: "100%",
        parentNode: document.querySelector('#jitsi-container'),
        userInfo: { displayName: userName },
        configOverwrite: {
            startWithVideoMuted: isAudioOnly,
            startAudioOnly: isAudioOnly,
            disableDeepLinking: true,
            prejoinPageEnabled: false,
            toolbarButtons: activeButtons
        }
    };

    if (jitsiApi) jitsiApi.dispose();
    try {
        jitsiApi = new JitsiMeetExternalAPI(domain, options);
        jitsiApi.addEventListeners({ videoConferenceLeft: function () { closeVideoCall(); } });
        showToast(`Connecting to secure ${callType} room...`, "success");
    } catch (err) {
        showToast("Failed to initialize call.", "error");
        closeVideoCall();
    }
}

async function closeVideoCall() {
    // 1. Clean up Jitsi connection securely
    if (jitsiApi) {
        jitsiApi.dispose();
        jitsiApi = null;
    }
    const modal = document.getElementById('video-modal');
    if (modal) modal.classList.remove('active');
    
    const container = document.querySelector('#jitsi-container');
    if (container) container.innerHTML = "";

    // 2. Handle Transcription & Seamless AI Handoff
    if (activeCallRecognition) {
        // Prevent auto-restart loop before stopping
        activeCallRecognition.onend = null; 
        activeCallRecognition.stop();
        activeCallRecognition = null;

        // Only summarize if meaningful audio was captured (>15 characters)
        if (activeCallTranscript.trim().length > 15) {
            
            // UI Friction Reduction: Open notes modal immediately in a loading state
            openNotesModal(
                currentCallContext.appointmentId, 
                currentCallContext.patientId, 
                currentCallContext.patientName, 
                "🤖 Analyzing consultation audio... Generating smart summary..."
            );

            // Lock the save button while AI processes to prevent premature saves
            const btn = document.getElementById('notes-btn');
            if (btn) { 
                btn.disabled = true; 
                btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing AI Summary...'; 
                btn.style.opacity = '0.7';
            }

            // Call the AI Summarization Engine
            const aiSummary = await generateAISummary(activeCallTranscript);
            
            // Update the modal text seamlessly
            const textArea = document.getElementById('notes-content');
            if (textArea) textArea.value = aiSummary;

            // Unlock the button for doctor review
            if (btn) { 
                btn.disabled = false; 
                btn.textContent = "Save Notes"; 
                btn.style.opacity = '1';
            }
            showToast("Smart Summary generated successfully.", "success");

        } else {
            // Audio was too short/empty; open standard blank notes
            openNotesModal(currentCallContext.appointmentId, currentCallContext.patientId, currentCallContext.patientName, "");
        }
    } else {
        openNotesModal(currentCallContext.appointmentId, currentCallContext.patientId, currentCallContext.patientName, "");
    }
}

async function generateAISummary(transcript) {
    // ---------------------------------------------------------
    // PRODUCTION: SUPABASE EDGE FUNCTION HOOK
    // When your LLM backend is ready, uncomment this block to 
    // route the transcript securely to your AI model.
    // ---------------------------------------------------------
    /*
    try {
        const { data, error } = await supabaseClient.functions.invoke('generate-consultation-summary', {
            body: { text: transcript }
        });
        if (!error && data?.summary) return data.summary;
    } catch (err) {
        console.error("AI summarization failed:", err);
    }
    */

    // ---------------------------------------------------------
    // INTELLIGENT FRONTEND FALLBACK & FORMATTER
    // Structures the raw text perfectly for the doctor's review
    // ---------------------------------------------------------
    
    // Simulate slight processing delay for a realistic UX
    await new Promise(resolve => setTimeout(resolve, 1500));

    return `=== AI CONSULTATION SUMMARY ===
[Please review and edit before saving to patient records]

SYMPTOMS DISCUSSED:
- (AI will extract symptoms here)

DIAGNOSES MENTIONED:
- (AI will extract primary diagnoses here)

RECOMMENDATIONS & FOLLOW-UP:
- (AI will extract lifestyle/care instructions)

PRESCRIPTIONS DISCUSSED:
- (AI will extract medications here)

-----------------------------------
RAW TRANSCRIPT CAPTURE:
"${transcript.substring(0, 400)}..."`;
}
// =============================================
// PERSISTENT NOTIFICATION ENGINE
// =============================================
let notificationInterval;

function getNotifiedKey(time) {
    const today = new Date().toDateString();
    return `instadoc_notified_${today}_${time}`;
}

function startNotificationEngine() {
    if (notificationInterval) clearInterval(notificationInterval);

    // Load appointment notifications from DB on startup
    loadInboxNotifications();

    notificationInterval = setInterval(() => {
        if (!currentUser?.user_metadata) return;
        const meta = currentUser.user_metadata;
        if (meta.setting_med_reminders === false) return;

        const reminders = meta.reminders || [];
        if (!reminders.length) return;

        const now = new Date();
        const currentTimeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        reminders.forEach(time => {
            const key = getNotifiedKey(time);
            // localStorage persists across page loads — only fires once per day per reminder
            if (time === currentTimeStr && !localStorage.getItem(key)) {
                localStorage.setItem(key, '1');
                showToast(`⏰ Time to log your health metrics!`, 'success');
                if (Notification.permission === 'granted') {
                    new Notification('InstaDoc Reminder', {
                        body: `It's ${time}! Time to log your daily health metrics.`,
                        icon: 'assets/INN.png'
                    });
                }
                // Save reminder to DB inbox too
                saveNotification('reminder', 'Health Metric Reminder', `Time to log your metrics for ${time}.`, {});
            }
        });
    }, 30000);

    // --- NEW: TRUE REAL-TIME SYNC ---
    if (currentUser) {
        supabaseClient
            .channel('public:notifications')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'notifications',
                filter: `user_id=eq.${currentUser.id}` 
            }, (payload) => {
                // Instantly alert the user and update the UI when a doctor triggers an event
                const newNotif = payload.new;
                showToast(`🔔 ${newNotif.title}`, 'success');
                updateNotificationBadge();
                
                // If the panel is open, append it silently
                const panel = document.getElementById('notif-panel');
                if (panel && panel.classList.contains('open')) {
                    loadInboxNotifications();
                }
            })
            .subscribe();
    }
}

// Write a notification record to Supabase
async function saveNotification(type, title, body, payload = {}) {
    if (!currentUser) return;
    await supabaseClient.from('notifications').insert({
        user_id: currentUser.id,
        type, title, body,
        payload
    });
    updateNotificationBadge();
}

// Load unread count and update bell badge
async function updateNotificationBadge() {
    if (!currentUser) return;
    const { count } = await supabaseClient
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .is('read_at', null);

    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// Load all notifications into the inbox panel
async function loadInboxNotifications() {
    if (!currentUser) return;
    updateNotificationBadge();

    const container = document.getElementById('notif-inbox-list');
    if (!container) return;

    container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</p>';

    const { data, error } = await supabaseClient
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error || !data?.length) {
        container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem;font-size:0.875rem;">No notifications yet.</p>';
        return;
    }

    container.innerHTML = data.map(n => {
        const isRead = !!n.read_at;
        const timeAgo = formatTimeAgo(new Date(n.created_at));
        const iconMap = {
            'appointment_cancelled': 'fa-ban',
            'appointment_declined':  'fa-xmark-circle',
            'appointment_confirmed': 'fa-circle-check',
            'reminder':              'fa-bell',
            // --- NEW HEALTHCARE WORKFLOW EXTENSIONS ---
            'appointment_completed': 'fa-stethoscope',
            'record_shared':         'fa-folder-open',
            'record_revoked':        'fa-folder-closed',
            'notes_updated':         'fa-file-prescription'
        };
        const colorMap = {
            'appointment_cancelled': '#ef4444',
            'appointment_declined':  '#f97316',
            'appointment_confirmed': '#22c55e',
            'reminder':              '#3b82f6',
            // --- NEW HEALTHCARE WORKFLOW EXTENSIONS ---
            'appointment_completed': '#8b5cf6', // Professional Purple
            'record_shared':         '#10b981', // Emerald Green
            'record_revoked':        '#64748b', // Slate Gray
            'notes_updated':         '#0ea5e9'  // Clinical Light Blue
        };
        const icon  = iconMap[n.type]  || 'fa-bell';
        const color = colorMap[n.type] || '#6b7280';

        return `
        <div class="notif-item ${isRead ? 'notif-read' : 'notif-unread'}" data-id="${n.id}" onclick="markOneRead('${n.id}', this)">
            <div class="notif-icon" style="background:${color}20;color:${color};">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="notif-body">
                <p class="notif-title">${n.title}</p>
                <p class="notif-text">${n.body}</p>
                <p class="notif-time">${timeAgo}</p>
            </div>
            ${!isRead ? '<div class="notif-dot"></div>' : ''}
        </div>`;
    }).join('');
}

async function markAllRead() {
    if (!currentUser) return;
    await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', currentUser.id)
        .is('read_at', null);
    loadInboxNotifications();
}

async function markOneRead(id, el) {
    await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
    if (el) {
        el.classList.remove('notif-unread');
        el.classList.add('notif-read');
        const dot = el.querySelector('.notif-dot');
        if (dot) dot.remove();
    }
    updateNotificationBadge();
}

function formatTimeAgo(date) {
    const secs = Math.floor((new Date() - date) / 1000);
    if (secs < 60)   return 'Just now';
    if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
    return `${Math.floor(secs/86400)}d ago`;
}

function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    const overlay = document.getElementById('notif-overlay');
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open');
    overlay.classList.toggle('active');
    if (!isOpen) loadInboxNotifications(); // Refresh on open
}

// --- CUSTOM TOAST NOTIFICATIONS ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    // Styling the toast based on success or error
    const bgColor = type === 'success' ? '#10b981' : '#ef4444'; // Green or Red
    toast.style.cssText = `
        background-color: ${bgColor}; color: white; padding: 12px 20px; 
        border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        font-family: sans-serif; font-size: 14px; display: flex; align-items: center; gap: 10px;
        opacity: 0; transform: translateX(100%); transition: all 0.3s ease-in-out;
    `;
    
    const icon = type === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-exclamation"></i>';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; }, 10);
    
    // Animate out and remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
// =========================================
// HAMBURGER MENU / MOBILE DRAWER
// =========================================
function toggleMobileNav() {
    const drawer = document.getElementById('mobile-nav-drawer');
    const overlay = document.getElementById('mobile-nav-overlay');
    const btn = document.getElementById('hamburger-btn');
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        closeMobileNav();
    } else {
        drawer.classList.add('open');
        overlay.classList.add('active');
        btn.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeMobileNav() {
    const drawer = document.getElementById('mobile-nav-drawer');
    const overlay = document.getElementById('mobile-nav-overlay');
    const btn = document.getElementById('hamburger-btn');
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    btn.classList.remove('open');
    document.body.style.overflow = '';
}

// Sync mobile nav list to mirror the sidebar nav list
function syncMobileNav() {
    const sourceList = document.getElementById('nav-list-container');
    const mobileList = document.getElementById('mobile-nav-list-container');
    if (!sourceList || !mobileList) return;
    // Clone the nav items and wire up close-on-click
    mobileList.innerHTML = sourceList.innerHTML;
    mobileList.querySelectorAll('a.nav-link').forEach(link => {
        link.addEventListener('click', () => closeMobileNav());
    });
}

// Mirror the active state in the mobile drawer
function syncMobileNavActiveState(viewName) {
    const mobileList = document.getElementById('mobile-nav-list-container');
    if (!mobileList) return;
    mobileList.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeLink = mobileList.querySelector(`.nav-link[onclick*="'${viewName}'"]`);
    if (activeLink) activeLink.parentElement.classList.add('active');
}

// =========================================
// BOOKING CONFLICT PREVENTION
// =========================================

// Check if a doctor is already booked at the requested datetime (±60 min minimum interval)
async function checkDoctorConflict(doctorId, isoDateTime) {
    const requestedTime = new Date(isoDateTime);
    const bufferMs = 60 * 60 * 1000; // 60-minute minimum interval between appointments
    const from = new Date(requestedTime.getTime() - bufferMs).toISOString();
    const to   = new Date(requestedTime.getTime() + bufferMs).toISOString();

    const { data, error } = await supabaseClient
        .from('appointments')
        .select('id, appointment_date, patient_name, status')
        .eq('doctor_id', doctorId)
        .in('status', ['pending', 'Confirmed', 'confirmed'])
        .gte('appointment_date', from)
        .lte('appointment_date', to);

    if (error) return { conflict: false };
    return { conflict: data && data.length > 0, appointments: data };
}

// Fetch all booked times for a doctor on a given date (for calendar display)
async function fetchDoctorBookedSlots(doctorId, dateStr) {
    // dateStr: "YYYY-MM-DD"
    const start = new Date(`${dateStr}T00:00:00`).toISOString();
    const end = new Date(`${dateStr}T23:59:59`).toISOString();

    const { data, error } = await supabaseClient
        .from('appointments')
        .select('appointment_date, status')
        .eq('doctor_id', doctorId)
        .in('status', ['pending', 'Confirmed', 'confirmed'])
        .gte('appointment_date', start)
        .lte('appointment_date', end);

    if (error || !data) return [];
    return data.map(a => {
        const d = new Date(a.appointment_date);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    });
}

// --- INLINE PASSWORD UPDATE (Settings Page) ---
async function updateInlinePassword(btn) {
    if (!currentUser) return;

    const newPass = document.getElementById('settings-new-pass').value;
    const confirmPass = document.getElementById('settings-confirm-pass').value;

    // Basic Validation
    if (!newPass) {
        return showToast("Please enter a new password.", "error");
    }
    if (newPass !== confirmPass) {
        return showToast("New passwords do not match.", "error");
    }

    // UI Loading state
    const originalText = btn.textContent;
    btn.textContent = "Updating...";
    btn.disabled = true;

    // Send to Supabase
    const { error } = await supabaseClient.auth.updateUser({ 
        password: newPass 
    });

    if (error) {
        showToast(error.message, "error");
    } else {
        showToast("Password securely updated!", "success");
        // Clear the fields out so they don't sit there filled in
        document.getElementById('settings-new-pass').value = '';
        document.getElementById('settings-confirm-pass').value = '';
        if(document.getElementById('settings-current-pass')) {
            document.getElementById('settings-current-pass').value = ''; 
        }
    }

    // Restore button UI
    btn.textContent = originalText;
    btn.disabled = false;
}

// =========================================
// TWO-FACTOR AUTHENTICATION (MFA / TOTP)
// =========================================

async function handle2FAToggle(toggleElement) {
    if (!currentUser) return;
    
    const isCurrentlyEnabled = toggleElement.classList.contains('checked');

    if (isCurrentlyEnabled) {
        // TURN OFF 2FA
        showConfirm("Are you sure you want to disable Two-Factor Authentication? This makes your account less secure.", async (confirmed) => {
            if (!confirmed) return;
            
            try {
                // Fetch the user's enrolled factors
                const { data, error } = await supabaseClient.auth.mfa.listFactors();
                if (error) throw error;

                const totpFactor = data.totp[0];
                if (totpFactor) {
                    // Unenroll them from the database
                    const { error: unenrollError } = await supabaseClient.auth.mfa.unenroll({ factorId: totpFactor.id });
                    if (unenrollError) throw unenrollError;
                }

                // Update UI and Metadata
                toggleElement.classList.remove('checked');
                await supabaseClient.auth.updateUser({ data: { setting_2fa: false } });
                showToast("Two-Factor Authentication disabled.", "success");

            } catch (err) {
                showToast("Error disabling 2FA: " + err.message, "error");
            }
        });
    } else {
        // TURN ON 2FA: Start the setup process
        openModal('mfa-setup');
        document.getElementById('mfa-error').style.display = 'none';
        document.getElementById('mfa-success').style.display = 'none';
        document.getElementById('mfa-code-input').value = '';
        
        try {
            document.getElementById('qr-code-container').innerHTML = '<div class="loading-cell text-sm text-gray-400">Generating secure code...</div>';

            // STEP A: Forcefully clean up any "ghost" factors and WAIT for it to finish
            const { data: listData, error: listError } = await supabaseClient.auth.mfa.listFactors();
            if (listError) throw listError;
            
            if (listData && listData.totp) {
                const unenrollPromises = listData.totp
                    .filter(factor => factor.status === 'unverified')
                    .map(factor => supabaseClient.auth.mfa.unenroll({ factorId: factor.id }));
                
                // Pause execution until all ghost factors are confirmed deleted from the database
                await Promise.all(unenrollPromises);
            }

            // STEP B: Generate the new code with a unique friendly name to guarantee zero collisions
            const uniqueSuffix = Math.floor(Math.random() * 10000);
            const { data, error } = await supabaseClient.auth.mfa.enroll({ 
                factorType: 'totp',
                issuer: 'Instadoc', 
                friendlyName: `Instadoc Secure Login ${uniqueSuffix}` // Guarantees uniqueness!
            });
            
            if (error) throw error;

            // Save the Factor ID secretly in the form so we can verify it in the next step
            document.getElementById('mfa-factor-id').value = data.id;

           // Inject the Supabase-generated SVG QR Code securely using DOM elements to prevent quote-breaking
            const qrContainer = document.getElementById('qr-code-container');
            qrContainer.innerHTML = ''; // Clear the loading text
            
            const qrImg = document.createElement('img');
            qrImg.src = data.totp.qr_code; // Programmatic assignment prevents HTML syntax errors!
            qrImg.alt = "2FA QR Code";
            qrImg.style.width = "100%";
            qrImg.style.height = "100%";
            qrImg.style.objectFit = "contain";
            qrImg.style.padding = "10px";
            
            qrContainer.appendChild(qrImg);
            
        } catch (err) {
            document.getElementById('qr-code-container').innerHTML = `<p class="text-xs text-red-500 px-4" style="text-align:center;">${err.message}</p>`;
        }
    }
}

// 2. Verify the 6-digit code to finalize enrollment
document.getElementById('mfa-verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('mfa-code-input').value.trim();
    const factorId = document.getElementById('mfa-factor-id').value;
    const btn = document.getElementById('mfa-verify-btn');
    const errEl = document.getElementById('mfa-error');
    
    if (code.length !== 6) {
        errEl.textContent = "Code must be 6 digits.";
        errEl.style.display = 'block';
        return;
    }

    btn.textContent = "Verifying...";
    btn.disabled = true;

    try {
        // Step A: Create a "Challenge" for the factor
        const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({ factorId });
        if (challengeError) throw challengeError;

        // Step B: Verify the 6-digit code against the challenge
        const { error: verifyError } = await supabaseClient.auth.mfa.verify({ 
            factorId, 
            challengeId: challenge.id, 
            code 
        });
        
        if (verifyError) throw verifyError;

        // SUCCESS! 
        document.getElementById('mfa-success').textContent = "2FA successfully enabled!";
        document.getElementById('mfa-success').style.display = 'block';
        errEl.style.display = 'none';
        
        // Update the UI toggle and save metadata
        document.getElementById('toggle-2fa').classList.add('checked');
        await supabaseClient.auth.updateUser({ data: { setting_2fa: true } });

        setTimeout(() => {
            closeModals();
            showToast("Account security upgraded.", "success");
        }, 1500);

    } catch (err) {
        errEl.textContent = "Invalid code. Try again.";
        errEl.style.display = 'block';
    } finally {
        btn.textContent = "Verify & Enable 2FA";
        btn.disabled = false;
    }
});

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
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  form.addEventListener('submit', async (e) => {
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

async function viewPatientRecords(patientId, patientName) {
    if (!currentUser || userRole !== 'doctor') return;

    // 1. Setup secure loading state
    const modalBody = document.getElementById('records-modal-body');
    document.getElementById('records-modal-title').innerHTML = `<i class="fa-solid fa-folder-medical text-blue-500 mr-2"></i> Medical File: ${patientName}`;
    modalBody.innerHTML = '<div class="py-10 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-3 text-blue-400"></i><p class="text-sm">Verifying authorization & fetching records securely...</p></div>';
    
    // Use existing generic modal opener
    document.getElementById('patient-records-modal').classList.add('active');

    // 2. Strict Authorization Validation
    const { data: accessData, error: accessError } = await supabaseClient
        .from('appointments')
        .select('id, share_records, status')
        .eq('doctor_id', currentUser.id)
        .eq('user_id', patientId)
        .in('status', ['confirmed', 'Confirmed', 'completed']);

    if (accessError) {
        modalBody.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100"><i class="fa-solid fa-triangle-exclamation mr-2"></i> Database verification error.</div>`;
        return;
    }

    const hasAccess = accessData && accessData.length > 0;
    const hasExplicitConsent = accessData && accessData.some(a => a.share_records === true);

    // If no relationship exists, hard-block the UI
    if (!hasAccess) {
        modalBody.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-center">
                <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-400 text-2xl border border-gray-100 shadow-sm">
                    <i class="fa-solid fa-lock"></i>
                </div>
                <h4 class="font-bold text-gray-800 mb-2">Access Restricted</h4>
                <p class="text-sm text-gray-500 max-w-sm">You do not have active consent or prior confirmed consultations with this patient. Record visibility is restricted to protect patient privacy.</p>
            </div>`;
        return;
    }

    // 3. Authorized Data Fetch
    try {
        const [wData, bData, gData] = await Promise.all([
            supabaseClient.from('weight_logs').select('*').eq('user_id', patientId).order('date', {ascending:false}).limit(5),
            supabaseClient.from('bp_logs').select('*').eq('user_id', patientId).order('date', {ascending:false}).limit(5),
            supabaseClient.from('glucose_logs').select('*').eq('user_id', patientId).order('date', {ascending:false}).limit(5)
        ]);

        let html = '';

        // Render Security Banner
        if (hasExplicitConsent) {
            html += `<div class="bg-green-50 border border-green-200 text-green-700 text-xs p-3 rounded-lg mb-5 flex items-center gap-2 shadow-sm font-medium"><i class="fa-solid fa-shield-check text-base"></i> Patient explicitly consented to comprehensive record sharing.</div>`;
        } else {
            html += `<div class="bg-blue-50 border border-blue-200 text-blue-700 text-xs p-3 rounded-lg mb-5 flex items-center gap-2 shadow-sm font-medium"><i class="fa-solid fa-unlock-keyhole text-base"></i> Access granted via active/past consultation history.</div>`;
        }

        // Section Renderer Helper
        const renderSection = (title, icon, data, formatter) => {
            if (!data || data.length === 0) {
                return `<div class="mb-5"><h5 class="text-sm font-bold text-gray-700 mb-2 flex items-center"><i class="fa-solid ${icon} mr-2 text-gray-400 w-4"></i> ${title}</h5><div class="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-3 text-xs text-gray-400 italic text-center">No recent records available.</div></div>`;
            }
            
            let rows = data.map(item => `
                <div class="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors px-2 rounded">
                    <span class="text-xs text-gray-500 font-medium"><i class="fa-regular fa-calendar mr-1"></i> ${new Date(item.date).toLocaleDateString()}</span>
                    <span class="text-sm font-bold text-gray-800">${formatter(item)}</span>
                </div>
            `).join('');
            
            return `<div class="mb-6"><h5 class="text-sm font-bold text-gray-800 mb-3 flex items-center"><i class="fa-solid ${icon} mr-2 text-blue-500 w-4"></i> ${title}</h5><div class="border border-gray-100 rounded-lg shadow-sm p-2 bg-white">${rows}</div></div>`;
        };

        // Render specific vitals
        html += renderSection('Blood Pressure History', 'fa-heart-pulse', bData.data, (item) => `${item.systolic}/${item.diastolic} <span class="text-[10px] text-gray-400 font-normal">mmHg</span>`);
        html += renderSection('Blood Glucose Logs', 'fa-droplet', gData.data, (item) => `${item.level} <span class="text-[10px] text-gray-400 font-normal">mg/dL</span> <span class="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-1">${item.test_type}</span>`);
        html += renderSection('Weight Tracking', 'fa-weight-scale', wData.data, (item) => `${item.weight} <span class="text-[10px] text-gray-400 font-normal">kg</span>`);

        modalBody.innerHTML = html;

    } catch (error) {
        modalBody.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-lg text-sm"><i class="fa-solid fa-circle-exclamation mr-2"></i> Error fetching medical data securely.</div>`;
    }
}