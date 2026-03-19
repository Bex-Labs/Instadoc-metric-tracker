import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCk_1cwoayt9vhzzrrdVPxvoEFlK5ySfmc",
  authDomain: "instadoc-metric.firebaseapp.com",
  projectId: "instadoc-metric",
  storageBucket: "instadoc-metric.firebasestorage.app",
  messagingSenderId: "816900837231",
  appId: "1:816900837231:web:c4d1ae81a7353b055ee29a",
  measurementId: "G-Q324TKM4T8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('🔥 Firebase initialized successfully!');


// Consultation Booking System
// ==============================================

// Sample doctors data (in production, this would come from API)
const doctors = [
    {
        id: 1,
        name: 'Dr. Adebayo Okonkwo',
        specialty: 'General Medicine',
        initials: 'AO',
        experience: '15+ years',
        rating: 4.9,
        availability: ['Monday', 'Tuesday', 'Wednesday', 'Friday']
    },
    {
        id: 2,
        name: 'Dr. Chiamaka Nwankwo',
        specialty: 'Cardiology',
        initials: 'CN',
        experience: '12+ years',
        rating: 4.8,
        availability: ['Tuesday', 'Wednesday', 'Thursday', 'Saturday']
    },
    {
        id: 3,
        name: 'Dr. Ibrahim Abdullahi',
        specialty: 'Pediatrics',
        initials: 'IA',
        experience: '10+ years',
        rating: 4.9,
        availability: ['Monday', 'Wednesday', 'Thursday', 'Friday']
    },
    {
        id: 4,
        name: 'Dr. Folake Eze',
        specialty: 'Dermatology',
        initials: 'FE',
        experience: '8+ years',
        rating: 4.7,
        availability: ['Monday', 'Tuesday', 'Thursday', 'Saturday']
    },
    {
        id: 5,
        name: 'Dr. Chidinma Obi',
        specialty: 'Gynecology',
        initials: 'CO',
        experience: '14+ years',
        rating: 4.9,
        availability: ['Tuesday', 'Wednesday', 'Friday', 'Saturday']
    },
    {
        id: 6,
        name: 'Dr. Tunde Balogun',
        specialty: 'Orthopedics',
        initials: 'TB',
        experience: '11+ years',
        rating: 4.8,
        availability: ['Monday', 'Tuesday', 'Wednesday', 'Thursday']
    }
];

// Time slots available
const timeSlots = [
    '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM',
    '05:00 PM', '05:30 PM'
];

// Booking state
let bookingState = {
    currentStep: 1,
    selectedDoctor: null,
    selectedDate: null,
    selectedTime: null,
    patientDetails: {},
    referenceNumber: null
};

// Calendar state
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let calendarInitialized = false;

// Store booked appointments for real-time updates
let bookedAppointments = [];
let appointmentListener = null;

// Initialize the booking system
document.addEventListener('DOMContentLoaded', function() {
    loadDoctors();
    setupNavigationButtons();
    setupFormValidation();
    // Don't initialize calendar yet - wait for doctor selection
});

// Load doctors into the grid
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
            <div class="doctor-rating">
                <span>★</span>
                <span>${doctor.rating} Rating</span>
            </div>
        `;
        
        doctorCard.addEventListener('click', () => selectDoctor(doctor.id));
        doctorsGrid.appendChild(doctorCard);
    });
}

// Select a doctor
function selectDoctor(doctorId) {
    // Remove previous selection
    document.querySelectorAll('.doctor-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add selection to clicked card
    const selectedCard = document.querySelector(`[data-doctor-id="${doctorId}"]`);
    selectedCard.classList.add('selected');
    
    // Update booking state
    bookingState.selectedDoctor = doctors.find(d => d.id === doctorId);
    
    // Start listening for this doctor's appointments
    startAppointmentListener(doctorId);
    
    // Enable next button
    document.getElementById('nextBtn').disabled = false;
}

// Start real-time listener for doctor's appointments
function startAppointmentListener(doctorId) {
    // Stop previous listener if exists
    if (appointmentListener) {
        appointmentListener();
    }
    
    console.log('📡 Starting real-time listener for doctor:', doctorId);
    
    const q = query(
        collection(db, 'appointments'), 
        where('doctorId', '==', doctorId)
    );
    
    // This runs automatically when data changes!
    appointmentListener = onSnapshot(q, (snapshot) => {
        console.log('🔔 Real-time update received from Firebase');
        bookedAppointments = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                dateString: data.dateString,
                timeSlot: data.timeSlot,
                ...data
            };
        });
        console.log('📅 Found', bookedAppointments.length, 'appointments for this doctor');
        
        // Re-render calendar if we're on step 2
        if (bookingState.currentStep === 2) {
            renderCalendar();
            
            // If a date is selected, refresh time slots
            if (bookingState.selectedDate) {
                loadTimeSlots();
            }
        }
    }, (error) => {
        console.error('❌ Error listening to appointments:', error);
    });
}

// Initialize calendar (call this when moving to step 2)
function initializeCalendar() {
    if (!calendarInitialized) {
        renderCalendar();
        
        document.getElementById('prevMonth').addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar();
        });
        
        document.getElementById('nextMonth').addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar();
        });
        
        calendarInitialized = true;
    }
}

// Render calendar
function renderCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarMonth = document.getElementById('calendarMonth');
    
    // Clear existing calendar
    calendarGrid.innerHTML = '';
    
    // Set month header
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    calendarMonth.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    
    // Add day headers
    const dayHeaders = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    dayShortNames.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.textContent = day;
        calendarGrid.appendChild(header);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    
    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day disabled';
        calendarGrid.appendChild(emptyDay);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayElement = document.createElement('div');
        const date = new Date(currentYear, currentMonth, day);
        const dayIndex = date.getDay();
        const dayName = dayHeaders[dayIndex];
        
        // Check if day is in the past
        const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        
        // Check if doctor is available on this day
        let isAvailable = false;
        if (bookingState.selectedDoctor) {
            isAvailable = bookingState.selectedDoctor.availability.includes(dayName);
        }
        
        // Format date string for comparison with bookings
        const dateString = formatDateString(date);
        
        // Count bookings on this date
        const bookingsOnThisDate = bookedAppointments.filter(
            apt => apt.dateString === dateString
        );
        const bookingCount = bookingsOnThisDate.length;
        
        // Check if all time slots are booked
        const isFullyBooked = bookingCount >= timeSlots.length;
        
        dayElement.className = 'calendar-day';
        dayElement.textContent = day;
        
        if (isPast || !isAvailable || isFullyBooked) {
            dayElement.classList.add('disabled');
        } else {
            dayElement.addEventListener('click', () => selectDate(date));
        }
        
        // Add today indicator
        if (date.toDateString() === today.toDateString()) {
            dayElement.classList.add('today');
        }
        
        // Add selected state
        if (bookingState.selectedDate && date.toDateString() === bookingState.selectedDate.toDateString()) {
            dayElement.classList.add('selected');
        }
        
        // Add booking indicator
        if (bookingCount > 0 && !isPast) {
            const badge = document.createElement('span');
            badge.className = 'booking-badge';
            badge.textContent = bookingCount;
            dayElement.appendChild(badge);
        }
        
        calendarGrid.appendChild(dayElement);
    }
}

// Format date as YYYY-MM-DD string
function formatDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Select a date
function selectDate(date) {
    bookingState.selectedDate = date;
    
    // Update calendar display
    renderCalendar();
    
    // Show time slots
    document.getElementById('timeSlotsContainer').style.display = 'block';
    loadTimeSlots();
    
    // Scroll to time slots
    document.getElementById('timeSlotsContainer').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest' 
    });
}

// Load time slots
function loadTimeSlots() {
    const timeSlotsGrid = document.getElementById('timeSlotsGrid');
    timeSlotsGrid.innerHTML = '';
    
    const dateString = formatDateString(bookingState.selectedDate);
    
    // Get bookings for selected date
    const bookingsOnDate = bookedAppointments.filter(
        apt => apt.dateString === dateString
    );
    
    // Get booked time slots
    const bookedTimes = bookingsOnDate.map(apt => apt.timeSlot);
    
    console.log('⏰ Booked times for', dateString, ':', bookedTimes);
    
    timeSlots.forEach(time => {
        const timeSlot = document.createElement('div');
        timeSlot.className = 'time-slot';
        timeSlot.textContent = time;
        
        // Check if time is already booked
        if (bookedTimes.includes(time)) {
            timeSlot.classList.add('disabled');
            timeSlot.style.cursor = 'not-allowed';
            timeSlot.title = 'This time slot is already booked';
        } else {
            timeSlot.addEventListener('click', () => selectTime(time));
            
            // Show selected state
            if (bookingState.selectedTime === time) {
                timeSlot.classList.add('selected');
            }
        }
        
        timeSlotsGrid.appendChild(timeSlot);
    });
}

// Select a time slot
function selectTime(time) {
    bookingState.selectedTime = time;
    
    // Update time slots display
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('selected');
    });
    
    event.target.classList.add('selected');
    
    // Enable next button
    document.getElementById('nextBtn').disabled = false;
}

// Setup navigation buttons
function setupNavigationButtons() {
    document.getElementById('nextBtn').addEventListener('click', goToNextStep);
    document.getElementById('prevBtn').addEventListener('click', goToPreviousStep);
}

// Go to next step
function goToNextStep() {
    if (bookingState.currentStep === 1) {
        if (!bookingState.selectedDoctor) {
            alert('Please select a doctor');
            return;
        }
    } else if (bookingState.currentStep === 2) {
        if (!bookingState.selectedDate || !bookingState.selectedTime) {
            alert('Please select both a date and time');
            return;
        }
    } else if (bookingState.currentStep === 3) {
        if (!validatePatientForm()) {
            return;
        }
        savePatientDetails();
        confirmBooking();
    }
    
    if (bookingState.currentStep < 4) {
        // Hide current step
        document.getElementById(`step${bookingState.currentStep}`).classList.remove('active');
        
        // Update step
        bookingState.currentStep++;
        
        // Show new step
        document.getElementById(`step${bookingState.currentStep}`).classList.add('active');
        
        // Initialize calendar when moving to step 2
        if (bookingState.currentStep === 2) {
            initializeCalendar();
        }
        
        // Update step indicators
        updateStepIndicators();
        
        // Update navigation buttons
        updateNavigationButtons();
        
        // Scroll to top of content
        document.querySelector('.booking-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Go to previous step
function goToPreviousStep() {
    if (bookingState.currentStep > 1) {
        // Hide current step
        document.getElementById(`step${bookingState.currentStep}`).classList.remove('active');
        
        // Update step
        bookingState.currentStep--;
        
        // Show new step
        document.getElementById(`step${bookingState.currentStep}`).classList.add('active');
        
        // Update step indicators
        updateStepIndicators();
        
        // Update navigation buttons
        updateNavigationButtons();
        
        // Scroll to top of content
        document.querySelector('.booking-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // If going back to step 2, re-render calendar
        if (bookingState.currentStep === 2) {
            renderCalendar();
            if (bookingState.selectedDate) {
                // Re-show time slots if date was already selected
                document.getElementById('timeSlotsContainer').style.display = 'block';
                loadTimeSlots();
            }
        }
    }
}

// Update step indicators
function updateStepIndicators() {
    document.querySelectorAll('.step').forEach((step, index) => {
        const stepNumber = index + 1;
        
        if (stepNumber < bookingState.currentStep) {
            step.classList.add('completed');
            step.classList.remove('active');
        } else if (stepNumber === bookingState.currentStep) {
            step.classList.add('active');
            step.classList.remove('completed');
        } else {
            step.classList.remove('active', 'completed');
        }
    });
}

// Update navigation buttons
function updateNavigationButtons() {
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');
    const bookingNav = document.getElementById('bookingNav');
    
    // Show/hide previous button
    prevBtn.style.display = bookingState.currentStep > 1 ? 'block' : 'none';
    
    // Update next button
    if (bookingState.currentStep === 4) {
        bookingNav.style.display = 'none';
    } else {
        bookingNav.style.display = 'flex';
        
        if (bookingState.currentStep === 1) {
            nextBtn.textContent = 'Next →';
            nextBtn.disabled = !bookingState.selectedDoctor;
        } else if (bookingState.currentStep === 2) {
            nextBtn.textContent = 'Next →';
            nextBtn.disabled = !bookingState.selectedTime;
        } else if (bookingState.currentStep === 3) {
            nextBtn.textContent = 'Confirm Booking';
            nextBtn.disabled = false; // Let validation handle it
        }
    }
}

// Setup form validation
function setupFormValidation() {
    const form = document.getElementById('patientForm');
    const inputs = form.querySelectorAll('input, select, textarea');
    
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            if (input.checkValidity()) {
                input.style.borderColor = '';
            }
        });
        
        input.addEventListener('blur', () => {
            if (!input.checkValidity() && input.value) {
                input.style.borderColor = '#ef4444';
            }
        });
    });
}

// Validate patient form
function validatePatientForm() {
    const form = document.getElementById('patientForm');
    
    if (!form.checkValidity()) {
        // Show validation errors
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (!input.checkValidity()) {
                input.style.borderColor = '#ef4444';
            }
        });
        
        // Scroll to first invalid field
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstInvalid.focus();
        }
        
        return false;
    }
    
    return true;
}

// Save patient details
function savePatientDetails() {
    bookingState.patientDetails = {
        name: document.getElementById('patientName').value,
        email: document.getElementById('patientEmail').value,
        phone: document.getElementById('patientPhone').value,
        age: document.getElementById('patientAge').value,
        consultationType: document.getElementById('consultationType').value,
        symptoms: document.getElementById('symptoms').value,
        medicalHistory: document.getElementById('medicalHistory').value
    };
}

// Confirm booking and save to Firebase
async function confirmBooking() {
    try {
        // Generate reference number
        bookingState.referenceNumber = 'IDC' + Date.now().toString().slice(-8);
        
        // Format date
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = bookingState.selectedDate.toLocaleDateString('en-US', options);
        
        // Get consultation type label
        const consultationTypes = {
            general: 'General Consultation',
            followup: 'Follow-up Appointment',
            specialist: 'Specialist Consultation',
            emergency: 'Urgent Care'
        };
        
        // Prepare appointment data for Firebase
        const appointmentData = {
            // Doctor information
            doctorId: bookingState.selectedDoctor.id,
            doctorName: bookingState.selectedDoctor.name,
            doctorSpecialty: bookingState.selectedDoctor.specialty,
            
            // Date & Time
            dateString: formatDateString(bookingState.selectedDate),
            timeSlot: bookingState.selectedTime,
            appointmentDate: Timestamp.fromDate(bookingState.selectedDate),
            
            // Patient Information
            patientName: bookingState.patientDetails.name,
            patientEmail: bookingState.patientDetails.email,
            patientPhone: bookingState.patientDetails.phone,
            patientAge: parseInt(bookingState.patientDetails.age),
            
            // Consultation Details
            consultationType: bookingState.patientDetails.consultationType,
            symptoms: bookingState.patientDetails.symptoms,
            medicalHistory: bookingState.patientDetails.medicalHistory,
            
            // Booking Metadata
            referenceNumber: bookingState.referenceNumber,
            status: 'confirmed',
            createdAt: Timestamp.now(),
            
            // Notifications
            notificationSent: false,
            emailSent: false
        };
        
        console.log('💾 Saving appointment to Firebase:', appointmentData);
        
        // Save to Firebase
        const docRef = await addDoc(collection(db, 'appointments'), appointmentData);
        
        console.log('✅ Appointment saved successfully with ID:', docRef.id);
        
        // Update confirmation details in UI
        document.getElementById('confirmDoctor').textContent = bookingState.selectedDoctor.name;
        document.getElementById('confirmDate').textContent = formattedDate;
        document.getElementById('confirmTime').textContent = bookingState.selectedTime;
        document.getElementById('confirmPatient').textContent = bookingState.patientDetails.name;
        document.getElementById('confirmType').textContent = consultationTypes[bookingState.patientDetails.consultationType];
        document.getElementById('confirmReference').textContent = bookingState.referenceNumber;
        
        // Send confirmation email
        await sendConfirmationEmail(appointmentData);
        
        // Notify doctor
        await notifyDoctor(appointmentData);
        
    } catch (error) {
        console.error('❌ Error saving appointment:', error);
        alert('Failed to save appointment. Please try again. Error: ' + error.message);
    }
}

// Send confirmation email (using EmailJS or your backend)
async function sendConfirmationEmail(appointmentData) {
    console.log('📧 Sending confirmation email to:', appointmentData.patientEmail);
    
    // Option 1: Use EmailJS (free service for sending emails from client-side)
    // You need to sign up at https://www.emailjs.com/
    
    // Uncomment and configure this when you set up EmailJS:
    
    try {
        const emailParams = {
            to_email: appointmentData.patientEmail,
            to_name: appointmentData.patientName,
            doctor_name: appointmentData.doctorName,
            appointment_date: appointmentData.dateString,
            appointment_time: appointmentData.timeSlot,
            reference_number: appointmentData.referenceNumber,
            symptoms: appointmentData.symptoms
        };
        
        await emailjs.send(
            'service_k59h9od',     // Replace with your EmailJS service ID
            'template_2tyqy64',     // Replace with your EmailJS template ID
            emailParams,
            'vrtfXxvgstaBjauZ1'       // Replace with your EmailJS public key
        );
        
        console.log('✅ Confirmation email sent successfully');
        
        // Update Firebase to mark email as sent
        await updateDoc(doc(db, 'appointments', docRef.id), {
            emailSent: true
        });
        
    } catch (error) {
        console.error('❌ Failed to send email:', error);
    }
    
    
    // Option 2: Use your own backend API
    /*
    try {
        await fetch('YOUR_BACKEND_URL/send-confirmation-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(appointmentData)
        });
        console.log('✅ Confirmation email sent');
    } catch (error) {
        console.error('❌ Failed to send email:', error);
    }
    */
    
    // For now, just log
    console.log('📧 Email Details:');
    console.log('   To:', appointmentData.patientEmail);
    console.log('   Subject: Appointment Confirmation -', appointmentData.referenceNumber);
    console.log('   Doctor:', appointmentData.doctorName);
    console.log('   Date:', appointmentData.dateString, 'at', appointmentData.timeSlot);
}

// Notify doctor
async function notifyDoctor(appointmentData) {
    console.log('🔔 Notifying doctor:', appointmentData.doctorName);
    console.log('📅 New consultation scheduled');
    console.log('   Patient:', appointmentData.patientName);
    console.log('   Date:', appointmentData.dateString);
    console.log('   Time:', appointmentData.timeSlot);
    console.log('   Symptoms:', appointmentData.symptoms);
    
    // In production, send notification via:
    // - Email to doctor
    // - SMS to doctor
    // - Push notification to doctor's app
    // - Update doctor's dashboard
}
