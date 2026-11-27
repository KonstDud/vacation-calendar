// scripts/admin-panel.js — панель администратора: роли сотрудников и пароли.
// Рисуется в окне профиля у глобального администратора (отдельных кнопок не плодим).
//
// Важно: панель доступна только входу «Администратор» (у него нет своей карточки),
// обычным сотрудникам с ролью admin она не показывается — им роль даёт права
// в календаре, но не доступ к паролям и управлению всеми.

import { state } from './state.js';
import {
    ROLES, ROLE_LABELS, listAccessRecords, saveUserAccess, resetUserPassword,
    setTeamPassword, setAdminPassword, hasAdminPassword
} from './auth.js';
import { showNoticeLong } from './notice.js';

// Роли ограничили двумя: сотрудник и администратор
const ROLE_OPTIONS = [ROLES.USER, ROLES.ADMIN];

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let users = [];
let access = {};
let groupNames = {};
let statusNode = null;

const roleOf = (userId) => {
    const role = (access[userId] || {}).role;
    return ROLE_OPTIONS.includes(role) ? role : ROLES.USER;
};

const hasPassword = (userId) => !!(access[userId] || {}).hash;

function setStatus(text, isError = false) {
    if (!statusNode) return;

    statusNode.textContent = text || '';
    statusNode.classList.toggle('profile-norm__warn', !!isError);
}

async function loadData() {
    const usersSnapshot = await window.firestore.getDocs(
        window.firestore.collection(window.db, 'vacationData_v2', String(state.year), 'users')
    );

    users = [];
    usersSnapshot.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

    const groupsSnapshot = await window.firestore.getDocs(
        window.firestore.collection(window.db, 'vacationData_v2', String(state.year), 'groups')
    );

    groupNames = {};
    groupsSnapshot.forEach(doc => { groupNames[doc.id] = doc.data().name || ''; });

    access = await listAccessRecords();
}

function matchesQuery(user, query) {
    if (!query) return true;

    const profile = user.profile || {};
    const haystack = [
        user.name,
        profile.personnelNumber,
        profile.email,
        groupNames[user.groupId] || ''
    ].join(' ').toLowerCase();

    return haystack.includes(query);
}

function rowHtml(user) {
    const profile = user.profile || {};
    const role = roleOf(user.id);

    const options = ROLE_OPTIONS.map(value =>
        `<option value="${value}"${value === role ? ' selected' : ''}>${ROLE_LABELS[value]}</option>`
    ).join('');

    return `
        <tr>
            <td class="admin-table__name">${escapeHtml(user.name || '—')}</td>
            <td>${escapeHtml(profile.personnelNumber || '—')}</td>
            <td>${escapeHtml(groupNames[user.groupId] || 'Без группы')}</td>
            <td>${escapeHtml(profile.email || '—')}</td>
            <td><select class="year-select admin-table__role" id="role-${escapeHtml(user.id)}">${options}</select></td>
            <td>${hasPassword(user.id) ? 'задан' : 'нет'}</td>
            <td class="admin-table__actions">
                <button type="button" class="btn btn_small" id="reset-${escapeHtml(user.id)}">Сбросить пароль</button>
                <button type="button" class="btn btn_small admin-table__delete" id="delete-${escapeHtml(user.id)}">Удалить</button>
            </td>
        </tr>
    `;
}

function renderUsers() {
    const listNode = document.getElementById('admin-users');
    const searchNode = document.getElementById('admin-search');
    if (!listNode) return;

    const query = (searchNode ? searchNode.value : '').trim().toLowerCase();

    const rows = users
        .filter(user => matchesQuery(user, query))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));

    listNode.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Сотрудник</th>
                    <th>Табельный</th>
                    <th>Группа</th>
                    <th>Почта</th>
                    <th>Роль</th>
                    <th>Пароль</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows.map(rowHtml).join('') || '<tr><td colspan="7">Никого не найдено</td></tr>'}</tbody>
        </table>
    `;

    rows.forEach(user => {
        const roleSelect = document.getElementById(`role-${user.id}`);
        if (roleSelect) roleSelect.addEventListener('change', () => changeRole(user, roleSelect.value));

        const resetButton = document.getElementById(`reset-${user.id}`);
        if (resetButton) resetButton.addEventListener('click', () => resetPassword(user));

        const deleteButton = document.getElementById(`delete-${user.id}`);
        if (deleteButton) deleteButton.addEventListener('click', () => removeUser(user));
    });

    setStatus(`Сотрудников: ${users.length}`
        + (query ? ` · найдено: ${rows.length}` : '')
        + ` · администраторов: ${users.filter(user => roleOf(user.id) === ROLES.ADMIN).length}`);
}

// --- действия ---

// Меняем только роль: пароль не трогаем (saveUserAccess с password = null)
async function refreshAdminPasswordHint() {
    const hint = document.querySelector('.admin-panel__hint');

    try {
        const isSet = await hasAdminPassword();
        if (!hint) return;

        hint.textContent = isSet
            ? 'Отдельный пароль администратора задан — он используется для входа «Войти как администратор».'
            : 'Отдельного пароля администратора пока нет — для входа админом работает пароль команды.';
        hint.classList.toggle('admin-panel__hint_warn', !isSet);
    } catch (error) {
        console.warn('[admin] не удалось проверить пароль администратора:', error);
    }
}

async function saveTeamPassword() {
    const input = document.getElementById('team-password');
    const value = input ? input.value : '';

    if (!value || value.length < 4) {
        setStatus('Пароль команды: не короче 4 символов', true);
        return;
    }

    try {
        await setTeamPassword(value);
        input.value = '';
        setStatus('Пароль команды обновлён');
        showNoticeLong('Пароль команды обновлён');
    } catch (error) {
        console.error('[admin] не удалось сменить пароль команды:', error);
        setStatus(`Не удалось сохранить пароль: ${error.message}`, true);
    }
}

async function saveAdminPassword() {
    const input = document.getElementById('admin-password');
    const value = input ? input.value : '';

    if (!value || value.length < 4) {
        setStatus('Пароль администратора: не короче 4 символов', true);
        return;
    }

    try {
        await setAdminPassword(value);
        input.value = '';
        setStatus('Пароль администратора обновлён');
        showNoticeLong('Пароль администратора обновлён');
        await refreshAdminPasswordHint();
    } catch (error) {
        console.error('[admin] не удалось сменить пароль администратора:', error);
        setStatus(`Не удалось сохранить пароль: ${error.message}`, true);
    }
}
// Меняем только роль: пароль не трогаем (saveUserAccess с password = null)
async function changeRole(user, role) {

    const nextRole = ROLE_OPTIONS.includes(role) ? role : ROLES.USER;
    const select = document.getElementById(`role-${user.id}`);
    if (select) select.disabled = true;

    try {
        await saveUserAccess(user.id, user.name, null, nextRole);
        access[user.id] = { ...(access[user.id] || {}), name: user.name, role: nextRole };
        showNoticeLong(`Роль «${user.name}»: ${ROLE_LABELS[nextRole]}`);
        renderUsers();
    } catch (error) {
        console.error('[admin] не удалось сменить роль:', error);
        setStatus(`Не удалось сменить роль: ${error.message}`, true);
        if (select) select.disabled = false;
    }
}

// Сброс пароля: запись доступа пересоздаётся без хеша —
// сотрудник придумает новый пароль при следующем входе
async function resetPassword(user) {
    if (!confirm(`Сбросить пароль «${user.name}»?\n\nПри следующем входе сотрудник придумает новый пароль.`)) return;

    try {
        const role = roleOf(user.id);
        await resetUserPassword(user.id, user.name, role);
        access[user.id] = { name: user.name, role, updatedAt: Date.now() };
        renderUsers();
        showNoticeLong(`Пароль «${user.name}» сброшен`);
    } catch (error) {
        console.error('[admin] не удалось сбросить пароль:', error);
        setStatus(`Не удалось сбросить пароль: ${error.message}`, true);
    }
}

async function removeUser(user) {
    if (!confirm(`Удалить сотрудника «${user.name}»?\n\nВместе с ним удалятся все отпуска и доступ (пароль).`)) return;

    try {
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', user.id)
        );
        await window.firestore.deleteDoc(window.firestore.doc(window.db, 'access', user.id));

        users = users.filter(item => item.id !== user.id);
        delete access[user.id];
        renderUsers();
        showNoticeLong(`Сотрудник «${user.name}» удалён`);
    } catch (error) {
        console.error('[admin] не удалось удалить сотрудника:', error);
        setStatus(`Не удалось удалить сотрудника: ${error.message}`, true);
    }
}

// --- разметка и вход в панель ---

function buildPanelHtml() {
    return `
        <div class="admin-panel">
            <div class="admin-panel__section">
                <div class="admin-panel__title">Сотрудники и роли</div>
                <div class="admin-panel__search">
                    <input type="text" class="profile-form__input" id="admin-search"
                        placeholder="Поиск: ФИО, табельный, группа, почта" autocomplete="off" />
                </div>
                <div class="admin-panel__table" id="admin-users"></div>
            </div>

            <div class="admin-panel__section">
                <div class="admin-panel__title">Пароли</div>

                <div class="admin-pass">
                    <label class="admin-pass__label" for="team-password">Пароль команды</label>
                    <input type="password" class="profile-form__input" id="team-password"
                        placeholder="Новый пароль команды" autocomplete="new-password" />
                    <button type="button" class="btn btn_add" id="team-password-save">Сохранить</button>
                </div>

                <div class="admin-pass">
                    <label class="admin-pass__label" for="admin-password">Пароль администратора</label>
                    <input type="password" class="profile-form__input" id="admin-password"
                        placeholder="Новый пароль администратора" autocomplete="new-password" />
                    <button type="button" class="btn btn_add" id="admin-password-save">Сохранить</button>
                </div>

                <div class="admin-panel__hint"></div>
            </div>

            <div class="admin-panel__status" id="admin-status"></div>
        </div>
    `;
}

export async function renderAdminPanel(container) {
    container.innerHTML = buildPanelHtml();
    statusNode = document.getElementById('admin-status');

    const searchNode = document.getElementById('admin-search');
    if (searchNode) searchNode.addEventListener('input', renderUsers);

    const teamButton = document.getElementById('team-password-save');
    if (teamButton) teamButton.addEventListener('click', saveTeamPassword);

    const adminButton = document.getElementById('admin-password-save');
    if (adminButton) adminButton.addEventListener('click', saveAdminPassword);

    setStatus('Загружаем сотрудников…');

    try {
        await loadData();
        renderUsers();
        await refreshAdminPasswordHint();
    } catch (error) {
        console.error('[admin] не удалось загрузить данные:', error);
        setStatus(`Не удалось загрузить сотрудников: ${error.message}`, true);
    }
}

