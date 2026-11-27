// scripts/import-dialog.js — мастер загрузки графика из Excel (только администратор).

import { state, stateEvents } from './state.js';
import { parseImportFile, buildImportPlan, applyImportPlan } from './excel-import.js';
import { collectSnapshot, saveSnapshotToDb, downloadSnapshot } from './backup.js';
import { logEvent } from './log.js';
import { showNoticeLong } from './notice.js';

const el = (id) => document.getElementById(id);

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let plan = null;

function showStep(step) {
    ['file', 'preview', 'done'].forEach(name => {
        const node = el(`import-step-${name}`);
        if (node) node.hidden = name !== step;
    });

    el('import-back').hidden = step !== 'preview';
    el('import-parse').hidden = step !== 'file';
    el('import-apply').hidden = step !== 'preview';
}

export function openImportDialog() {
    plan = null;
    el('import-file').value = '';
    el('import-summary').textContent = '';
    el('import-table').innerHTML = '';
    el('import-skipped').innerHTML = '';
    el('import-result').innerHTML = '';
    showStep('file');
    el('import-popup').classList.add('popup_opened');
}

export function closeImportDialog() {
    el('import-popup').classList.remove('popup_opened');
}

async function parseSelectedFile() {
    const file = (el('import-file').files || [])[0];
    if (!file) {
        showNoticeLong('Сначала выберите файл .xlsx');
        return;
    }

    const button = el('import-parse');
    button.disabled = true;
    button.textContent = 'Разбираем…';

    try {
        const parsed = await parseImportFile(file);
        plan = buildImportPlan(parsed, state.users);
        renderPreview(file.name);
        showStep('preview');
    } catch (error) {
        console.error('[import] не удалось разобрать файл:', error);
        showNoticeLong(`Не удалось разобрать файл: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Разобрать';
    }
}

function renderPreview(fileName) {
    const stats = plan.stats;

    el('import-summary').innerHTML = `Файл: <b>${escapeHtml(fileName)}</b><br>`
        + `Строк с данными: <b>${stats.rows}</b> · сотрудников: <b>${stats.employees}</b> `
        + `(новых <b>${stats.newCount}</b>, обновляем <b>${stats.existingCount}</b>) · периодов отпусков: <b>${stats.vacations}</b>`
        + (stats.skipped > 0 ? `<br><span class="import-warn">Пропущено строк: ${stats.skipped}</span>` : '')
        + (stats.invalid > 0 ? `<br><span class="import-warn">Периодов с ошибкой в датах: ${stats.invalid} — импортируем как есть</span>` : '');

    const rows = plan.employees.map(item => `
        <tr>
            <td>${escapeHtml(item.fullName)}</td>
            <td>${escapeHtml(item.personnelNumber || '—')}</td>
            <td>${item.vacations.length}</td>
            <td class="${item.isNew ? 'import-new' : ''}">${escapeHtml(item.note)}</td>
        </tr>
    `).join('');

    el('import-table').innerHTML = `
        <table class="import-table">
            <thead><tr><th>Сотрудник</th><th>Табельный</th><th>Периодов</th><th>Что будет</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">В файле нет данных для импорта</td></tr>'}</tbody>
        </table>
    `;

    el('import-skipped').innerHTML = plan.skipped.length === 0 ? '' : `
        <div class="import-skipped__title">Пропущено (${plan.skipped.length}):</div>
        <div class="import-skipped__list">${plan.skipped.slice(0, 40)
            .map(item => `<div>Строка ${item.row}: ${escapeHtml(item.reason)}</div>`).join('')}</div>
    `;
}


async function runImport() {
    if (!plan) return;

    const message = `Применить импорт?\n\nСотрудников: ${plan.stats.employees} `
        + `(новых ${plan.stats.newCount}, обновляем ${plan.stats.existingCount})\n`
        + `Периодов отпусков: ${plan.stats.vacations}\n\n`
        + 'Отпуска найденных сотрудников будут заменены данными из файла.';

    if (!confirm(message)) return;

    const button = el('import-apply');
    button.disabled = true;
    button.textContent = 'Записываем…';

    let snapshotId = '';

    try {
        // 1. Резервная копия — до записи
        if (el('import-snapshot').checked) {
            const snapshot = collectSnapshot();
            if (el('import-download').checked) downloadSnapshot(snapshot, 'перед импортом');
            snapshotId = await saveSnapshotToDb(snapshot, 'Перед импортом из Excel');
        }

        // 2. Запись
        const results = await applyImportPlan(plan, {
            onProgress: (done, total) => { button.textContent = `Записываем ${done}/${total}`; }
        });

        // 3. Журнал
        logEvent({
            action: 'data.import',
            level: 'warn',
            message: `Импорт из Excel: создано ${results.created}, обновлено ${results.updated}, периодов ${results.vacations}`,
            details: {
                created: results.created,
                updated: results.updated,
                vacations: results.vacations,
                skipped: plan.stats.skipped,
                snapshot: snapshotId || 'нет'
            }
        });

        const skippedLine = plan.stats.skipped > 0
            ? `<div class="import-warn">Пропущено строк: ${plan.stats.skipped}</div>` : '';

        el('import-result').innerHTML = `
            <div class="import-done">
                <div class="import-done__row">Создано сотрудников: <b>${results.created}</b></div>
                <div class="import-done__row">Обновлено сотрудников: <b>${results.updated}</b></div>
                <div class="import-done__row">Записано периодов: <b>${results.vacations}</b></div>
                ${skippedLine}
                ${snapshotId ? '<div class="import-note">Резервная копия сохранена в базе</div>' : ''}
            </div>
        `;

        showStep('done');
        stateEvents.dispatchEvent(new Event('statechange'));
        showNoticeLong(`Импорт завершён: создано ${results.created}, обновлено ${results.updated}`);
    } catch (error) {
        console.error('[import] не удалось применить:', error);
        showNoticeLong(`Импорт не выполнен: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Применить';
    }
}

function backToFile() {
    plan = null;
    showStep('file');
}

export function initImportDialog() {
    const popup = el('import-popup');
    const openButton = el('btn-import');
    if (!popup || !openButton) return;

    openButton.addEventListener('click', openImportDialog);
    el('import-cancel').addEventListener('click', closeImportDialog);
    el('import-close-x').addEventListener('click', closeImportDialog);
    popup.addEventListener('mousedown', (event) => {
        if (event.target === popup) closeImportDialog();
    });

    el('import-parse').addEventListener('click', parseSelectedFile);
    el('import-apply').addEventListener('click', runImport);
    el('import-back').addEventListener('click', backToFile);

    el('import-file').addEventListener('change', () => {
        const file = (el('import-file').files || [])[0];
        el('import-file-name').textContent = file ? file.name : 'Файл не выбран';
    });
}
