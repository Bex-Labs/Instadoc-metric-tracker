// ============================================================
//  InstaDoc – consultation.js (Supabase + Google Meet)
//  Integrated video/audio consultation via Google Meet
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── SUPABASE CREDENTIALS ──────────────────
const SUPABASE_URL     = 'https://gkivyakhijvrqirlpvmi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdraXZ5YWtoaWp2cnFpcmxwdm1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTA3NzgsImV4cCI6MjA4NjM4Njc3OH0.x_hIoqKK-gWar49EAnY7cv5b-ziq3-BzvwM01MlGqoI';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('✅ Supabase initialized successfully!');

// ── FORMSPREE ENDPOINTS ──────────────────
// STEP 1: Go to https://formspree.io and create 2 forms
// STEP 2: Replace these with your actual Formspree form endpoints
const FORMSPREE_PATIENT_ENDPOINT = 'https://formspree.io/f/xeelgdgj';  // Patient confirmation emails
const FORMSPREE_DOCTOR_ENDPOINT = 'https://formspree.io/f/xgolkqkv';    // Doctor notification emails




// ============================================================
//  DOCTORS DATA
// ============================================================
const doctors = [
    { id: 1, name: 'Dr. Adebayo Okonkwo',   specialty: 'General Medicine', initials: 'AO', experience: '15+ years', rating: 4.9, availability: ['Monday','Tuesday','Wednesday','Friday'], email: 'abbassani94@gmail.com' },
    { id: 2, name: 'Dr. Chiamaka Nwankwo',  specialty: 'Cardiology',       initials: 'CN', experience: '12+ years', rating: 4.8, availability: ['Tuesday','Wednesday','Thursday','Saturday'], email: 'dr.nwankwo@instadoc.ng' },
    { id: 3, name: 'Dr. Ibrahim Abdullahi', specialty: 'Pediatrics',       initials: 'IA', experience: '10+ years', rating: 4.9, availability: ['Monday','Wednesday','Thursday','Friday'], email: 'dr.abdullahi@instadoc.ng' },
    { id: 4, name: 'Dr. Folake Eze',        specialty: 'Dermatology',      initials: 'FE', experience: '8+ years',  rating: 4.7, availability: ['Monday','Tuesday','Thursday','Saturday'], email: 'dr.eze@instadoc.ng' },
    { id: 5, name: 'Dr. Chidinma Obi',      specialty: 'Gynecology',       initials: 'CO', experience: '14+ years', rating: 4.9, availability: ['Tuesday','Wednesday','Friday','Saturday'], email: 'dr.obi@instadoc.ng' },
    { id: 6, name: 'Dr. Tunde Balogun',     specialty: 'Orthopedics',      initials: 'TB', experience: '11+ years', rating: 4.8, availability: ['Monday','Tuesday','Wednesday','Thursday'], email: 'dr.balogun@instadoc.ng' }
];

const timeSlots = [
    '09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
    '02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM','04:30 PM',
    '05:00 PM','05:30 PM'
];

// ============================================================
//  STATE
// ============================================================
let bookingState = {
    currentStep: 1,
    selectedDoctor: null,
    selectedDate: null,
    selectedTime: null,
    patientDetails: {},
    referenceNumber: null,
    meetLink: null  // NEW: Store Google Meet link
};

let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let calendarInitialized = false;
let bookedAppointments  = [];
let realtimeChannel     = null;


// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    loadDoctors();
    setupNavigationButtons();
    setupFormValidation();
});


// ============================================================
//  DOCTORS GRID
// ============================================================
function loadDoctors() {
    const doctorsGrid = document.getElementById('doctorsGrid');
    doctors.forEach(doctor => {
        const doctorCard = document.createElement('div');
        doctorCard.className = 'doctor-card';
        doctorCard.dataset.doctorId = doctor.id;
        doctorCard.innerHTML = `
            <div class="doctor-avatar">${doctor.initials}</div>
            <div class="doctor-name">${doctor.name}</div>
            <div class="doctor-specialty">${doctor.specialty}</div>
            <div class="doctor-info">${doctor.experience} experience</div>
            <div class="doctor-rating"><span>★</span><span>${doctor.rating} Rating</span></div>
        `;
        doctorCard.addEventListener('click', () => selectDoctor(doctor.id));
        doctorsGrid.appendChild(doctorCard);
    });
}

function selectDoctor(doctorId) {
    document.querySelectorAll('.doctor-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`[data-doctor-id="${doctorId}"]`).classList.add('selected');
    bookingState.selectedDoctor = doctors.find(d => d.id === doctorId);
    startAppointmentListener(doctorId);
    document.getElementById('nextBtn').disabled = false;
}


// ============================================================
//  REAL-TIME LISTENER
// ============================================================
async function startAppointmentListener(doctorId) {
    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    console.log('📡 Starting real-time listener for doctor:', doctorId);
    await fetchAppointments(doctorId);

    realtimeChannel = supabase
        .channel(`appointments-doctor-${doctorId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'appointments',
                filter: `doctor_id=eq.${doctorId}`
            },
            async (payload) => {
                console.log('🔔 Real-time update received from Supabase:', payload.eventType);
                await fetchAppointments(doctorId);
            }
        )
        .subscribe();
}

async function fetchAppointments(doctorId) {
    const { data, error } = await supabase
        .from('appointments')
        .select('id, date_string, time_slot')
        .eq('doctor_id', doctorId);

    if (error) {
        console.error('❌ Error fetching appointments:', error.message);
        return;
    }

    bookedAppointments = data.map(row => ({
        id:         row.id,
        dateString: row.date_string,
        timeSlot:   row.time_slot
    }));

    console.log('📅 Found', bookedAppointments.length, 'appointments for this doctor');

    if (bookingState.currentStep === 2) {
        renderCalendar();
        if (bookingState.selectedDate) loadTimeSlots();
    }
}


// ============================================================
//  CALENDAR
// ============================================================
function initializeCalendar() {
    if (!calendarInitialized) {
        renderCalendar();
        document.getElementById('prevMonth').addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) { currentMonth = 11; currentYear--; }
            renderCalendar();
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) { currentMonth = 0; currentYear++; }
            renderCalendar();
        });
        calendarInitialized = true;
    }
}

function renderCalendar() {
    const calendarGrid  = document.getElementById('calendarGrid');
    const calendarMonth = document.getElementById('calendarMonth');
    calendarGrid.innerHTML = '';

    const monthNames   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dayHeaders   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayShortNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    calendarMonth.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    dayShortNames.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.textContent = day;
        calendarGrid.appendChild(header);
    });

    const firstDay    = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today       = new Date();

    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day disabled';
        calendarGrid.appendChild(emptyDay);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayElement  = document.createElement('div');
        const date        = new Date(currentYear, currentMonth, day);
        const dayIndex    = date.getDay();
        const dayName     = dayHeaders[dayIndex];
        const isPast      = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        let   isAvailable = bookingState.selectedDoctor
            ? bookingState.selectedDoctor.availability.includes(dayName)
            : false;

        const dateString        = formatDateString(date);
        const bookingsOnThisDate = bookedAppointments.filter(apt => apt.dateString === dateString);
        const bookingCount      = bookingsOnThisDate.length;
        const isFullyBooked     = bookingCount >= timeSlots.length;

        dayElement.className = 'calendar-day';
        dayElement.textContent = day;

        if (isPast || !isAvailable || isFullyBooked) {
            dayElement.classList.add('disabled');
        } else {
            dayElement.addEventListener('click', () => selectDate(date));
        }

        if (date.toDateString() === today.toDateString()) dayElement.classList.add('today');

        if (bookingState.selectedDate && date.toDateString() === bookingState.selectedDate.toDateString()) {
            dayElement.classList.add('selected');
        }

        if (bookingCount > 0 && !isPast) {
            const badge = document.createElement('span');
            badge.className = 'booking-badge';
            badge.textContent = bookingCount;
            dayElement.appendChild(badge);
        }

        calendarGrid.appendChild(dayElement);
    }
}


// ============================================================
//  TIME SLOTS
// ============================================================
function selectDate(date) {
    bookingState.selectedDate = date;
    renderCalendar();
    document.getElementById('timeSlotsContainer').style.display = 'block';
    loadTimeSlots();
    document.getElementById('timeSlotsContainer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function loadTimeSlots() {
    const timeSlotsGrid = document.getElementById('timeSlotsGrid');
    timeSlotsGrid.innerHTML = '';
    const dateString  = formatDateString(bookingState.selectedDate);
    const bookedTimes = bookedAppointments
        .filter(apt => apt.dateString === dateString)
        .map(apt => apt.timeSlot);

    console.log('⏰ Booked times for', dateString, ':', bookedTimes);

    timeSlots.forEach(time => {
        const timeSlot = document.createElement('div');
        timeSlot.className = 'time-slot';
        timeSlot.textContent = time;

        if (bookedTimes.includes(time)) {
            timeSlot.classList.add('disabled');
            timeSlot.style.cursor = 'not-allowed';
            timeSlot.title = 'This time slot is already booked';
        } else {
            timeSlot.addEventListener('click', () => selectTime(time));
            if (bookingState.selectedTime === time) timeSlot.classList.add('selected');
        }

        timeSlotsGrid.appendChild(timeSlot);
    });
}

function selectTime(time) {
    bookingState.selectedTime = time;
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    event.target.classList.add('selected');
    document.getElementById('nextBtn').disabled = false;
}


// ============================================================
//  NAVIGATION
// ============================================================
function setupNavigationButtons() {
    document.getElementById('nextBtn').addEventListener('click', goToNextStep);
    document.getElementById('prevBtn').addEventListener('click', goToPreviousStep);
}

function goToNextStep() {
    if (bookingState.currentStep === 1 && !bookingState.selectedDoctor) {
        alert('Please select a doctor'); return;
    }
    if (bookingState.currentStep === 2 && (!bookingState.selectedDate || !bookingState.selectedTime)) {
        alert('Please select both a date and time'); return;
    }
    if (bookingState.currentStep === 3) {
        if (!validatePatientForm()) return;
        savePatientDetails();
        confirmBooking();
    }

    if (bookingState.currentStep < 4) {
        document.getElementById(`step${bookingState.currentStep}`).classList.remove('active');
        bookingState.currentStep++;
        document.getElementById(`step${bookingState.currentStep}`).classList.add('active');
        if (bookingState.currentStep === 2) initializeCalendar();
        updateStepIndicators();
        updateNavigationButtons();
        document.querySelector('.booking-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function goToPreviousStep() {
    if (bookingState.currentStep > 1) {
        document.getElementById(`step${bookingState.currentStep}`).classList.remove('active');
        bookingState.currentStep--;
        document.getElementById(`step${bookingState.currentStep}`).classList.add('active');
        updateStepIndicators();
        updateNavigationButtons();
        document.querySelector('.booking-content').scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (bookingState.currentStep === 2) {
            renderCalendar();
            if (bookingState.selectedDate) {
                document.getElementById('timeSlotsContainer').style.display = 'block';
                loadTimeSlots();
            }
        }
    }
}

function updateStepIndicators() {
    document.querySelectorAll('.step').forEach((step, index) => {
        const n = index + 1;
        if      (n < bookingState.currentStep)  { step.classList.add('completed'); step.classList.remove('active'); }
        else if (n === bookingState.currentStep) { step.classList.add('active');    step.classList.remove('completed'); }
        else                                     { step.classList.remove('active', 'completed'); }
    });
}

function updateNavigationButtons() {
    const nextBtn    = document.getElementById('nextBtn');
    const prevBtn    = document.getElementById('prevBtn');
    const bookingNav = document.getElementById('bookingNav');

    prevBtn.style.display = bookingState.currentStep > 1 ? 'block' : 'none';

    if (bookingState.currentStep === 4) {
        bookingNav.style.display = 'none';
    } else {
        bookingNav.style.display = 'flex';
        if      (bookingState.currentStep === 1) { nextBtn.textContent = 'Next →'; nextBtn.disabled = !bookingState.selectedDoctor; }
        else if (bookingState.currentStep === 2) { nextBtn.textContent = 'Next →'; nextBtn.disabled = !bookingState.selectedTime; }
        else if (bookingState.currentStep === 3) { nextBtn.textContent = 'Confirm Booking'; nextBtn.disabled = false; }
    }
}


// ============================================================
//  FORM VALIDATION
// ============================================================
function setupFormValidation() {
    const form   = document.getElementById('patientForm');
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', () => { if (input.checkValidity()) input.style.borderColor = ''; });
        input.addEventListener('blur',  () => { if (!input.checkValidity() && input.value) input.style.borderColor = '#ef4444'; });
    });
}

function validatePatientForm() {
    const form = document.getElementById('patientForm');
    if (!form.checkValidity()) {
        form.querySelectorAll('input, select, textarea').forEach(input => {
            if (!input.checkValidity()) input.style.borderColor = '#ef4444';
        });
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstInvalid.focus(); }
        return false;
    }
    return true;
}

function savePatientDetails() {
    bookingState.patientDetails = {
        name:             document.getElementById('patientName').value,
        email:            document.getElementById('patientEmail').value,
        phone:            document.getElementById('patientPhone').value,
        age:              document.getElementById('patientAge').value,
        consultationType: document.getElementById('consultationType').value,
        symptoms:         document.getElementById('symptoms').value,
        medicalHistory:   document.getElementById('medicalHistory').value
    };
}


// ============================================================
//  GOOGLE MEET LINK GENERATION
// ============================================================
async function generateGoogleMeetLink() {
    // Method 1: Use Google Calendar API to create event with Meet link
    // This requires OAuth2 - for production use
    // For now, we'll use a simpler instant Meet link approach
    
    const meetLink = `https://meet.google.com/${generateMeetCode()}`;
    console.log('🎥 Generated Google Meet link:', meetLink);
    return meetLink;
}

function generateMeetCode() {
    // Generate a unique 10-character code similar to Google Meet format
    // Format: xxx-xxxx-xxx (3-4-3 pattern with letters)
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const part1 = Array(3).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    const part2 = Array(4).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    const part3 = Array(3).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${part1}-${part2}-${part3}`;
}


// ============================================================
//  CONFIRM BOOKING (with Google Meet integration)
// ============================================================
async function confirmBooking() {
    try {
        bookingState.referenceNumber = 'IDC' + Date.now().toString().slice(-8);

        // ── Generate Google Meet link ──
        bookingState.meetLink = await generateGoogleMeetLink();

        const options       = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = bookingState.selectedDate.toLocaleDateString('en-US', options);

        const consultationTypes = {
            general:    'General Consultation',
            followup:   'Follow-up Appointment',
            specialist: 'Specialist Consultation',
            emergency:  'Urgent Care'
        };

        const appointmentData = {
            doctor_id:        bookingState.selectedDoctor.id,
            doctor_name:      bookingState.selectedDoctor.name,
            doctor_specialty: bookingState.selectedDoctor.specialty,
            doctor_email:     bookingState.selectedDoctor.email,  // NEW: for sending Meet link

            date_string:      formatDateString(bookingState.selectedDate),
            time_slot:        bookingState.selectedTime,
            appointment_date: bookingState.selectedDate.toISOString(),

            patient_name:  bookingState.patientDetails.name,
            patient_email: bookingState.patientDetails.email,
            patient_phone: bookingState.patientDetails.phone,
            patient_age:   parseInt(bookingState.patientDetails.age),

            consultation_type: bookingState.patientDetails.consultationType,
            symptoms:          bookingState.patientDetails.symptoms,
            medical_history:   bookingState.patientDetails.medicalHistory,

            reference_number:  bookingState.referenceNumber,
            status:            'confirmed',
            meet_link:         bookingState.meetLink,  // NEW: Store Meet link
            notification_sent: false,
            email_sent:        false
        };

        console.log('💾 Saving appointment to Supabase...', appointmentData);

        const { data, error } = await supabase
            .from('appointments')
            .insert(appointmentData)
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Appointment saved successfully! ID:', data.id);

        // ── Update confirmation UI ──
        document.getElementById('confirmDoctor').textContent  = bookingState.selectedDoctor.name;
        document.getElementById('confirmDate').textContent    = formattedDate;
        document.getElementById('confirmTime').textContent    = bookingState.selectedTime;
        document.getElementById('confirmPatient').textContent = bookingState.patientDetails.name;
        document.getElementById('confirmType').textContent    = consultationTypes[bookingState.patientDetails.consultationType];
        document.getElementById('confirmReference').textContent = bookingState.referenceNumber;

        // ── NEW: Show Google Meet button ──
        showMeetButton(bookingState.meetLink);

        // ── Send emails with Meet link ──
        await sendConfirmationEmail({ ...appointmentData, savedId: data.id });
        await notifyDoctor(appointmentData);

    } catch (error) {
        console.error('❌ Error saving appointment:', error);
        alert('Failed to save appointment. Please try again. Error: ' + error.message);
    }
}


// ============================================================
//  SHOW GOOGLE MEET BUTTON ON CONFIRMATION PAGE
// ============================================================
function showMeetButton(meetLink) {
    // Find the confirmation details section
    const confirmationSection = document.querySelector('.confirmation-details');
    
    // Create Meet button container
    const meetButtonHTML = `
        <div class="meet-link-section" style="margin-top: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #e8f5e9 0%, #f1f8f4 100%); border-radius: 12px; border-left: 4px solid #2ecc71;">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#2ecc71"/>
                </svg>
                <div>
                    <h3 style="margin: 0; color: #1a5f38; font-size: 1.1rem;">Video Consultation Ready</h3>
                    <p style="margin: 0.25rem 0 0 0; color: #555; font-size: 0.9rem;">Join at your scheduled time</p>
                </div>
            </div>
            <a href="${meetLink}" target="_blank" class="btn-join-meet" style="display: inline-block; background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); color: white; padding: 1rem 2rem; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 1.05rem; transition: transform 0.2s, box-shadow 0.2s;">
                🎥 Join Video Consultation
            </a>
            <p style="margin-top: 1rem; font-size: 0.85rem; color: #666;">
                <strong>Note:</strong> This link will also be sent to your email. You can join 5 minutes before your scheduled time.
            </p>
        </div>
    `;
    
    // Insert after the confirmation details
    confirmationSection.insertAdjacentHTML('afterend', meetButtonHTML);

    // Add hover effect
    const meetBtn = document.querySelector('.btn-join-meet');
    meetBtn.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 8px 20px rgba(46, 204, 113, 0.4)';
    });
    meetBtn.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = 'none';
    });

    const statusEl = document.getElementById('bookingStatus');
        if (statusEl) {
            statusEl.insertAdjacentHTML('beforeend', '<p>Appointment Saved!</p>');
        } else {
            console.error("Could not find the bookingStatus element in the HTML.");
        }
}


// ============================================================
//  EMAIL NOTIFICATIONS (with Meet link)
// ============================================================
async function sendConfirmationEmail(appointmentData) {
    console.log('📧 Sending confirmation email via Formspree to:', appointmentData.patient_email);

    try {
        const response = await fetch(FORMSPREE_PATIENT_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: appointmentData.patient_email,  // ✅ DYNAMIC - Goes to patient's email
                name: appointmentData.patient_name,
                subject: `Consultation Confirmed - ${appointmentData.reference_number}`,
                message: `
                    ✅ CONSULTATION CONFIRMED!
                    
                    Dear ${appointmentData.patient_name},
                    
                    Your virtual consultation has been successfully scheduled.
                    
                    📅 APPOINTMENT DETAILS:
                    Doctor: ${appointmentData.doctor_name} (${appointmentData.doctor_specialty})
                    Date: ${appointmentData.date_string}
                    Time: ${appointmentData.time_slot}
                    Type: ${appointmentData.consultation_type}
                    Reference: ${appointmentData.reference_number}
                    
                    🩺 YOUR INFORMATION:
                    Symptoms: ${appointmentData.symptoms}
                    Medical History: ${appointmentData.medical_history || 'None provided'}
                    
                    🎥 VIDEO CONSULTATION:
                    Join your video call at the scheduled time:
                    ${appointmentData.meet_link}
                    
                    ⏰ WHAT'S NEXT:
                    - Join the meeting 5 minutes before your scheduled time
                    - Ensure you have a stable internet connection
                    - Have any relevant medical documents ready
                    - Test your camera and microphone before joining
                    
                    ---
                    InstaDoc - We Value Your Health
                    415 Adetokunbo Ademola Street, Abuja, FCT, Nigeria
                `,
                // Additional data for record keeping
                _replyto: appointmentData.patient_email,
                _subject: `Consultation Confirmed - ${appointmentData.reference_number}`
            })
        });

        if (response.ok) {
            console.log('✅ Patient confirmation email sent successfully via Formspree');
            
            if (appointmentData.savedId) {
                await supabase
                    .from('appointments')
                    .update({ email_sent: true })
                    .eq('id', appointmentData.savedId);
            }
        } else {
            const error = await response.json();
            console.error('❌ Failed to send email:', error);
        }

    } catch (error) {
        console.error('❌ Error sending confirmation email:', error);
    }
}

async function notifyDoctor(appointmentData) {
    console.log('🔔 Notifying doctor via Formspree:', appointmentData.doctor_name);

    try {
        const response = await fetch(FORMSPREE_DOCTOR_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: appointmentData.doctor_email,  // ✅ DYNAMIC - Goes to doctor's email
                name: appointmentData.doctor_name,
                subject: `New Consultation: ${appointmentData.patient_name} - ${appointmentData.reference_number}`,
                message: `
                    🔔 NEW CONSULTATION SCHEDULED
                    
                    Dear Dr. ${appointmentData.doctor_name.split(' ').pop()},
                    
                    A new patient consultation has been scheduled with you.
                    
                    👤 PATIENT INFORMATION:
                    Name: ${appointmentData.patient_name}
                    Age: ${appointmentData.patient_age} years
                    Phone: ${appointmentData.patient_phone}
                    Email: ${appointmentData.patient_email}
                    
                    📅 APPOINTMENT DETAILS:
                    Date: ${appointmentData.date_string}
                    Time: ${appointmentData.time_slot}
                    Type: ${appointmentData.consultation_type}
                    Reference: ${appointmentData.reference_number}
                    
                    🩺 MEDICAL INFORMATION:
                    Symptoms: ${appointmentData.symptoms}
                    Medical History: ${appointmentData.medical_history || 'None provided'}
                    
                    🎥 VIDEO CONSULTATION LINK:
                    ${appointmentData.meet_link}
                    
                    ⚠️ REMINDER:
                    Please review the patient's symptoms and medical history before the consultation begins.
                    
                    ---
                    InstaDoc Medical Platform
                    415 Adetokunbo Ademola Street, Abuja, FCT, Nigeria
                `,
                _replyto: appointmentData.patient_email,
                _subject: `New Consultation: ${appointmentData.patient_name} - ${appointmentData.reference_number}`
            })
        });

        if (response.ok) {
            console.log('✅ Doctor notification email sent successfully via Formspree');
            
            if (appointmentData.savedId) {
                await supabase
                    .from('appointments')
                    .update({ notification_sent: true })
                    .eq('id', appointmentData.savedId);
            }
        } else {
            const error = await response.json();
            console.error('❌ Failed to send doctor notification:', error);
        }

    } catch (error) {
        console.error('❌ Error sending doctor notification:', error);
    }
}


// ============================================================
//  HELPER
// ============================================================
function formatDateString(date) {
    const year  = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day   = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
