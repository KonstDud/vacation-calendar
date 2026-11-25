// scripts/calendar-grid.js
import { state } from './state.js';
import { countDaysFromYearStart } from './utils.js';
import { isUserHidden, isGroupHidden } from './view-prefs.js';
import { canEditUser } from './auth.js';

export function updateCalendarVacations(scheduleSave, requestRender, renderUserCard) {
    clearUserVacationHighlight();

    document.querySelectorAll('.calendar__day--highlighted, .calendar__day--to-delete').forEach(d => d.classList.remove('calendar__day--highlighted', 'calendar__day--to-delete'));
    document.querySelectorAll('.calendar__span, .calendar__span-plus, .calendar__simple-tooltip').forEach(el => el.remove());

    const oldPopover = document.getElementById('calendar-popover');
    if (oldPopover) oldPopover.remove();

    const dayData = {};

    state.users.forEach(user => {
        // Видимость — личная настройка (localStorage), а не общая для всех
        if (isUserHidden(user.id)) return;
        if (isGroupHidden(user.groupId || 'ungrouped')) return;

        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            if (vac.endDate < vac.startDate) return;

            const startIndex = countDaysFromYearStart(vac.startDate, state.year);
            const endIndex = countDaysFromYearStart(vac.endDate, state.year);

            for (let i = startIndex; i <= endIndex; i++) {
                if (!dayData[i]) dayData[i] = [];
                dayData[i].push({ name: user.name, color: user.color, userId: user.id, vacId: vac.id, startIndex, endIndex });
            }
        });
    });

    Object.keys(dayData).forEach(dayIndexStr => {
        const dayIndex = Number(dayIndexStr);
        const dayDiv = document.getElementById(`dayid_${dayIndex}`);
        if (!dayDiv) return;

        const people = dayData[dayIndex];

        dayDiv.querySelectorAll('.calendar__span, .calendar__span-plus, .calendar__simple-tooltip').forEach(el => el.remove());

        // 1. ПРОСТОЙ ТУЛТИП
        const simpleTooltip = document.createElement('div');
        simpleTooltip.classList.add('calendar__simple-tooltip');

        people.forEach(person => {
            const item = document.createElement('div');
            item.classList.add('calendar__simple-tooltip-item');
            const dot = document.createElement('div');
            dot.classList.add('calendar__simple-tooltip-dot');
            dot.style.backgroundColor = person.color;
            const name = document.createElement('span');
            name.textContent = person.name;

            item.append(dot, name);
            simpleTooltip.appendChild(item);
        });

        dayDiv.appendChild(simpleTooltip);

        // 2. ТОЧКИ
        if (people.length <= 3) {
            people.forEach((person, idx) => {
                const span = document.createElement('span');
                span.classList.add('calendar__span');
                span.style.backgroundColor = person.color;
                if (people.length === 1) span.style.left = '50%';
                else if (people.length === 2) span.style.left = `${30 + idx * 40}%`;
                else span.style.left = `${20 + idx * 30}%`;

                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPopover(e, people, scheduleSave, requestRender, renderUserCard);
                });

                dayDiv.appendChild(span);
            });
        } else {
            // Больше 3 отпускников: 3 точки + «+N»
            const dotsToRender = people.slice(0, 3);
            const plusCount = people.length - dotsToRender.length;

            dotsToRender.forEach((person, idx) => {
                const span = document.createElement('span');
                span.classList.add('calendar__span');
                span.style.backgroundColor = person.color;
                span.style.left = `${16 + idx * 22}%`;

                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPopover(e, people, scheduleSave, requestRender, renderUserCard);
                });

                dayDiv.appendChild(span);
            });

            const plusText = document.createElement('div');
            plusText.classList.add('calendar__span-plus');
            plusText.textContent = `+${plusCount}`;
            if (plusCount > 9) plusText.style.fontSize = '9px';

            plusText.addEventListener('click', (e) => {
                e.stopPropagation();
                openPopover(e, people, scheduleSave, requestRender, renderUserCard);
            });

            dayDiv.appendChild(plusText);
        }
    });
}

function openPopover(e, people, scheduleSave, requestRender, renderUserCard) {
    const oldPopover = document.getElementById('calendar-popover');
    if (oldPopover) oldPopover.remove();

    const popover = document.createElement('div');
    popover.id = 'calendar-popover';
    popover.className = 'calendar-popover';

    const rect = e.target.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 8}px`;
    popover.style.left = `${rect.left + window.scrollX}px`;

    people.forEach(person => {
        const item = document.createElement('div');
        item.classList.add('calendar-popover-item');

        const dot = document.createElement('div');
        dot.classList.add('calendar-popover-dot');
        dot.style.backgroundColor = person.color;

        const name = document.createElement('span');
        name.textContent = person.name;

        const delBtn = document.createElement('button');
        delBtn.classList.add('calendar-popover-delete');
        delBtn.innerHTML = '✕';
        delBtn.title = 'Удалить отпуск';

        item.addEventListener('mouseenter', () => {
            for (let i = person.startIndex; i <= person.endIndex; i++) {
                const d = document.getElementById(`dayid_${i}`);
                if (d) d.classList.add('calendar__day--highlighted');
            }
        });
        item.addEventListener('mouseleave', () => {
            document.querySelectorAll('.calendar__day--highlighted').forEach(d => d.classList.remove('calendar__day--highlighted'));
        });

        delBtn.addEventListener('mouseenter', () => {
            for (let i = person.startIndex; i <= person.endIndex; i++) {
                const d = document.getElementById(`dayid_${i}`);
                if (d) d.classList.add('calendar__day--to-delete');
            }
        });
        delBtn.addEventListener('mouseleave', () => {
            document.querySelectorAll('.calendar__day--to-delete').forEach(d => d.classList.remove('calendar__day--to-delete'));
        });

        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            document.querySelectorAll('.calendar__day--highlighted, .calendar__day--to-delete').forEach(d => {
                d.classList.remove('calendar__day--highlighted', 'calendar__day--to-delete');
            });

            const u = state.users.find(u => u.id === person.userId);
            if (!u) return;
            u.vacations = u.vacations.filter(v => v.id !== person.vacId);
            scheduleSave(u.id, u);
            updateCalendarVacations(scheduleSave, requestRender, renderUserCard);
            const card = document.getElementById(`user-card-${u.id}`);
            if (card) renderUserCard(u, requestRender, updateCalendarVacations);

            const currentPopover = document.getElementById('calendar-popover');
            if (currentPopover) currentPopover.remove();
        });

        // Крестик удаления — только для своих отпусков (админ — для всех)
        if (canEditUser(person.userId)) {
            item.append(dot, name, delBtn);
        } else {
            item.append(dot, name);
        }
        popover.appendChild(item);
    });

    document.body.appendChild(popover);

    const closePopover = (ev) => {
        if (!popover.contains(ev.target)) {
            popover.remove();
            document.removeEventListener('mousedown', closePopover);
            document.querySelectorAll('.calendar__day--highlighted').forEach(d => d.classList.remove('calendar__day--highlighted'));
        }
    };

    setTimeout(() => {
        document.addEventListener('mousedown', closePopover);
    }, 10);
}

// --- Подсветка отпусков сотрудника при наведении на его карточку в панели ---

const USER_HOVER_CLASS = 'calendar__day--user-hover';

function isUserShownOnCalendar(user) {
    if (!user) return false;
    if (isUserHidden(user.id)) return false;
    return !isGroupHidden(user.groupId || 'ungrouped');
}

// Подсвечивает все дни отпусков сотрудника (только если он сам показан на календаре)
export function highlightUserVacations(user) {
    clearUserVacationHighlight();
    if (!isUserShownOnCalendar(user)) return;

    const color = user.color || '#3b82f6';

    (user.vacations || []).forEach(vac => {
        if (!vac.startDate || !vac.endDate || vac.endDate < vac.startDate) return;

        const startIndex = countDaysFromYearStart(vac.startDate, state.year);
        const endIndex = countDaysFromYearStart(vac.endDate, state.year);

        for (let i = startIndex; i <= endIndex; i++) {
            const dayDiv = document.getElementById(`dayid_${i}`);
            if (!dayDiv) continue;
            dayDiv.style.setProperty('--user-hover-color', color);
            dayDiv.classList.add(USER_HOVER_CLASS);
        }
    });
}

export function clearUserVacationHighlight() {
    document.querySelectorAll(`.${USER_HOVER_CLASS}`).forEach(dayDiv => {
        dayDiv.classList.remove(USER_HOVER_CLASS);
        dayDiv.style.removeProperty('--user-hover-color');
    });
}