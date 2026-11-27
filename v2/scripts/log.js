// scripts/log.js — журнал действий.
//
// Хранение: vacationData_v2/{год}/logs — по году, как остальные данные.
// Объём: держим не больше MAX_PER_YEAR записей за год, старые подрезаем
//        (чистка запускается при входе администратора и при открытии журнала).
// Чтение: страницами по PAGE_SIZE (новые сверху), фильтры — по загруженным
//        записям, чтобы не требовать составных индексов в Firestore.

import { state } from './state.js';
import { getCurrentUserId, getCurrentUserName, getRoleLabel } from './auth.js';

export const LOG_LEVELS = ['info', 'warn', 'error'];

export const LEVEL_LABELS = {
    info: 'Обычное',
    warn: 'Важно',
    error: 'Ошибка'
};

export const CATEGORIES = {
    user: 'Сотрудники',
    vacation: 'Отпуска',
    group: 'Группы',
    data: 'Данные',
    auth: 'Вход'
};

export const PAGE_SIZE = 50;

// Журнал не должен расти бесконечно: за год храним не больше 1000 записей
const MAX_PER_YEAR = 1000;
const PRUNE_BUFFER = 50;
const MAX_MESSAGE = 300;

function logsCollection(year) {
    return window.firestore.collection(window.db, 'vacationData_v2', String(year), 'logs');
}

function categoryOf(action) {
    const prefix = String(action || '').split('.')[0];
    return CATEGORIES[prefix] || 'Прочее';
}

// Детали события — без «полотна»: только простые значения и короткие строки
function trimDetails(details) {
    if (!details || typeof details !== 'object') return null;

    const result = {};
    Object.keys(details).slice(0, 12).forEach(key => {
        const value = details[key];
        if (value === null || value === undefined) return;
        if (typeof value === 'object') return;
        result[key] = String(value).slice(0, 120);
    });

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Записать событие в журнал.
 * @param {object} event
 * @param {string} event.action — «user.add», «vacation.remove», «data.export»…
 * @param {string} [event.level] — info | warn | error
 * @param {string} [event.message] — человекочитаемое описание
 * @param {string} [event.targetId]
 * @param {string} [event.targetName]
 * @param {object} [event.details]
 * @param {number} [event.year]
 */
export async function logEvent({
    action,
    level = 'info',
    message = '',
    targetId = '',
    targetName = '',
    details = null,
    year
} = {}) {
    const entry = {
        ts: Date.now(),
        level: LOG_LEVELS.includes(level) ? level : 'info',
        action: String(action || 'unknown'),
        category: categoryOf(action),
        message: String(message || '').slice(0, MAX_MESSAGE),
        actorId: getCurrentUserId(),
        actorName: getCurrentUserName() || getRoleLabel() || 'Администратор',
        actorRole: getRoleLabel(),
        targetId: String(targetId || ''),
        targetName: String(targetName || '').slice(0, 120),
        year: Number(year) || state.year
    };

    const trimmed = trimDetails(details);
    if (trimmed) entry.details = trimmed;

    try {
        const colRef = logsCollection(entry.year);
        const newRef = window.firestore.doc(colRef);
        entry.id = newRef.id;
        await window.firestore.setDoc(newRef, entry);
    } catch (error) {
        // Журнал не должен ломать основную работу приложения
        console.warn('[log] не удалось записать событие:', error);
    }

    return entry;
}


// --- чтение ---

// Одна страница журнала: новые сверху
export async function fetchLogPage({ cursor = null, pageSize = PAGE_SIZE, year } = {}) {
    const { query, orderBy, limit, startAfter, getDocs } = window.firestore;
    const colRef = logsCollection(Number(year) || state.year);

    const constraints = [orderBy('ts', 'desc')];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snapshot = await getDocs(query(colRef, ...constraints));

    const items = [];
    snapshot.forEach(item => items.push({ id: item.id, ref: item.ref, ...item.data() }));

    const docs = snapshot.docs || [];
    const last = docs.length > 0 ? docs[docs.length - 1] : null;

    return { items, cursor: last, done: items.length < pageSize };
}

// --- чистка ---

// Держим журнал в разумных размерах: старое подрезаем, чтобы не копить мусор
export async function pruneLogs(year) {
    const { query, orderBy, limit, getDocs, getCountFromServer, deleteDoc } = window.firestore;
    if (typeof getCountFromServer !== 'function') return 0;

    const colRef = logsCollection(Number(year) || state.year);

    try {
        const countSnapshot = await getCountFromServer(query(colRef));
        const total = countSnapshot.data().count;
        if (total <= MAX_PER_YEAR) return 0;

        const removeCount = total - MAX_PER_YEAR + PRUNE_BUFFER;
        const oldSnapshot = await getDocs(query(colRef, orderBy('ts', 'asc'), limit(removeCount)));

        const tasks = [];
        oldSnapshot.forEach(item => {
            if (item.ref) tasks.push(deleteDoc(item.ref));
        });

        await Promise.all(tasks);
        console.info(`[log] журнал подрезан: удалено ${tasks.length} старых записей`);
        return tasks.length;
    } catch (error) {
        console.warn('[log] не удалось подрезать журнал:', error);
        return 0;
    }
}

// --- представление и выгрузка ---

export function formatDateTime(ts) {
    if (!ts) return '';
    const date = new Date(Number(ts));
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const csvCell = (value) => {
    const text = String(value === undefined || value === null ? '' : value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function logsToCsv(items) {
    const header = ['Время', 'Уровень', 'Категория', 'Действие', 'Кто', 'Роль', 'Объект', 'Сообщение'];

    const rows = (items || []).map(item => [
        formatDateTime(item.ts),
        LEVEL_LABELS[item.level] || item.level,
        item.category || '',
        item.action || '',
        item.actorName || '',
        item.actorRole || '',
        item.targetName || '',
        item.message || ''
    ]);

    return [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
}

export function downloadLogsCsv(items, year) {
    // BOM — иначе Excel ломает кириллицу
    const blob = new Blob(['\ufeff' + logsToCsv(items)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Журнал действий ${year || state.year}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Тихая подрезка при входе администратора — чтобы журнал не разрастался
export function schedulePrune(year) {
    setTimeout(() => { pruneLogs(year); }, 3000);
}
