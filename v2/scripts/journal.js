// scripts/journal.js — окно журнала действий (доступно только администратору).
// Фильтры и сортировка применяются к загруженным записям: так не нужны
// составные индексы в Firestore, а страницы подгружаются по мере надобности.

import { state } from './state.js';
import { fetchLogPage, pruneLogs, downloadLogsCsv, formatDateTime, LEVEL_LABELS, PAGE_SIZE } from './log.js';

const el = (id) => document.getElementById(id);

let loaded = [];
let cursor = null;
let allLoaded = false;
let loading = false;
let sortAsc = false;

const filters = { level: '', category: '', actor: '', text: '' };

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function visibleItems() {
    let items = loaded.slice();

    if (filters.level) items = items.filter(item => item.level === filters.level);
    if (filters.category) items = items.filter(item => item.category === filters.category);
    if (filters.actor) items = items.filter(item => item.actorName === filters.actor);

    if (filters.text) {
        const query = filters.text.toLowerCase();
        items = items.filter(item => `${item.action} ${item.message} ${item.actorName} ${item.targetName}`
            .toLowerCase().includes(query));
    }

    items.sort((a, b) => (sortAsc ? a.ts - b.ts : b.ts - a.ts));
    return items;
}

// Фильтры собираем из уже загруженных записей
function refreshFilterOptions() {
    const levelKeys = [...new Set(loaded.map(item => item.level))];
    el('journal-level').innerHTML = '<option value="">Все уровни</option>'
        + levelKeys.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(LEVEL_LABELS[key] || key)}</option>`).join('');

    const categories = [...new Set(loaded.map(item => item.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ru'));
    el('journal-category').innerHTML = '<option value="">Все разделы</option>'
        + categories.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    const actors = [...new Set(loaded.map(item => item.actorName).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ru'));
    el('journal-actor').innerHTML = '<option value="">Все авторы</option>'
        + actors.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    el('journal-level').value = levelKeys.includes(filters.level) ? filters.level : '';
    el('journal-category').value = categories.includes(filters.category) ? filters.category : '';
    el('journal-actor').value = actors.includes(filters.actor) ? filters.actor : '';
}

function renderRows() {
    const list = el('journal-list');
    const items = visibleItems();

    if (items.length === 0) {
        list.innerHTML = `<div class="journal-empty">${loaded.length === 0 ? 'Пока нет записей' : 'Ничего не найдено по фильтрам'}</div>`;
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

    el('journal-status').textContent = allLoaded
        ? `Показано ${items.length} из ${loaded.length} — загружены все записи за ${state.year}`
        : `Показано ${items.length} из ${loaded.length} загруженных`;

    el('journal-load-more').disabled = allLoaded || loading;
    el('journal-load-more').textContent = allLoaded ? 'Все загружены' : 'Показать ещё';
}


async function loadMore() {
    if (loading || allLoaded) return;

    loading = true;
    renderRows();

    try {
        const page = await fetchLogPage({ cursor, pageSize: PAGE_SIZE });
        loaded = loaded.concat(page.items);
        cursor = page.cursor;
        allLoaded = page.done;
        refreshFilterOptions();
    } catch (error) {
        console.error('[journal] не удалось загрузить записи:', error);
        el('journal-status').textContent = `Не удалось загрузить журнал: ${error.message}`;
    } finally {
        loading = false;
        renderRows();
    }
}

export async function openJournal() {
    const popup = el('journal-popup');
    if (!popup) return;

    popup.classList.add('popup_opened');

    loaded = [];
    cursor = null;
    allLoaded = false;
    el('journal-list').innerHTML = '<div class="journal-empty">Загружаем…</div>';

    // Заодно подрезаем журнал, чтобы он не разрастался
    pruneLogs(state.year).catch(() => {});
    await loadMore();
}

export function closeJournal() {
    el('journal-popup').classList.remove('popup_opened');
}

export function initJournal() {
    const popup = el('journal-popup');
    const openButton = el('btn-journal');
    if (!popup || !openButton) return;

    openButton.addEventListener('click', openJournal);
    el('journal-close').addEventListener('click', closeJournal);
    el('journal-close-x').addEventListener('click', closeJournal);
    popup.addEventListener('mousedown', (event) => {
        if (event.target === popup) closeJournal();
    });

    el('journal-load-more').addEventListener('click', loadMore);

    el('journal-level').addEventListener('change', (event) => {
        filters.level = event.target.value;
        renderRows();
    });
    el('journal-category').addEventListener('change', (event) => {
        filters.category = event.target.value;
        renderRows();
    });
    el('journal-actor').addEventListener('change', (event) => {
        filters.actor = event.target.value;
        renderRows();
    });
    el('journal-search').addEventListener('input', (event) => {
        filters.text = event.target.value;
        renderRows();
    });

    el('journal-sort').addEventListener('click', (event) => {
        sortAsc = !sortAsc;
        event.target.textContent = sortAsc ? 'Сначала старые' : 'Сначала новые';
        renderRows();
    });

    el('journal-download').addEventListener('click', () => {
        const items = visibleItems();
        if (items.length === 0) return;
        downloadLogsCsv(items, state.year);
    });
}
