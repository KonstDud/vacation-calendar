// scripts/profile-form.js — форма профиля: одна и та же при регистрации и в окне профиля

import { createCombo } from './combo.js';
import { addDictionaryValue, getDictionary } from './dictionaries.js';
import { PROFILE_FIELDS, PROFILE_SECTIONS, getProfile } from './profile.js';
import { attachOverflowTip } from './tooltip.js';

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Собирает форму профиля.
 * @param {object} profile — значения полей
 * @param {object} options
 * @param {Array} [options.users] — сотрудники (для «Замещающий» и подсказок)
 * @param {string} [options.currentUserId] — кого исключить из списка замещающих
 * @param {Function} [options.onChange] — вызывается при любом изменении (пересчёт нормы)
 * @returns {{ element: HTMLElement, collect: Function, destroy: Function }}
 */
export function createProfileForm(profile, { users = [], currentUserId = '', onChange } = {}) {
    const controls = [];
    const element = document.createElement('div');
    element.className = 'profile-form';

    const context = { users, currentUserId, onChange, controls };

    PROFILE_SECTIONS.forEach(section => {
        const fields = PROFILE_FIELDS.filter(field => field.section === section);
        if (fields.length === 0) return;

        const title = document.createElement('div');
        title.className = 'profile-form__section';
        title.textContent = section;
        element.appendChild(title);

        // Нормы отпуска — компактный ряд, не растягиваем на всю ширину
        const numbers = fields.filter(field => field.type === 'number');
        if (numbers.length > 0) {
            const row = document.createElement('div');
            row.className = 'pf-row';
            numbers.forEach(field => row.appendChild(buildField(field, profile[field.key], context)));
            element.appendChild(row);
        }

        fields
            .filter(field => field.type !== 'number')
            .forEach(field => element.appendChild(buildField(field, profile[field.key], context)));
    });

    // Снимаем пометку об ошибке, как только пользователь начал править поле
    element.addEventListener('input', (event) => {
        const fieldNode = event.target.closest && event.target.closest('.pf-field');
        if (!fieldNode) return;
        fieldNode.classList.remove('pf-field_invalid');
        const errorNode = fieldNode.querySelector('.pf-field__error');
        if (errorNode) errorNode.textContent = '';
    });

    const showErrors = (errors) => {
        element.querySelectorAll('.pf-field').forEach(fieldNode => {
            const message = (errors || {})[fieldNode.dataset.field];
            fieldNode.classList.toggle('pf-field_invalid', !!message);
            const errorNode = fieldNode.querySelector('.pf-field__error');
            if (errorNode) errorNode.textContent = message || '';
        });

        const firstInvalid = element.querySelector('.pf-field_invalid');
        if (firstInvalid && firstInvalid.scrollIntoView) {
            firstInvalid.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    };

    return {
        element,
        collect: () => {
            const result = {};
            controls.forEach(({ field, getValue }) => {
                result[field.key] = getValue();
            });
            return result;
        },
        showErrors,
        destroy: () => controls.forEach(control => control.destroy && control.destroy())
    };
}

// Обёртка: помечает поле его ключом (для показа ошибок) и добавляет строку ошибки
function buildField(field, value, context) {
    const wrapper = buildFieldContent(field, value, context);
    wrapper.dataset.field = field.key;

    const errorNode = document.createElement('div');
    errorNode.className = 'pf-field__error';
    wrapper.appendChild(errorNode);

    return wrapper;
}

function buildFieldContent(field, value, context) {
    const { users, currentUserId, onChange, controls } = context;
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
        input.addEventListener('input', () => onChange && onChange());

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
    label.textContent = field.required ? `${field.label} *` : field.label;

    if (field.type === 'date') wrapper.classList.add('pf-field_date');

    // Поля-справочники и «Замещающий» — тёмный выпадающий список с поиском
    if (field.dict || field.key === 'substitute') {
        const combo = createCombo({
            options: getComboOptions(field, users, currentUserId),
            value: String(value || ''),
            placeholder: field.placeholder || ' ',
            allowCustom: field.key !== 'substitute',
            onAddCustom: field.dict ? (typed) => addDictionaryValue(field.dict, typed) : null,
            onChange: () => onChange && onChange()
        });

        wrapper.appendChild(combo.element);
        wrapper.appendChild(label);

        const comboInput = combo.element.querySelector('.combo__input');
        if (field.maxLength && comboInput) comboInput.maxLength = field.maxLength;

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
        if (field.maxLength) textarea.maxLength = field.maxLength;
        textarea.placeholder = field.placeholder || ' ';
        textarea.value = String(value || '');
        textarea.addEventListener('input', () => onChange && onChange());
        wrapper.appendChild(textarea);
        wrapper.appendChild(label);
        controls.push({ field, getValue: () => textarea.value });
        return wrapper;
    }

    const input = document.createElement('input');
    input.className = 'profile-form__input';
    input.type = field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text';
    if (field.maxLength) input.maxLength = field.maxLength;
    input.placeholder = field.placeholder || ' ';
    input.value = value === undefined || value === null ? '' : String(value);
    input.addEventListener('input', () => onChange && onChange());

    wrapper.appendChild(input);
    wrapper.appendChild(label);

    attachOverflowTip(
        wrapper,
        () => input.value,
        () => field.type !== 'date' && input.scrollWidth > input.clientWidth + 1
    );

    controls.push({ field, getValue: () => input.value });

    return wrapper;
}

// Значения списка: справочник + то, что уже введено у коллег
function getComboOptions(field, users, currentUserId) {
    if (field.key === 'substitute') {
        return users
            .filter(item => item.id !== currentUserId)
            .map(item => item.name)
            .sort((a, b) => a.localeCompare(b, 'ru'));
    }

    const values = new Set(getDictionary(field.dict));
    users.forEach(item => {
        const value = getProfile(item)[field.key];
        if (value) values.add(value);
    });

    return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
}
