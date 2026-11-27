// scripts/journal-window.js — плавающее окно журнала действий (только администратор).
// Окно можно таскать за заголовок, растягивать за угол и сворачивать.
// Пока окно открыто, свежие записи подтягиваются сами (onSnapshot на последние 50).

import { state } from './state.js';
import {
    fetchLogPage, subscribeLatestLogs, pruneLogs, clearLogs, deleteLogsOlderThan,
    downloadLogs, formatDateTime, LEVEL_LABELS, CATEGORIES, PAGE_SIZE
} from './log.js';
import { logEvent } from './log.js';
import { showNoticeLong } from './notice.js';

const el = (id) => document.getElementById(id);

let tail = [];        // живой «хвост» — свежие записи (обновляется сам)
let older = [];       // подгруженные страницы по кнопке
let cursor = null;
let allLoaded = false;
let loading = false;
let sortAsc = false;
let unsubscribe = null;

const filters = { level: '', category: '', action: '', actor: '', text: '' };

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Все записи: свежие сверху + то, что догрузили кнопкой (без дублей)
function allItems() {
    const seen = new Set();
    return tail.concat(older).filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function visibleItems() {
    let items = allItems();

    if (filters.level) items = items.filter(item => item.level === filters.level);
    if (filters.category) items = items.filter(item => item.category === filters.category);
    if (filters.actor) items = items.filter(item => item.actorName === filters.actor);
    if (filters.action) items = items.filter(item => item.action === filters.action);

    if (filters.text) {
        const query = filters.text.toLowerCase();
        items = items.filter(item => `${item.action} ${item.message} ${item.actorName} ${item.targetName}`
            .toLowerCase().includes(query));
    }

    items.sort((a, b) => (sortAsc ? a.ts - b.ts : b.ts - a.ts));
    return items;
}

// Значения фильтров: уровни и разделы — постоянные, авторы — люди + те, кто уже в журнале.
// Так список не пустой, даже когда записей ещё нет.
function refreshFilterOptions() {
    const items = allItems();

    el('journal-level').innerHTML = '<option value="">Все уровни</option>'
        + Object.keys(LEVEL_LABELS).map(key =>
            `<option value="${escapeHtml(key)}">${escapeHtml(LEVEL_LABELS[key])}</option>`).join('');

    el('journal-category').innerHTML = '<option value="">Все разделы</option>'
        + Object.values(CATEGORIES).concat(['Прочее']).map(value =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    const actions = [...new Set(items.map(item => item.action).filter(Boolean))].sort();
    el('journal-action').innerHTML = '<option value="">Все действия</option>'
        + actions.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    const actorNames = new Set(items.map(item => item.actorName).filter(Boolean));
    (state.users || []).forEach(user => { if (user.name) actorNames.add(user.name); });
    const actors = [...actorNames].sort((a, b) => a.localeCompare(b, 'ru'));
    el('journal-actor').innerHTML = '<option value="">Все авторы</option>'
        + actors.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    el('journal-level').value = filters.level;
    el('journal-category').value = filters.category;
    el('journal-action').value = filters.action;
    el('journal-actor').value = filters.actor;
}


function renderRows() {
    const list = el('journal-list');
    const items = visibleItems();
    const total = allItems().length;

    if (items.length === 0) {
        list.innerHTML = `<div class="journal-empty">${total === 0 ? 'Пока нет записей' : 'Ничего не найдено по фильтрам'}</div>`;
    } else {
        list.innerHTML = items.map(item => {
            const level = LEVEL_LABELS[item.level] ? item.level : 'info';
            const details = item.details
                ? Object.entries(item.details).map(([key, value]) => `${key}: ${value}`).join(' · ')
                : '';

            return `
                <div class="journal-row journal-row_${level}">
                    <span class="journal-row__time">${escapeHtml(formatDateTime(item.ts))}</span>
                    <span class="journal-row__level journal-row__level_${level}">${escapeHtml(LEVEL_LABELS[level] || level)}</span>
                    <span class="journal-row__who">${escapeHtml(item.actorName || '—')}</span>
                    <span class="journal-row__body">
                        <span class="journal-row__message">${escapeHtml(item.message || item.action)}</span>
                        <span class="journal-row__meta">${escapeHtml(item.category || '')} · ${escapeHtml(item.action)}${details ? ' · ' + escapeHtml(details) : ''}</span>
                    </span>
                </div>
            `;
        }).join('');
    }

    el('journal-status').textContent = `${items.length} из ${total}`
        + (allLoaded ? ' · загружены все записи за год' : ' · есть ещё записи')
        + (loading ? ' · загружаем…' : '');

    el('journal-load-more').disabled = allLoaded || loading;
    el('journal-load-more').textContent = allLoaded ? 'Все загружены' : 'Показать ещё';
}

// Живое обновление: пока окно открыто, свежие записи приходят сами
function startLive() {
    stopLive();
    unsubscribe = subscribeLatestLogs((items) => {
        tail = items;
        refreshFilterOptions();
        renderRows();
    });
}

function stopLive() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
}

async function loadMore() {
    if (loading || allLoaded) return;

    loading = true;
    renderRows();

    try {
        const page = await fetchLogPage({ cursor, pageSize: PAGE_SIZE });
        older = older.concat(page.items);
        cursor = page.cursor;
        allLoaded = page.done;
        refreshFilterOptions();
    } catch (error) {
        console.error('[journal] не удалось загрузить записи:', error);
        el('journal-status').textContent = `Не удалось загрузить: ${error.message}`;
    } finally {
        loading = false;
        renderRows();
    }
}

// --- положение, размер, сворачивание ---

const GEOMETRY_KEY = 'vacationJournalGeometry';

function applySavedGeometry() {
    const win = el('journal-popup');
    let saved = null;

    try {
        saved = JSON.parse(localStorage.getItem(GEOMETRY_KEY) || 'null');
    } catch (error) {
        saved = null;
    }

    if (saved && saved.width) {
        win.style.width = `${saved.width}px`;
        win.style.height = `${saved.height}px`;
        win.style.left = `${saved.left}px`;
        win.style.top = `${saved.top}px`;
    }
}

function saveGeometry() {
    const win = el('journal-popup');
    if (win.hidden) return;

    try {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
            width: win.offsetWidth,
            height: win.offsetHeight,
            left: win.offsetLeft,
            top: win.offsetTop
        }));
    } catch (error) {
        /* не критично */
    }
}

// Окно таскается за заголовок
function initDrag() {
    const win = el('journal-popup');
    const bar = el('journal-drag');

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    bar.addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) return;
        event.preventDefault();

        startX = event.clientX;
        startY = event.clientY;
        startLeft = win.offsetLeft;
        startTop = win.offsetTop;

        const onMove = (moveEvent) => {
            const left = Math.max(4, Math.min(window.innerWidth - 140, startLeft + moveEvent.clientX - startX));
            const top = Math.max(4, Math.min(window.innerHeight - 44, startTop + moveEvent.clientY - startY));
            win.style.left = `${left}px`;
            win.style.top = `${top}px`;
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveGeometry();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // размер меняется за угол средствами CSS — просто сохраняем результат
    win.addEventListener('mouseup', saveGeometry);
}

function toggleCollapse() {
    const collapsed = el('journal-popup').classList.toggle('journal-window_collapsed');
    el('journal-collapse').title = collapsed ? 'Развернуть' : 'Свернуть';
    el('journal-collapse').textContent = collapsed ? '▢' : '—';
}

// --- выгрузка и очистка ---

function exportLogs() {
    const items = visibleItems();
    if (items.length === 0) return;

    downloadLogs(items, state.year, el('journal-format').value);
}

async function cleanLogs(scope) {
    if (!scope) return;

    const label = scope === 'all' ? 'все записи за год' : `записи старше ${scope} дней`;
    if (!confirm(`Удалить ${label}? Действие необратимо.`)) {
        el('journal-clean-scope').value = '';
        return;
    }

    try {
        const removed = scope === 'all'
            ? await clearLogs(state.year)
            : await deleteLogsOlderThan(state.year, Number(scope));

        // Пишем в журнал сам факт очистки — эта запись остаётся
        logEvent({
            action: 'data.logs_clean',
            level: 'warn',
            message: `Очистил журнал (${label}): удалено записей ${removed}`,
            details: { removed, scope: String(scope) }
        });

        showNoticeLong(`Журнал очищен: удалено записей ${removed}`);
        await reload();
    } catch (error) {
        console.error('[journal] не удалось очистить журнал:', error);
        showNoticeLong(`Не удалось очистить журнал: ${error.message}`);
    } finally {
        el('journal-clean-scope').value = '';
    }
}

// --- открытие/закрытие ---

export async function openJournal() {
    const win = el('journal-popup');
    win.hidden = false;

    // первый раз показываем окно по центру
    if (!win.style.left) {
        win.style.left = `${Math.max(16, Math.round((window.innerWidth - win.offsetWidth) / 2))}px`;
        win.style.top = '88px';
    }

    stopLive();
    tail = [];
    older = [];
    cursor = null;
    allLoaded = false;
    el('journal-list').innerHTML = '<div class="journal-empty">Загружаем…</div>';

    // Заодно подрезаем журнал, чтобы он не разрастался
    pruneLogs(state.year).catch(() => {});
    await loadMore();
    startLive();
}

export function closeJournal() {
    el('journal-popup').hidden = true;
    stopLive();
    saveGeometry();
}

export function initJournal() {
    const openButton = el('btn-journal');
    if (!openButton || !el('journal-popup')) return;

    applySavedGeometry();
    initDrag();

    openButton.addEventListener('click', openJournal);
    el('journal-close').addEventListener('click', closeJournal);
    el('journal-close-x').addEventListener('click', closeJournal);
    el('journal-collapse').addEventListener('click', toggleCollapse);
    el('journal-refresh').addEventListener('click', reload);
    el('journal-load-more').addEventListener('click', loadMore);

    el('journal-level').addEventListener('change', (event) => { filters.level = event.target.value; renderRows(); });
    el('journal-category').addEventListener('change', (event) => { filters.category = event.target.value; renderRows(); });
    el('journal-action').addEventListener('change', (event) => { filters.action = event.target.value; renderRows(); });
    el('journal-actor').addEventListener('change', (event) => { filters.actor = event.target.value; renderRows(); });
    el('journal-search').addEventListener('input', (event) => { filters.text = event.target.value; renderRows(); });

    el('journal-sort').addEventListener('click', (event) => {
        sortAsc = !sortAsc;
        event.target.textContent = sortAsc ? 'Сначала старые' : 'Сначала новые';
        renderRows();
    });

    el('journal-download').addEventListener('click', exportLogs);
    el('journal-clean-scope').addEventListener('change', (event) => cleanLogs(event.target.value));
}


// Полная перезагрузка (кнопка «Обновить»)
async function reload() {
    older = [];
    cursor = null;
    allLoaded = false;
    await loadMore();
    startLive();
}
