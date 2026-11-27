// scripts/view-month.js — временный просмотр «отпуска за месяц».
// Это режим просмотра, а не настройка: личные «глаза» и порядок не трогаем.

import { state, stateEvents } from './state.js';

export const MONTH_NAMES = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

let viewMonth = null; // null — весь год, иначе 0..11

export function getViewMonth() {
    return viewMonth;
}

export function isViewMonthActive() {
    return viewMonth !== null;
}

export function setViewMonth(month) {
    const next = (month === null || month === '' || month === undefined || Number.isNaN(Number(month)))
        ? null
        : Number(month);

    if (next === viewMonth) return;
    viewMonth = next;
    stateEvents.dispatchEvent(new Event('viewfilterchange'));
}

export function getViewMonthName() {
    return viewMonth === null ? '' : MONTH_NAMES[viewMonth];
}

// Дата в формате ISO: '2027-02-28'. Сравниваем строки, а не Date —
// иначе получаем сдвиг из-за разницы UTC и локального времени.
function isoDate(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthBounds(year, month) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return { start: isoDate(year, month, 1), end: isoDate(year, month, lastDay) };
}

// Пересекается ли отпуск с указанным месяцем
export function vacationTouchesMonth(vac, year, month) {
    if (!vac || !vac.startDate || !vac.endDate || vac.endDate < vac.startDate) return false;

    const { start, end } = monthBounds(year, month);
    return vac.startDate <= end && vac.endDate >= start;
}

export function userHasVacationInMonth(user, year, month) {
    return (user.vacations || []).some(vac => vacationTouchesMonth(vac, year, month));
}

// Кого показываем в панели и на календаре при активном фильтре
export function filterUsersByViewMonth(users) {
    if (viewMonth === null) return users;
    return (users || []).filter(user => userHasVacationInMonth(user, state.year, viewMonth));
}

// Периоды этого сотрудника, попавшие в выбранный месяц (для подписи в карточке)
export function countUserVacationsInMonth(user, year, month) {
    return (user.vacations || []).filter(vac => vacationTouchesMonth(vac, year, month)).length;
}

// Диапазон месяцев для календаря: выбранный плюс соседние,
// если их задевают отпуска (переход через границу месяца).
export function getCalendarMonthRange(users) {
    if (viewMonth === null) return { from: 0, to: 11 };

    const year = state.year;
    const bounds = monthBounds(year, viewMonth);

    // Отпуск начинается в прошлом месяце и тянется в выбранный
    const spillsFromPrev = (users || []).some(user => (user.vacations || []).some(vac =>
        vacationTouchesMonth(vac, year, viewMonth) && vac.startDate < bounds.start));

    // Отпуск заканчивается уже в следующем месяце
    const spillsToNext = (users || []).some(user => (user.vacations || []).some(vac =>
        vacationTouchesMonth(vac, year, viewMonth) && vac.endDate > bounds.end));

    return {
        from: spillsFromPrev && viewMonth > 0 ? viewMonth - 1 : viewMonth,
        to: spillsToNext && viewMonth < 11 ? viewMonth + 1 : viewMonth
    };
}
