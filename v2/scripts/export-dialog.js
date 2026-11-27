// scripts/export-dialog.js — окно выгрузки в Excel:
// кого выгружать (все / группа / выбранные), месяцы, пропуск пустых.

import { state } from './state.js';
import { exportToExcel, buildExportRows, countSkippedVacations } from './excel.js';
import { MONTH_NAMES, getViewMonth, vacationTouchesMonth } from './view-month.js';
import { showNoticeLong } from './notice.js';

const el = (id) => document.getElementById(id);

const CHOICE_KEY = 'vacationExportChoice';

let pickedIds = new Set();
let searchQuery = '';

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function activeVacations(user) {
    return (user.vacations || []).filter(vac => vac.startDate && vac.endDate && vac.endDate >= vac.startDate);
}

function getScope() {
    const checked = document.querySelector('input[name="export-scope"]:checked');
    return checked ? checked.value : 'all';
}

function getMonth() {
    const value = el('export-month').value;
    return value === '' ? null : Number(value);
}

// Список сотрудников по выбранным условиям
function collectUsers() {
    let users = state.users || [];
    const scope = getScope();

    if (scope === 'group') {
        const groupId = el('export-group').value;
        users = users.filter(user => (user.groupId || 'ungrouped') === groupId);
    } else if (scope === 'picked') {
        users = users.filter(user => pickedIds.has(user.id));
    }

    const month = getMonth();
    if (month !== null) {
        users = users.filter(user => (user.vacations || []).some(vac => vacationTouchesMonth(vac, state.year, month)));
    }

    if (el('export-skip-empty').checked) {
        users = users.filter(user => activeVacations(user).length > 0);
    }

    return users;
}

function refreshSummary() {
    const users = collectUsers();
    const rows = buildExportRows(users);
    const skipped = countSkippedVacations(users);

    if (users.length === 0) {
        el('export-summary').textContent = 'Никого не выбрано — измените условия';
        el('export-run').disabled = true;
        return;
    }

    el('export-run').disabled = false;
    el('export-summary').textContent = `Сотрудников: ${users.length} · строк: ${rows.length}`
        + (skipped > 0 ? ` · пропущено периодов с ошибкой в датах: ${skipped}` : '');
}

function refreshGroups() {
    const select = el('export-group');
    const current = select.value;

    select.innerHTML = (state.groups || [])
        .map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.id === 'ungrouped' ? 'Без группы' : group.name)}</option>`)
        .join('');

    if (current) select.value = current;
}


function renderPickedList() {
    const list = el('export-picked-list');
    const query = searchQuery.trim().toLowerCase();

    const users = (state.users || []).filter(user =>
        !query || String(user.name || '').toLowerCase().includes(query));

    list.replaceChildren();

    if (users.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'export-picked__empty';
        empty.textContent = 'Ничего не найдено';
        list.appendChild(empty);
        return;
    }

    users.forEach(user => {
        const row = document.createElement('label');
        row.className = 'export-picked__item';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = pickedIds.has(user.id);
        input.addEventListener('change', () => {
            if (input.checked) pickedIds.add(user.id);
            else pickedIds.delete(user.id);
            refreshSummary();
        });

        const name = document.createElement('span');
        name.textContent = user.name;

        row.append(input, name);
        list.appendChild(row);
    });
}

function saveChoice() {
    try {
        localStorage.setItem(CHOICE_KEY, JSON.stringify({
            scope: getScope(),
            skipEmpty: el('export-skip-empty').checked
        }));
    } catch (error) {
        console.warn('[export] Не удалось сохранить выбор', error);
    }
}

function loadChoice() {
    try {
        const raw = localStorage.getItem(CHOICE_KEY);
        if (!raw) return;

        const choice = JSON.parse(raw);
        if (choice.scope) {
            const radio = document.querySelector(`input[name="export-scope"][value="${choice.scope}"]`);
            if (radio) radio.checked = true;
        }
        if (choice.skipEmpty) el('export-skip-empty').checked = true;
    } catch (error) {
        console.warn('[export] Не удалось прочитать выбор', error);
    }
}

function syncScopeUI() {
    const scope = getScope();

    el('export-group').disabled = scope !== 'group';
    el('export-picked').hidden = scope !== 'picked';
    refreshSummary();
}

export function openExportDialog() {
    refreshGroups();

    // Месяц по умолчанию берём из фильтра на экране
    const viewMonth = getViewMonth();
    el('export-month').value = viewMonth === null ? '' : String(viewMonth);

    loadChoice();
    syncScopeUI();
    renderPickedList();
    el('export-popup').classList.add('popup_opened');
}

export function closeExportDialog() {
    el('export-popup').classList.remove('popup_opened');
}

async function runExport() {
    const button = el('export-run');
    const users = collectUsers();

    saveChoice();
    button.disabled = true;
    button.textContent = 'Готовим…';

    try {
        const result = await exportToExcel(users);
        const skipped = result.skipped > 0 ? `. Пропущено периодов с ошибкой в датах: ${result.skipped}` : '';
        showNoticeLong(`Файл выгружен. Строк: ${result.rows}${skipped}`);
        closeExportDialog();
    } catch (error) {
        console.error('[export] Ошибка выгрузки:', error);
        el('export-summary').textContent = `Не удалось выгрузить: ${error.message}`;
    } finally {
        button.disabled = false;
        button.textContent = 'Выгрузить';
    }
}

export function initExportDialog() {
    const popup = el('export-popup');
    if (!popup) return;

    el('export-month').innerHTML = '<option value="">Все месяцы</option>'
        + MONTH_NAMES.map((name, index) => `<option value="${index}">${name}</option>`).join('');

    document.querySelectorAll('input[name="export-scope"]').forEach(radio => {
        radio.addEventListener('change', () => {
            syncScopeUI();
            renderPickedList();
        });
    });

    el('export-group').addEventListener('change', refreshSummary);
    el('export-month').addEventListener('change', refreshSummary);
    el('export-skip-empty').addEventListener('change', refreshSummary);

    el('export-search').addEventListener('input', (event) => {
        searchQuery = event.target.value;
        renderPickedList();
    });

    el('export-run').addEventListener('click', runExport);
    el('export-cancel').addEventListener('click', closeExportDialog);
    el('export-close').addEventListener('click', closeExportDialog);
    popup.addEventListener('mousedown', (event) => {
        if (event.target === popup) closeExportDialog();
    });
}
