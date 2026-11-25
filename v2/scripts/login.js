// scripts/login.js — вход: общий пароль команды → «кто вы» → свой пароль → роли

import {
    ROLES,
    verifyTeamPassword,
    verifyAdminPassword,
    getAccessRecord,
    saveUserAccess,
    verifyPassword,
    saveSession,
    isAuthenticated
} from './auth.js';
import { setupUserCombobox, escapeHtml } from './user-combobox.js';

const el = (id) => document.getElementById(id);

const LAST_USER_KEY = 'vacationLastUser';

const stepTeam = el('step-team');
const stepUser = el('step-user');
const stepAdmin = el('step-admin');

let people = [];
let groups = [];
let combo = null;
let currentYear = null;
let selectedUser = null;
let selectedAccess = null;
let isFirstLogin = false;

function getLastUser() {
    try {
        const raw = localStorage.getItem(LAST_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function rememberLastUser(userId, name) {
    if (!userId) return;
    try {
        localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: userId, name }));
    } catch (error) {
        console.warn('[login] Не удалось запомнить пользователя', error);
    }
}

// Показываем «Продолжить как Иван» вместо поиска себя в списке
function showLastUser() {
    const last = getLastUser();
    const found = last ? people.find(user => user.id === last.id) : null;

    if (!found) {
        el('login-last').hidden = true;
        el('login-who').hidden = false;
        return;
    }

    el('login-last-name').textContent = found.name;
    el('login-last').hidden = false;
    el('login-who').hidden = true;
}

function showStep(step) {
    [stepTeam, stepUser, stepAdmin].forEach(node => { node.hidden = node !== step; });
}

function showError(node, message) {
    node.textContent = message || '';
    node.hidden = !message;
}

function resolveYear() {
    const params = new URLSearchParams(window.location.search);
    const urlYear = Number(params.get('year'));
    if (Number.isInteger(urlYear) && urlYear >= 2000 && urlYear <= 2100) return urlYear;

    const stored = Number(localStorage.getItem('vacationYear'));
    if (Number.isInteger(stored) && stored >= 2000 && stored <= 2100) return stored;

    return new Date().getFullYear();
}

async function loadPeople(year) {
    const { collection, getDocs } = window.firestore;

    const usersSnap = await getDocs(collection(window.db, 'vacationData_v2', String(year), 'users'));
    people = [];
    usersSnap.forEach(doc => people.push({ id: doc.id, ...doc.data() }));
    people.sort((a, b) => (a.order || 0) - (b.order || 0));

    const groupsSnap = await getDocs(collection(window.db, 'vacationData_v2', String(year), 'groups'));
    groups = [];
    groupsSnap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));
}

function finishLogin(userId, name, role) {
    rememberLastUser(userId, name);
    saveSession({ userId, name, role });
    window.location.href = 'index.html';
}

// --- шаг 2: выбор сотрудника ---

async function onUserSelected(user) {
    const block = el('login-password-block');
    const password = el('login-password');
    const password2 = el('login-password2');

    selectedUser = user;
    selectedAccess = null;
    isFirstLogin = false;
    password.value = '';
    password2.value = '';
    showError(el('user-error'), '');

    if (!user) {
        block.hidden = true;
        return;
    }

    selectedAccess = await getAccessRecord(user.id);
    isFirstLogin = !(selectedAccess && selectedAccess.hash);

    block.hidden = false;

    if (isFirstLogin) {
        el('login-password-hint').textContent = 'Первый вход: придумайте себе пароль (минимум 4 символа)';
        password.placeholder = 'Придумайте пароль';
        password2.hidden = false;
    } else {
        el('login-password-hint').textContent = 'Введите свой пароль';
        password.placeholder = 'Пароль';
        password2.hidden = true;
    }

    password.focus();
}

// --- шаг 1: общий пароль ---

el('team-submit').addEventListener('click', async () => {
    const button = el('team-submit');
    const errorNode = el('team-error');
    const password = el('team-password').value;

    showError(errorNode, '');
    if (!password) {
        showError(errorNode, 'Введите пароль команды');
        return;
    }

    button.disabled = true;
    try {
        await window.firebaseReady;
        const isValid = await verifyTeamPassword(password);

        if (!isValid) {
            showError(errorNode, 'Неверный пароль');
            return;
        }

        const year = resolveYear();
        currentYear = year;
        await loadPeople(year);

        combo = setupUserCombobox(el('login-card'), {
            getUsers: () => people,
            getGroups: () => groups,
            onSelect: onUserSelected
        });

        showStep(stepUser);
        showLastUser();
        el('login-user-input').focus();
    } catch (error) {
        console.error('[login] Ошибка проверки пароля:', error);
        showError(errorNode, 'Не удалось проверить пароль, попробуйте ещё раз');
    } finally {
        button.disabled = false;
    }
});

el('team-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('team-submit').click();
});

// --- шаг 2: вход сотрудника ---

el('user-submit').addEventListener('click', async () => {
    const button = el('user-submit');
    const errorNode = el('user-error');
    const password = el('login-password').value;

    showError(errorNode, '');

    const userId = combo ? combo.getSelectedId() : '';
    if (!userId || !selectedUser) {
        showError(errorNode, 'Выберите себя в списке');
        return;
    }

    if (!password) {
        showError(errorNode, isFirstLogin ? 'Придумайте пароль' : 'Введите пароль');
        return;
    }

    button.disabled = true;
    try {
        // роль сохраняем, если она уже была назначена (например, админом)
        const role = (selectedAccess && selectedAccess.role) || ROLES.USER;

        if (isFirstLogin) {
            if (password.length < 4) {
                showError(errorNode, 'Пароль должен быть не короче 4 символов');
                return;
            }
            if (password !== el('login-password2').value) {
                showError(errorNode, 'Пароли не совпадают');
                return;
            }

            await saveUserAccess(selectedUser.id, selectedUser.name, password, role);
            finishLogin(selectedUser.id, selectedUser.name, role);
            return;
        }

        const isValid = await verifyPassword(password, selectedAccess);
        if (!isValid) {
            showError(errorNode, 'Неверный пароль');
            return;
        }

        finishLogin(selectedUser.id, selectedUser.name, role);
    } catch (error) {
        console.error('[login] Ошибка входа сотрудника:', error);
        showError(errorNode, 'Не удалось войти, попробуйте ещё раз');
    } finally {
        button.disabled = false;
    }
});

['login-password', 'login-password2'].forEach(id => {
    el(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el('user-submit').click();
    });
});

// --- шаг 3: администратор ---

el('to-admin').addEventListener('click', () => {
    showError(el('user-error'), '');
    showStep(stepAdmin);
    el('admin-password').focus();
});

el('back-to-user').addEventListener('click', () => {
    showError(el('admin-error'), '');
    showStep(stepUser);
});

el('admin-submit').addEventListener('click', async () => {
    const button = el('admin-submit');
    const errorNode = el('admin-error');
    const password = el('admin-password').value;

    showError(errorNode, '');
    if (!password) {
        showError(errorNode, 'Введите пароль администратора');
        return;
    }

    button.disabled = true;
    try {
        const isValid = await verifyAdminPassword(password);
        if (!isValid) {
            showError(errorNode, 'Неверный пароль');
            return;
        }
        finishLogin('', 'Администратор', ROLES.ADMIN);
    } catch (error) {
        console.error('[login] Ошибка входа администратора:', error);
        showError(errorNode, 'Не удалось войти, попробуйте ещё раз');
    } finally {
        button.disabled = false;
    }
});

el('admin-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('admin-submit').click();
});

// --- старт: вернуться к последнему сотруднику или выбрать себя заново ---

el('login-last-btn').addEventListener('click', () => {
    const last = getLastUser();
    const found = last ? people.find(user => user.id === last.id) : null;
    if (!found || !combo) return;

    el('login-last').hidden = true;
    el('login-who').hidden = false;
    combo.select(found);
});

el('login-other').addEventListener('click', () => {
    el('login-last').hidden = true;
    el('login-who').hidden = false;
    if (combo) combo.clear();
    el('login-user-input').focus();
});

// --- меня нет в списке: создаём себя ---

el('reg-start').addEventListener('click', () => {
    showError(el('reg-error'), '');
    el('reg-name').value = '';
    el('reg-password').value = '';
    el('reg-password2').value = '';

    // можно сразу выбрать свою группу (кроме «Без группы» — это пустое значение)
    const groupSelect = el('reg-group');
    groupSelect.innerHTML = '<option value="">Без группы</option>'
        + groups
            .filter(group => group.id !== 'ungrouped')
            .map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
            .join('');

    el('login-who').hidden = true;
    el('reg-block').hidden = false;
    el('reg-name').focus();
});

el('reg-cancel').addEventListener('click', () => {
    el('reg-block').hidden = true;
    el('login-who').hidden = false;
});

el('reg-submit').addEventListener('click', async () => {
    const button = el('reg-submit');
    const errorNode = el('reg-error');
    const name = el('reg-name').value.trim();
    const password = el('reg-password').value;

    showError(errorNode, '');

    if (name.length < 2) {
        showError(errorNode, 'Укажите фамилию и имя');
        return;
    }
    if (password.length < 4) {
        showError(errorNode, 'Пароль должен быть не короче 4 символов');
        return;
    }
    if (password !== el('reg-password2').value) {
        showError(errorNode, 'Пароли не совпадают');
        return;
    }

    const normalized = name.toLowerCase();
    if (people.some(user => String(user.name).trim().toLowerCase() === normalized)) {
        showError(errorNode, 'Такое имя уже есть в списке — выберите себя в списке');
        return;
    }

    button.disabled = true;
    try {
        const { collection, doc, setDoc } = window.firestore;
        const usersRef = collection(window.db, 'vacationData_v2', String(currentYear), 'users');
        const newRef = doc(usersRef);

        await setDoc(newRef, {
            name,
            color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            vacations: [],
            order: Date.now(),
            isHidden: false,
            groupId: el('reg-group').value || ''
        });

        await saveUserAccess(newRef.id, name, password, ROLES.USER);
        finishLogin(newRef.id, name, ROLES.USER);
    } catch (error) {
        console.error('[login] Ошибка регистрации:', error);
        showError(errorNode, 'Не удалось создать профиль, попробуйте ещё раз');
    } finally {
        button.disabled = false;
    }
});

['reg-name', 'reg-password', 'reg-password2'].forEach(id => {
    el(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el('reg-submit').click();
    });
});

// --- старт ---

if (isAuthenticated()) {
    window.location.replace('index.html');
} else {
    el('team-password').focus();
}
