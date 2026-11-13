function toggleAuthView(view) {
    document.getElementById('registerFormView').style.display = 'none';
    document.getElementById('loginFormView').style.display = 'none';
    document.getElementById('forgotFormView').style.display = 'none';

    if (view === 'login') document.getElementById('loginFormView').style.display = 'block';
    else if (view === 'register') document.getElementById('registerFormView').style.display = 'block';
    else if (view === 'forgot') {
        document.getElementById('forgotFormView').style.display = 'block';
        preparePasswordResetForm();
    }
}

async function handleRegister() {
    const name = document.getElementById('regName').value.trim();
    const regNo = document.getElementById('regRegNo').value.trim();
    const email = normalizeEmail(document.getElementById('regEmail').value);
    const pass = document.getElementById('regPass').value;

    if (!name || !regNo || !email || !pass) return;

    console.log('Registering user:', { name, regNo, email });
    try {
        const { user } = await apiRequest('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                name,
                regNo,
                email,
                password: pass
            })
        });
        await loginUser(user);
    } catch (error) {
        reportApiError(error);
    }
}

async function handleLogin() {
    const identifier = normalizeEmail(document.getElementById('loginIdentifier').value);
    const pass = document.getElementById('loginPass').value;
    try {
        const { user } = await apiRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier, password: pass })
        });
        await loginUser(user);
    } catch (error) {
        reportApiError(error);
    }
}

function handleResetPassword() {
    toggleAuthView('forgot');
}

async function loginUser(user) {
    currentUser = user;
    sessionExpiryNotified = false;
    document.getElementById('userNameDisplay').textContent = user.name;
    document.getElementById('printHeaderUserName').textContent = user.name;
    document.getElementById('authOverlay').style.display = 'none';

    try {
        await loadUserData();
        await loadAuditorComments();
        await loadSharedSubmissions();
        await loadAccountManagementState();
        await loadPersonalDashboard();
        updateUniversitySummary();
        updateSubmissionStatus();
        renderProfiles();
    } catch (error) {
        currentUser = null;
        document.getElementById('authOverlay').style.display = 'flex';
        throw error;
    }
}

async function handleLogout() {
    try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Unable to revoke the EnerTrack session on the server.', error);
    }
    currentUser = null;
    audits = [];
    inventory = [];
    sharedSubmissions = [];
    equipmentDetails = { actual: [], recommended: [] };
    renderEquipmentDetails();
    renderInventoryTable();
    updateKPIs(0, 0, 0, 0, 0, 0);
    updateCharts();
    updateUniversitySummary();
    document.getElementById('userNameDisplay').textContent = 'Auditor';
    document.getElementById('printHeaderUserName').textContent = 'Auditor';
    document.getElementById('authOverlay').style.display = 'flex';
}

async function checkSession() {
    if (new URLSearchParams(window.location.search).has('resetToken')) {
        document.getElementById('authOverlay').style.display = 'flex';
        toggleAuthView('forgot');
        return;
    }
    try {
        const { user } = await apiRequest('/api/auth/me');
        if (user) await loginUser(user);
        else document.getElementById('authOverlay').style.display = 'flex';
    } catch (error) {
        document.getElementById('authOverlay').style.display = 'flex';
        reportApiError(error);
    }
}

function preparePasswordResetForm() {
    const hasToken = new URLSearchParams(window.location.search).has('resetToken');
    document.getElementById('requestPasswordResetForm').style.display = hasToken ? 'none' : 'block';
    document.getElementById('completePasswordResetForm').style.display = hasToken ? 'block' : 'none';
    document.getElementById('resetPasswordGroup').style.display = hasToken ? 'flex' : 'none';
}

async function requestPasswordReset() {
    try {
        const { message } = await apiRequest('/api/auth/password-reset/request', {
            method: 'POST',
            body: JSON.stringify({ email: normalizeEmail(document.getElementById('resetEmail').value) })
        });
        alert(message);
    } catch (error) {
        reportApiError(error);
    }
}

async function completePasswordReset() {
    const token = new URLSearchParams(window.location.search).get('resetToken');
    const password = document.getElementById('resetPassword').value;
    try {
        const { message } = await apiRequest('/api/auth/password-reset/complete', {
            method: 'POST',
            body: JSON.stringify({ token, password })
        });
        window.history.replaceState({}, document.title, window.location.pathname);
        toggleAuthView('login');
        alert(message);
    } catch (error) {
        reportApiError(error);
    }
}

function switchPage(page) {
    if (currentUser && currentUser.role === 'admin' && ['facilities', 'measures'].includes(page)) return;
    document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const pageToTab = {
        dashboard: ['pageDashboard', 'tabDashboard'],
        facilities: ['pageFacilities', 'tabFacilities'],
        university: ['pageUniversity', 'tabUniversity'],
        audit: ['pageAudit', 'tabAudit'],
        measures: ['pageMeasures', 'tabMeasures'],
        profiles: ['pageProfiles', 'tabProfiles']
    };
    const target = pageToTab[page];
    if (!target) return;
    document.getElementById(target[0]).classList.add('active');
    document.getElementById(target[1]).classList.add('active');
    if (page === 'audit') updateCharts();
    if (page === 'university') updateUniversitySummary();
    if (page === 'measures') renderEquipmentDetails();
    if (page === 'profiles') renderProfiles();
}
