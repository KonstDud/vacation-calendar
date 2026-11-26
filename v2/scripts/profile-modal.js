// scripts/profile-modal.js — профиль сотрудника в отдельном широком окне

import { state, stateEvents } from './state.js';
import { createCombo } from './combo.js';
import { addDictionaryValue, getDictionary, loadDictionaries } from './dictionaries.js';
import { PROFILE_FIELDS, PROFILE_SECTIONS, getProfile, getEntitlement, isParentalLeave, toTemplateDate } from './profile.js';
import { canEditUser, getCurrentUserId } from './auth.js';
import { attachOverflowTip } from './tooltip.js';

const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let controls = [];
let currentUser = null;
let editable = false;

export function initProfileModal() {
    const popup = el('profile-popup');

    el('btn-profile').addEventListener('click', () => openProfileModal(getCurrentUserId()));
    el('profile-popup-close').addEventListener('click', closeProfileModal);
    el('profile-popup-cancel').addEventListener('click', closeProfileModal);
    el('profile-popup-save').addEventListener('click', saveProfile);
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

    el('profile-popup-title').textContent = editable ? 'Мой профиль' : user.name;
    el('profile-popup-content').replaceChildren(buildForm(user, editable));
    updateNormSummary();
    popup.classList.add('popup_opened');
}

export function closeProfileModal() {
    el('profile-popup').classList.remove('popup_opened');
    controls.forEach(control => control.destroy && control.destroy());
    controls = [];
    currentUser = null;
}

function buildForm(user, isEditable) {
    const profile = getProfile(user);

    if (!isEditable) return buildReadOnly(profile);

    const form = document.createElement('div');
    form.className = 'profile-form';

    PROFILE_SECTIONS.forEach(section => {
        const fields = PROFILE_FIELDS.filter(field => field.section === section);
        if (fields.length === 0) return;

        const title = document.createElement('div');
        title.className = 'profile-form__section';
        title.textContent = section;
        form.appendChild(title);

        // Нормы отпуска — компактный ряд, не растягиваем на всю ширину
        const numbers = fields.filter(field => field.type === 'number');
        if (numbers.length > 0) {
            const row = document.createElement('div');
            row.className = 'pf-row';
            numbers.forEach(field => row.appendChild(buildField(field, profile[field.key], user)));
            form.appendChild(row);
        }

        fields
            .filter(field => field.type !== 'number')
            .forEach(field => form.appendChild(buildField(field, profile[field.key], user)));
    });

    return form;
}

function buildField(field, value, user) {
    const wrapper = document.createElement('div');
    wrapper.className = `pf-field${field.wide || field.type === 'textarea' ? ' pf-field_wide' : ''}`;

    // Нормы отпуска — компактные поля с подписью внутри
    if (field.type === 'number') {
        const group = document.createElement('label');
        group.className = 'pf-num';
        group.innerHTML = `<span class="pf-num__label">${escapeHtml(field.short || field.label)}</span>
            <input class="pf-num__input" type="number" min="${field.min || 0}" max="${field.max || 365}" value="${escapeHtml(String(value === undefined || value === null ? '' : value))}">`;

        const input = group.querySelector('input');
        const labelNode = group.querySelector('.pf-num__label');
        input.addEventListener('input', updateNormSummary);

        // если подпись не влезла — показываем её полностью в тёмной подсказке
        attachOverflowTip(
            wrapper,
            () => `${field.label}: ${input.value}`,
            () => labelNode.scrollWidth > labelNode.clientWidth + 1
        );

        wrapper.appendChild(group);
        controls.push({ field, getValue: () => Math.max(0, Math.round(Number(input.value) || 0)) });
        return wrapper;
    }

    // Имя поля: лежит внутри, поднимается наверх при фокусе или заполнении
    const label = document.createElement('span');
    label.className = 'pf-field__label';
    label.textContent = field.label;

    if (field.type === 'date') wrapper.classList.add('pf-field_date');

    // Поля-справочники и «Замещающий» — тёмный выпадающий список с поиском
    if (field.dict || field.key === 'substitute') {
        const combo = createCombo({
            options: getComboOptions(field, user),
            value: String(value || ''),
            placeholder: field.placeholder || ' ',
            allowCustom: field.key !== 'substitute',
            onAddCustom: field.dict ? (typed) => addDictionaryValue(field.dict, typed) : null,
            onChange: updateNormSummary
        });

        wrapper.appendChild(combo.element);
        wrapper.appendChild(label);

        const comboInput = combo.element.querySelector('.combo__input');
        attachOverflowTip(
            wrapper,
            () => combo.getValue(),
            () => comboInput.scrollWidth > comboInput.clientWidth + 1
        );

        controls.push({ field, getValue: combo.getValue, destroy: combo.destroy });
        return wrapper;
    }

    if (field.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.className = 'profile-form__input';
        textarea.rows = 2;
        textarea.placeholder = field.placeholder || ' ';
        textarea.value = String(value || '');
        textarea.addEventListener('input', updateNormSummary);
        wrapper.appendChild(textarea);
        wrapper.appendChild(label);
        controls.push({ field, getValue: () => textarea.value });
        return wrapper;
    }

    const input = document.createElement('input');
    input.className = 'profile-form__input';
    input.type = field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text';
    input.placeholder = field.placeholder || ' ';
    input.value = value === undefined || value === null ? '' : String(value);
    input.addEventListener('input', updateNormSummary);

    wrapper.appendChild(input);
    wrapper.appendChild(label);

    // обрезанное значение читаем в тёмной подсказке
    attachOverflowTip(
        wrapper,
        () => input.value,
        () => field.type !== 'date' && input.scrollWidth > input.clientWidth + 1
    );

    controls.push({ field, getValue: () => input.value });

    return wrapper;
}

// Значения списка: справочник + то, что уже введено у коллег
function getComboOptions(field, user) {
    if (field.key === 'substitute') {
        return state.users
            .filter(item => item.id !== user.id)
            .map(item => item.name)
            .sort((a, b) => a.localeCompare(b, 'ru'));
    }

    const values = new Set(getDictionary(field.dict));
    state.users.forEach(item => {
        const value = getProfile(item)[field.key];
        if (value) values.add(value);
    });

    return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
}

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
    const profile = {};

    controls.forEach(({ field, getValue }) => {
        profile[field.key] = getValue();
    });

    return profile;
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
    const profile = collectProfile();

    button.disabled = true;
    button.textContent = 'Сохранение…';

    try {
        const ref = window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', currentUser.id);
        await window.firestore.setDoc(ref, { profile }, { merge: true });

        currentUser.profile = profile;
        stateEvents.dispatchEvent(new Event('statechange'));
        closeProfileModal();
    } catch (error) {
        console.error('[profile] Ошибка сохранения:', error);
    } finally {
        button.disabled = false;
        button.textContent = 'Сохранить';
    }
}
