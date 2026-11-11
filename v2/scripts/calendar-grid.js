// scripts/calendar-grid.js
import { state } from './state.js';
import { countDaysFromYearStart } from './utils.js';

export function updateCalendarVacations(scheduleSave, requestRender, renderUserCard) {
    document.querySelectorAll('.calendar__day--highlighted, .calendar__day--to-delete').forEach(d => d.classList.remove('calendar__day--highlighted', 'calendar__day--to-delete'));
    document.querySelectorAll('.calendar__span, .calendar__span-plus, .calendar__simple-tooltip').forEach(el => el.remove());

    const oldPopover = document.getElementById('calendar-popover');
    if (oldPopover) oldPopover.remove();

    const dayData = {};

    state.users.forEach(user => {
        if (user.isVisible === false) return;

        // ИСПРАВЛЕННАЯ ПРОВЕРКА ГРУППЫ (включая ungrouped)
        let group;
        if (user.groupId) {
            group = state.groups.find(g => g.id === user.groupId);
        } else {
            // Если groupId пустой, значит это "Без группы"
            group = state.groups.find(g => g.id === 'ungrouped');
        }

        if (group && group.isVisible === false) return;

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
            const isTwoDigit = (people.length - 2) > 9;
            const dotsToRender = isTwoDigit ? people.slice(0, 1) : people.slice(0, 2);

            dotsToRender.forEach((person, idx) => {
                const span = document.createElement('span');
                span.classList.add('calendar__span');
                span.style.backgroundColor = person.color;
                span.style.left = isTwoDigit ? '30%' : `${25 + idx * 25}%`;

                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPopover(e, people, scheduleSave, requestRender, renderUserCard);
                });

                dayDiv.appendChild(span);
            });

            const plusText = document.createElement('div');
            plusText.classList.add('calendar__span-plus');
            plusText.textContent = `+${people.length - dotsToRender.length}`;
            plusText.style.cssText = `position: absolute; bottom: 2px; left: ${isTwoDigit ? '60%' : '75%'}; transform: translateX(-50%); font-size: 10px; color: var(--text-secondary); font-weight: bold; cursor: pointer; line-height: 1; z-index: 6;`;

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

        item.append(dot, name, delBtn);
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