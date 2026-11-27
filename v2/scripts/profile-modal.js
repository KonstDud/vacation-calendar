// scripts/profile-modal.js — профиль сотрудника в отдельном широком окне

import { state, stateEvents } from './state.js';
import { loadDictionaries } from './dictionaries.js';
import { PROFILE_FIELDS, PROFILE_SECTIONS, getProfile, getEntitlement, isParentalLeave, toTemplateDate, sanitizeProfile, validateProfile, hasProfileErrors, composeFullName } from './profile.js';
import { createProfileForm } from './profile-form.js';
import { canEditUser, getCurrentUserId, clearSession, isAdmin } from './auth.js';
import { logEvent } from './log.js';

const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let profileForm = null;
let currentUser = null;
let editable = false;

export function initProfileModal() {
    const popup = el('profile-popup');

    el('btn-profile').addEventListener('click', () => openProfileModal(getCurrentUserId()));
    el('profile-popup-close').addEventListener('click', closeProfileModal);
    el('profile-popup-cancel').addEventListener('click', closeProfileModal);
    el('profile-popup-save').addEventListener('click', saveProfile);
    el('profile-popup-delete').addEventListener('click', deleteProfile);
    popup.addEventListener('mousedown', (e) => {
        if (e.target === popup) closeProfileModal();
    });
}

export async function openProfileModal(userId) {
    const popup = el('profile-popup');
    const user = userId ? state.users.find(item => item.id === userId) : null;

    currentUser = user || null;
    editable = !!user && canEditUser(user.id);

    el('profile-popup-save').style.display = editable ? 'inline-flex' : 'none';

    // удалять может админ (любой профиль) или сам сотрудник (свой профиль)
    const isOwnProfile = !!user && user.id === getCurrentUserId();
    const canDelete = !!user && (isAdmin() || (editable && isOwnProfile));
    const deleteButton = el('profile-popup-delete');

    deleteButton.hidden = !canDelete;
    deleteButton.textContent = isOwnProfile ? 'Удалить профиль' : 'Удалить сотрудника';

    el('profile-norm').textContent = '';

    if (!user) {
        el('profile-popup-title').textContent = 'Профиль';
        el('profile-popup-content').innerHTML = `<div class="profile-view__row">${
            userId ? 'Сотрудник не найден' : 'Вы вошли как администратор. Чтобы заполнить профиль, выберите себя при входе.'
        }</div>`;
        popup.classList.add('popup_opened');
        return;
    }

    await loadDictionaries();

    el('profile-popup-title').textContent = isOwnProfile ? 'Мой профиль' : (user.name || 'Профиль сотрудника');
    el('profile-popup-content').replaceChildren(
        editable ? createFormElement(user) : buildReadOnly(getProfile(user))
    );
    updateNormSummary();
    popup.classList.add('popup_opened');

    // Чтобы переименовать было быстро: сразу ставим курсор в «Фамилия»,
    // когда правим чужой профиль или ФИО ещё не заполнено
    if (editable) {
        const current = getProfile(user);
        const incomplete = !current.lastName || !current.firstName;

        if (!isOwnProfile || incomplete) {
            const lastNameInput = el('profile-popup-content').querySelector('.pf-field[data-field="lastName"] input');
            if (lastNameInput) {
                lastNameInput.focus();
                lastNameInput.select();
            }
        }
    }
}

export function closeProfileModal() {
    el('profile-popup').classList.remove('popup_opened');
    if (profileForm) {
        profileForm.destroy();
        profileForm = null;
    }
    currentUser = null;
}

// Форма профиля — общий модуль, тот же, что и при регистрации
function createFormElement(user) {
    profileForm = createProfileForm(getProfile(user), {
        users: state.users,
        currentUserId: user.id,
        onChange: updateNormSummary
    });

    return profileForm.element;
}

// Форма профиля (buildForm/buildField) перенесена в scripts/profile-form.js

// Значения списка (getComboOptions) — в scripts/profile-form.js


function buildReadOnly(profile) {
    const view = document.createElement('div');
    view.className = 'profile-view';

    PROFILE_SECTIONS.forEach(section => {
        const fields = PROFILE_FIELDS.filter(field => field.section === section);
        if (fields.length === 0) return;

        const title = document.createElement('div');
        title.className = 'profile-form__section';
        title.textContent = section;
        view.appendChild(title);

        fields.forEach(field => {
            const raw = profile[field.key];
            const text = field.type === 'date' ? toTemplateDate(raw) : String(raw === undefined || raw === null ? '' : raw);

            const row = document.createElement('div');
            row.className = 'profile-view__row';
            row.innerHTML = `<span class="profile-view__label">${escapeHtml(field.label)}</span>
                <span class="profile-view__value">${text ? escapeHtml(text) : '—'}</span>`;
            view.appendChild(row);
        });
    });

    return view;
}

function collectProfile() {
    return profileForm ? profileForm.collect() : {};
}

function updateNormSummary() {
    const node = el('profile-norm');
    if (!node || !currentUser || !editable) return;

    const profile = collectProfile();

    if (isParentalLeave(profile)) {
        node.innerHTML = '<span class="profile-norm__warn">Отпуск по уходу за ребенком — норму не считаем</span>';
        return;
    }

    node.innerHTML = `Норма в году: ${profile.annualDays} + ${profile.northernDays} + ${profile.irregularDays} = `
        + `<b>${getEntitlement(profile)}</b> календарных дней`;
}

async function saveProfile() {
    if (!currentUser || !editable) return;

    const button = el('profile-popup-save');
    // Чистим и проверяем ДО сохранения: почта и длины полей уедут и в Excel
    const profile = sanitizeProfile(collectProfile());
    const errors = validateProfile(profile);

    if (hasProfileErrors(errors)) {
        if (profileForm && profileForm.showErrors) profileForm.showErrors(errors);
        el('profile-norm').innerHTML = '<span class="profile-norm__warn">Проверьте выделенные поля</span>';
        return;
    }

    button.disabled = true;
    button.textContent = 'Сохранение…';

    try {
        const ref = window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', currentUser.id);

        // Имя сотрудника всегда «Фамилия Имя Отчество» — как в шаблоне Excel
        const fullName = composeFullName(profile) || currentUser.name;
        await window.firestore.setDoc(ref, { profile, name: fullName }, { merge: true });

        currentUser.profile = profile;
        currentUser.name = fullName;
        stateEvents.dispatchEvent(new Event('statechange'));
        closeProfileModal();

        logEvent({
            action: 'user.profile',
            message: `Обновил профиль «${fullName}»`,
            targetId: currentUser.id,
            targetName: fullName,
            details: { position: profile.position, personnelNumber: profile.personnelNumber }
        });
    } catch (error) {
        console.error('[profile] Ошибка сохранения:', error);
    } finally {
        button.disabled = false;
        button.textContent = 'Сохранить';
    }
}

// Удаление профиля: админ — любой, сотрудник — только свой.
// Удаляем и сотрудника (вместе с отпусками), и доступ (пароль).
async function deleteProfile() {
    if (!currentUser) return;

    const isOwnProfile = currentUser.id === getCurrentUserId();
    if (!isAdmin() && !(editable && isOwnProfile)) return;

    const message = isOwnProfile
        ? `Удалить профиль «${currentUser.name}»?\n\nВместе с ним удалятся все отпуска и доступ (пароль). Это действие нельзя отменить.`
        : `Удалить сотрудника «${currentUser.name}»?\n\nВместе с ним удалятся все отпуска и доступ (пароль). Это действие нельзя отменить.`;

    if (!confirm(message)) return;

    const button = el('profile-popup-delete');
    const userId = currentUser.id;

    button.disabled = true;
    button.textContent = 'Удаление…';

    try {
        await window.firestore.deleteDoc(window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', userId));
        await window.firestore.deleteDoc(window.firestore.doc(window.db, 'access', userId));

        if (isOwnProfile) {
            logEvent({
                action: 'user.delete',
                level: 'warn',
                message: `Удалил свой профиль «${currentUser.name}»`,
                targetId: userId,
                targetName: currentUser.name
            });
            closeProfileModal();
            clearSession();
            window.location.href = 'login.html';
            return;
        }

        // админ удалил другого сотрудника — остаёмся в системе, обновляем список
        state.users = state.users.filter(user => user.id !== userId);
        closeProfileModal();
        stateEvents.dispatchEvent(new Event('statechange'));
    } catch (error) {
        console.error('[profile] Ошибка удаления:', error);
        button.disabled = false;
        button.textContent = isOwnProfile ? 'Удалить профиль' : 'Удалить сотрудника';
    }
}
