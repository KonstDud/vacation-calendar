// scripts/reset-dialog.js — «Сбросить всё»: только админ, с резервной копией.
// Сначала сохраняем копию (в базу и/или файлом), затем удаляем данные года.

import { state, stateEvents } from './state.js';
import { logEvent } from './log.js';
import { collectSnapshot, downloadSnapshot, saveSnapshotToDb } from './backup.js';
import { showNoticeLong } from './notice.js';

const el = (id) => document.getElementById(id);

function countVacations() {
    return (state.users || []).reduce((sum, user) => sum + (user.vacations || []).length, 0);
}

function refreshSummary() {
    el('reset-summary').innerHTML = `Удалим сотрудников: <b>${state.users.length}</b><br>`
        + `Вместе с ними удалятся отпуска: <b>${countVacations()}</b><br>`
        + 'Группы и справочники останутся — это структура, а не данные.';
}

function syncRunButton() {
    el('reset-run').disabled = !el('reset-confirm').checked;
}

export function openResetDialog() {
    refreshSummary();
    el('reset-confirm').checked = false;
    el('reset-run').disabled = true;
    el('reset-popup').classList.add('popup_opened');
}

export function closeResetDialog() {
    el('reset-popup').classList.remove('popup_opened');
}

async function runReset() {
    const button = el('reset-run');
    const withSnapshot = el('reset-snapshot').checked;
    const withDownload = el('reset-download').checked;
    const withAccess = el('reset-access').checked;

    const users = (state.users || []).slice();
    const vacationsCount = countVacations();

    button.disabled = true;
    button.textContent = 'Сбрасываем…';

    let snapshotId = '';

    try {
        // 1. Резервная копия — до любых удалений
        if (withSnapshot || withDownload) {
            const snapshot = collectSnapshot();

            if (withDownload) downloadSnapshot(snapshot, 'перед сбросом');
            if (withSnapshot) snapshotId = await saveSnapshotToDb(snapshot, 'Перед сбросом данных');
        }

        // 2. Удаляем сотрудников вместе с отпусками (и доступы, если попросили)
        await Promise.all(users.map(async user => {
            await window.firestore.deleteDoc(
                window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', user.id)
            );
            if (withAccess) {
                await window.firestore.deleteDoc(window.firestore.doc(window.db, 'access', user.id));
            }
        }));

        state.users = [];

        // 3. Записываем в журнал: операция опасная, уровень «важно»
        logEvent({
            action: 'data.reset',
            level: 'warn',
            message: `Сбросил данные: удалено сотрудников ${users.length}, отпусков ${vacationsCount}`,
            details: {
                users: users.length,
                vacations: vacationsCount,
                snapshot: snapshotId || 'нет',
                access: withAccess ? 'удалены' : 'сохранены'
            }
        });

        showNoticeLong(`Данные сброшены. Удалено сотрудников: ${users.length}`
            + (snapshotId ? '. Резервная копия сохранена в базе' : ''));

        closeResetDialog();
        stateEvents.dispatchEvent(new Event('statechange'));
    } catch (error) {
        console.error('[reset] не удалось сбросить данные:', error);
        showNoticeLong(`Не удалось сбросить: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Сбросить всё';
    }
}

export function initResetDialog() {
    const popup = el('reset-popup');
    const openButton = el('btn-reset');
    if (!popup || !openButton) return;

    openButton.addEventListener('click', openResetDialog);
    el('reset-cancel').addEventListener('click', closeResetDialog);
    el('reset-close-x').addEventListener('click', closeResetDialog);
    popup.addEventListener('mousedown', (event) => {
        if (event.target === popup) closeResetDialog();
    });

    el('reset-confirm').addEventListener('change', syncRunButton);
    el('reset-run').addEventListener('click', runReset);
}
