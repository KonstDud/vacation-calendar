// scripts/calendar-interactions.js

import { state, stateEvents } from './state.js';
import { setupUserCombobox, escapeHtml } from './user-combobox.js';
import { isAdmin, canEditUser, getCurrentUserId } from './auth.js';
import { logEvent } from './log.js';

let selectionStart = null;

// Выбор сотрудника с поиском и группами — в общем модуле scripts/user-combobox.js

export function initCalendarInteractions() {
    const calendarContainer = document.getElementById('calendar-container');
    if (!calendarContainer) return;

    calendarContainer.addEventListener('click', (e) => {
        const dayDiv = e.target.closest('.calendar__day[id^="dayid"]');
        if (!dayDiv) return;

        const dayIndex = parseInt(dayDiv.id.replace('dayid_', ''), 10);
        if (!dayIndex) return;

        if (selectionStart === null) {
            selectionStart = dayIndex;
            highlightRange(selectionStart, selectionStart);
            return;
        }

        let start = Math.min(selectionStart, dayIndex);
        let end = Math.max(selectionStart, dayIndex);

        highlightRange(start, end);

        const yearStart = new Date(state.year, 0, 1);

        const sDate = new Date(yearStart);
        sDate.setDate(sDate.getDate() + start - 1);
        const sStr = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, '0')}-${String(sDate.getDate()).padStart(2, '0')}`;

        const eDate = new Date(yearStart);
        eDate.setDate(eDate.getDate() + end - 1);
        const eStr = `${eDate.getFullYear()}-${String(eDate.getMonth() + 1).padStart(2, '0')}-${String(eDate.getDate()).padStart(2, '0')}`;

        openCreateVacationPopup(sStr, eStr, start, end);
        selectionStart = null;
    });
}

function highlightRange(startIndex, endIndex) {
    document.querySelectorAll('.calendar__day.selected').forEach(el => el.classList.remove('selected'));
    for (let i = startIndex; i <= endIndex; i++) {
        const dayDiv = document.getElementById(`dayid_${i}`);
        if (dayDiv) dayDiv.classList.add('selected');
    }
}

function clearSelection() {
    document.querySelectorAll('.calendar__day.selected').forEach(el => el.classList.remove('selected'));
    selectionStart = null;
}

// Функция для поиска отпусков в выбранном диапазоне
function getVacationsInRange(startIdx, endIdx) {
    const result = [];
    state.users.forEach(user => {
        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            const dStart = new Date(vac.startDate);
            const dEnd = new Date(vac.endDate);
            const yearStart = new Date(state.year, 0, 1);
            const vStart = Math.floor((dStart - yearStart) / (1000 * 3600 * 24)) + 1;
            const vEnd = Math.floor((dEnd - yearStart) / (1000 * 3600 * 24)) + 1;

            if (startIdx <= vEnd && endIdx >= vStart) {
                result.push({ user, vac });
            }
        });
    });
    return result;
}

function openCreateVacationPopup(startStr, endStr, startIdx, endIdx) {
    const popup = document.querySelector('.popup');
    const popupTitle = popup.querySelector('.popup__title');
    const popupContent = popup.querySelector('.popup__content');

    const totalDays = endIdx - startIdx + 1;
    const displayStart = startStr.split('-').reverse().join('.');
    const displayEnd = endStr.split('-').reverse().join('.');

    const existingVacations = getVacationsInRange(startIdx, endIdx);

    popupTitle.textContent = `Период: ${displayStart} — ${displayEnd} (${totalDays} дн.)`;

    let existingHTML = '';
    if (existingVacations.length > 0) {
        existingHTML = `
            <div class="popup__existing-vacations">
                <div class="popup__existing-title">Уже в отпуске:</div>
                ${existingVacations.map(({ user, vac }) => {
            // Форматируем даты отпуска для отображения
            const vacStart = new Date(vac.startDate);
            const vacEnd = new Date(vac.endDate);
            const startStrShort = `${String(vacStart.getDate()).padStart(2, '0')}.${String(vacStart.getMonth() + 1).padStart(2, '0')}`;
            const endStrShort = `${String(vacEnd.getDate()).padStart(2, '0')}.${String(vacEnd.getMonth() + 1).padStart(2, '0')}`;
            const canDelete = canEditUser(user.id);
            return `
                        <div class="popup__existing-item" data-vac-id="${vac.id}" data-user-id="${user.id}">
                            <div class="popup__existing-dot" style="background: ${user.color};"></div>
                            <span class="popup__existing-name">${user.name} <span class="popup__existing-dates">(${startStrShort} – ${endStrShort})</span></span>
                            ${canDelete ? '<button type="button" class="popup__existing-delete" title="Удалить этот отпуск">✕</button>' : ''}
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    // Кто и для кого может оформлять отпуска: админ — для всех, сотрудник — только себе
    const admin = isAdmin();
    const myId = getCurrentUserId();
    const me = myId ? state.users.find(u => u.id === myId) : null;
    const canAddOwn = !!me && canEditUser(me.id);
    const canAddForOthers = admin;
    const canAdd = canAddForOthers || canAddOwn;

    const pickerHtml = canAddForOthers
        ? `<label style="font-size: 13px; color: var(--text-muted);">Выберите сотрудника</label>
            <div class="userselect">
                <input type="text" class="userselect__input" id="popup-user-input" placeholder="Начните вводить имя..." autocomplete="off" />
                <button type="button" class="userselect__clear" id="popup-user-clear" title="Очистить">✕</button>
                <div class="userselect__list" id="popup-user-list"></div>
            </div>`
        : (canAddOwn
            ? `<div class="popup__target">Отпуск для: <b>${escapeHtml(me.name)}</b></div>`
            : `<div class="popup__target popup__target_muted">Добавление отпусков недоступно для вашей роли</div>`);

    popupContent.innerHTML = `
        ${existingHTML}
        
        <div class="popup__add-form">
            <div class="popup__add-title">${existingVacations.length > 0 ? 'Добавить еще один отпуск' : 'Оформить отпуск'}</div>
            ${pickerHtml}
            <div id="popup-error" style="color: var(--accent-red); font-size: 12px; display: none;"></div>

            ${canAdd ? '<button id="popup-save-btn" class="btn btn_add" style="margin-top: 8px;">Добавить отпуск</button>' : ''}
        </div>
    `;

    // Комбобокс выбора сотрудника (только для админа; нужен closePopup для снятия слушателей)
    const combo = canAddForOthers
        ? setupUserCombobox(popupContent, {
            getUsers: () => state.users,
            getGroups: () => state.groups
        })
        : null;

    popup.classList.add('popup_opened');

    const closePopup = () => {
        popup.classList.remove('popup_opened');
        clearSelection();
        popup.removeEventListener('mousedown', onMouseDown);
        if (combo) combo.destroy();
    };

    const onMouseDown = (e) => {
        if (e.target.classList.contains('popup_opened') || e.target.classList.contains('popup__close-button')) {
            closePopup();
        }
    };
    popup.addEventListener('mousedown', onMouseDown);

    popupContent.querySelectorAll('.popup__existing-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const item = e.target.closest('.popup__existing-item');
            const vacId = item.dataset.vacId;
            const userId = item.dataset.userId;
            if (!canEditUser(userId)) return;

            const user = state.users.find(u => u.id === userId);
            if (!user) return;

            user.vacations = user.vacations.filter(v => v.id !== vacId);

            try {
                const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
                const { id, ...dataToSave } = user;
                await window.firestore.setDoc(docRef, dataToSave, { merge: true });
                stateEvents.dispatchEvent(new Event('statechange'));
                item.remove();

                logEvent({
                    action: 'vacation.remove',
                    level: 'warn',
                    message: `Удалил отпуск из календаря (${user.name})`,
                    targetId: userId,
                    targetName: user.name,
                    details: { vacationId: vacId }
                });
            } catch (error) {
                console.error('Ошибка удаления:', error);
            }
        });
    });

    const saveBtn = document.getElementById('popup-save-btn');
    if (saveBtn) saveBtn.onclick = async () => {
        const errorDiv = document.getElementById('popup-error');
        errorDiv.style.display = 'none';

        // Админ выбирает сотрудника, остальные оформляют отпуск только себе
        let userId = '';
        if (canAddForOthers) {
            userId = combo ? combo.getSelectedId() : '';
            if (!userId && combo) {
                const typed = combo.getTypedValue().trim().toLowerCase();
                const exact = typed ? state.users.filter(u => String(u.name).toLowerCase() === typed) : [];
                if (exact.length === 1) userId = exact[0].id;
            }
        } else {
            userId = myId;
        }

        if (!userId) {
            errorDiv.textContent = 'Выберите сотрудника из списка';
            errorDiv.style.display = 'block';
            return;
        }

        if (!canEditUser(userId)) {
            errorDiv.textContent = 'Можно оформлять отпуска только себе';
            errorDiv.style.display = 'block';
            return;
        }

        const user = state.users.find(u => u.id === userId);
        if (!user) return;

        let userOverlap = false;
        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            const dStart = new Date(vac.startDate);
            const dEnd = new Date(vac.endDate);
            const yearStart = new Date(state.year, 0, 1);
            const vStart = Math.floor((dStart - yearStart) / (1000 * 3600 * 24)) + 1;
            const vEnd = Math.floor((dEnd - yearStart) / (1000 * 3600 * 24)) + 1;
            if (startIdx <= vEnd && endIdx >= vStart) userOverlap = true;
        });

        if (userOverlap) {
            errorDiv.textContent = `У сотрудника ${user.name} уже есть отпуск в этот период.`;
            errorDiv.style.display = 'block';
            return;
        }

        if (!user.vacations) user.vacations = [];
        user.vacations.push({
            id: `vacationid_${Date.now()}`,
            startDate: startStr,
            endDate: endStr
        });

        try {
            const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
            const { id, ...dataToSave } = user;
            await window.firestore.setDoc(docRef, dataToSave, { merge: true });

            closePopup();
            stateEvents.dispatchEvent(new Event('statechange'));

            logEvent({
                action: 'vacation.add',
                message: `Оформил отпуск ${startStr} — ${endStr} (${user.name})`,
                targetId: userId,
                targetName: user.name,
                details: { startDate: startStr, endDate: endStr }
            });

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            errorDiv.textContent = 'Ошибка при сохранении в базу данных.';
            errorDiv.style.display = 'block';
        }
    };
}