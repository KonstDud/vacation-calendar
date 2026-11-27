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
import { createProfileForm } from './profile-form.js';
import { loadDictionaries } from './dictionaries.js';
import { getProfile, getEntitlement, isParentalLeave, sanitizeProfile, validateProfile, hasProfileErrors, composeShortName } from './profile.js';
import { collectPeopleFromNearbyYears } from './state.js';
import { logEvent } from './log.js';

const el = (id) => document.getElementById(id);

// Сравниваем ФИО без учёта порядка слов: «Петров Иван» и «Иван Петров» — один человек
const normalizeName = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

const LAST_USER_KEY = 'vacationLastUser';

const stepTeam = el('step-team');
const stepUser = el('step-user');
const stepAdmin = el('step-admin');
const stepProfile = el('step-profile');

let people = [];
let groups = [];
let combo = null;
let currentYear = null;
let selectedUser = null;
let selectedAccess = null;
let isFirstLogin = false;
let regProfileForm = null;
let pendingUser = null;

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

    // В кнопке — короткое «Фамилия Имя», полное ФИО в подсказке
    el('login-last-name').textContent = composeShortName(getProfile(found), found.name);
    el('login-last-btn').title = found.name;
    el('login-last').hidden = false;
    el('login-who').hidden = true;
}

function showStep(step) {
    [stepTeam, stepUser, stepAdmin, stepProfile].forEach(node => { node.hidden = node !== step; });
    document.querySelector('.login').classList.toggle('login_wide', step === stepProfile);
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

async function loadGroups(year) {
    const { collection, getDocs } = window.firestore;

    const groupsSnap = await getDocs(collection(window.db, 'vacationData_v2', String(year), 'groups'));
    groups = [];
    groupsSnap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));
}

function finishLogin(userId, name, role, year) {
    rememberLastUser(userId, name);
    // запоминаем год записи, чтобы приложение открыло тот же год
    if (year) localStorage.setItem('vacationYear', String(year));
    saveSession({ userId, name, role });

    logEvent({
        action: 'auth.login',
        message: `Вход: ${name} (${role === ROLES.ADMIN ? 'администратор' : 'сотрудник'})`,
        targetId: userId,
        targetName: name,
        year
    });

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
            logEvent({
                action: 'auth.login_failed',
                level: 'warn',
                message: 'Неверный пароль команды'
            });
            return;
        }

        // люди из соседних лет: главный год — где основная команда,
        // остальные записи тоже показываем, чтобы видели себя все
        const collected = await collectPeopleFromNearbyYears(resolveYear());
        people = collected.people;
        currentYear = collected.mainYear;
        localStorage.setItem('vacationYear', String(currentYear));
        await loadGroups(currentYear);

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
            logEvent({
                action: 'auth.login_failed',
                level: 'warn',
                message: `Неверный пароль: ${selectedUser.name}`,
                targetId: selectedUser.id,
                targetName: selectedUser.name
            });
            return;
        }

        finishLogin(selectedUser.id, selectedUser.name, role, selectedUser.year || currentYear);
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
            logEvent({
                action: 'auth.login_failed',
                level: 'warn',
                message: 'Неверный пароль администратора'
            });
            return;
        }
        finishLogin('', 'Администратор', ROLES.ADMIN, currentYear);
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
    ['reg-last', 'reg-first', 'reg-middle', 'reg-password', 'reg-password2'].forEach(id => { el(id).value = ''; });

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
    const lastName = el('reg-last').value.trim();
    const firstName = el('reg-first').value.trim();
    const middleName = el('reg-middle').value.trim();
    const name = [lastName, firstName, middleName].filter(Boolean).join(' ');
    const password = el('reg-password').value;

    showError(errorNode, '');

    // имя и фамилия обязательны, только буквы и дефис — чтобы не заводили «всякую фигню»
    const namePattern = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z-]*$/;

    if (!lastName || !firstName) {
        showError(errorNode, 'Укажите фамилию и имя — оба поля обязательны');
        (lastName ? el('reg-first') : el('reg-last')).focus();
        return;
    }
    if (!namePattern.test(lastName) || !namePattern.test(firstName)) {
        showError(errorNode, 'Фамилия и имя — только буквы (можно дефис), без цифр и лишних пробелов');
        return;
    }
    if (middleName && !namePattern.test(middleName)) {
        showError(errorNode, 'Отчество — только буквы (можно дефис)');
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

    const duplicate = people.find(user => normalizeName(user.name) === normalizeName(name));
    if (duplicate) {
        showError(errorNode, `Сотрудник «${name}» уже есть в графике. Вернитесь назад и выберите себя в списке — или добавьте отчество, если это разные люди.`);
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
        await showProfileStep(newRef.id, name);
    } catch (error) {
        console.error('[login] Ошибка регистрации:', error);
        showError(errorNode, 'Не удалось создать профиль, попробуйте ещё раз');
    } finally {
        button.disabled = false;
    }
});

['reg-last', 'reg-first', 'reg-middle', 'reg-password', 'reg-password2'].forEach(id => {
    el(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el('reg-submit').click();
    });
});

// --- шаг профиля после регистрации ---

async function showProfileStep(userId, userName) {
    pendingUser = { id: userId, name: userName };

    await loadDictionaries();

    regProfileForm = createProfileForm(getProfile({}), {
        users: people,
        currentUserId: userId,
        onChange: updateRegNorm
    });

    el('reg-profile-form').replaceChildren(regProfileForm.element);
    showError(el('reg-profile-error'), '');
    updateRegNorm();
    showStep(stepProfile);
}

function updateRegNorm() {
    const node = el('reg-profile-norm');
    if (!node || !regProfileForm) return;

    const profile = regProfileForm.collect();

    node.innerHTML = isParentalLeave(profile)
        ? '<span class="profile-norm__warn">Отпуск по уходу за ребенком — норму не считаем</span>'
        : `Норма в году: ${profile.annualDays} + ${profile.northernDays} + ${profile.irregularDays} = <b>${getEntitlement(profile)}</b> календарных дней`;
}

el('reg-profile-save').addEventListener('click', async () => {
    if (!pendingUser || !regProfileForm) return;

    const button = el('reg-profile-save');
    const errorNode = el('reg-profile-error');
    showError(errorNode, '');

    // Чистим и проверяем до входа: почта и длины полей уедут ещё и в Excel
    const profile = sanitizeProfile(regProfileForm.collect());
    const errors = validateProfile(profile);

    if (hasProfileErrors(errors)) {
        if (regProfileForm.showErrors) regProfileForm.showErrors(errors);
        showError(errorNode, 'Проверьте выделенные поля');
        return;
    }

    button.disabled = true;
    button.textContent = 'Сохранение…';

    try {
        const ref = window.firestore.doc(window.db, 'vacationData_v2', String(currentYear), 'users', pendingUser.id);
        await window.firestore.setDoc(ref, { profile }, { merge: true });

        finishLogin(pendingUser.id, pendingUser.name, ROLES.USER, currentYear);
    } catch (error) {
        console.error('[login] Ошибка сохранения профиля:', error);
        showError(errorNode, 'Не удалось сохранить профиль — можно заполнить позже');
        button.disabled = false;
        button.textContent = 'Сохранить и войти';
    }
});

el('reg-profile-skip').addEventListener('click', () => {
    if (!pendingUser) return;
    finishLogin(pendingUser.id, pendingUser.name, ROLES.USER, currentYear);
});

// --- старт ---

if (isAuthenticated()) {
    window.location.replace('index.html');
} else {
    el('team-password').focus();
}
