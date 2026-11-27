// scripts/groups.js — настройки групп: личные переключатели всем, управление — админам
import { state, stateEvents, addGroup, updateGroup, deleteGroup } from './state.js';
import { getIconEdit, getIconTrash } from './utils.js';
import { isAdmin } from './auth.js';
import { logEvent } from './log.js';
import { isGroupHidden, setGroupHidden, isGroupCollapsed, setGroupCollapsed } from './view-prefs.js';

export function initGroupsUI() {
    const popup = document.getElementById('groups-popup');
    const openBtn = document.getElementById('btn-manage-groups');
    const closeBtn = document.getElementById('groups-popup-close');
    const createBtn = document.getElementById('btn-create-group');
    const content = document.getElementById('groups-popup-content');

    let editingGroupId = null;

    const iconEdit = getIconEdit();
    const iconDelete = getIconTrash();

    openBtn.addEventListener('click', () => {
        editingGroupId = null;
        popup.classList.add('popup_opened');
        renderGroupsList();
    });

    closeBtn.addEventListener('click', () => popup.classList.remove('popup_opened'));
    popup.addEventListener('mousedown', (e) => { if (e.target === popup) popup.classList.remove('popup_opened'); });

    createBtn.addEventListener('click', () => { editingGroupId = null; renderForm(); });

    function renderForm() {
        content.innerHTML = '';
        createBtn.style.display = 'none';

        const isEditing = !!editingGroupId;
        const groupToEdit = isEditing ? state.groups.find(g => g.id === editingGroupId) : null;
        const currentColor = isEditing ? groupToEdit.color : '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        const currentShowIfEmpty = isEditing ? (groupToEdit.showIfEmpty || false) : false;

        const form = document.createElement('div');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; background: var(--bg-main); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);';
        form.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: center;">
                <input type="color" id="group-color-input" value="${currentColor}" class="group-color-picker" style="margin-right: 4px;">
                <input type="text" id="group-name-input" class="form__date" placeholder="Название группы" value="${isEditing ? groupToEdit.name : ''}" style="font-size: 14px; padding: 10px; flex: 1; border-color: var(--border-color);">
            </div>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer;">
                <input type="checkbox" id="group-show-empty-input" ${currentShowIfEmpty ? 'checked' : ''}>
                Показывать в панели, если пустая
            </label>
            <div style="display: flex; gap: 8px;">
                <button type="button" id="btn-save-group" class="btn btn_add" style="flex: 1;">Сохранить</button>
                <button type="button" id="btn-cancel-group" class="btn btn_small" style="flex: 1; margin-top: 0;">Отмена</button>
            </div>
        `;
        content.appendChild(form);

        const nameInput = form.querySelector('#group-name-input');
        const colorInput = form.querySelector('#group-color-input');
        const showEmptyInput = form.querySelector('#group-show-empty-input');
        nameInput.focus();

        nameInput.addEventListener('input', () => nameInput.style.borderColor = 'var(--border-color)');

        form.querySelector('#btn-save-group').addEventListener('click', async (e) => {
            const btn = e.target;
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const showIfEmpty = showEmptyInput.checked;

            if (!name) {
                nameInput.style.borderColor = 'var(--accent-red)';
                nameInput.focus();
                return;
            }

            btn.textContent = 'Сохранение...';
            btn.disabled = true;

            try {
                if (isEditing) {
                    await updateGroup(editingGroupId, { name, color, showIfEmpty });
                    logEvent({
                        action: 'group.update',
                        message: `Изменил группу «${name}»`,
                        targetId: editingGroupId,
                        targetName: name,
                        details: { color, showIfEmpty: showIfEmpty ? 'да' : 'нет' }
                    });
                } else {
                    await addGroup(name, color, showIfEmpty);
                    logEvent({
                        action: 'group.add',
                        message: `Создал группу «${name}»`,
                        targetName: name,
                        details: { color }
                    });
                }
                editingGroupId = null;
                renderGroupsList();
            } catch (err) {
                console.error(err);
                btn.textContent = 'Ошибка!';
                btn.disabled = false;
            }
        });

        form.querySelector('#btn-cancel-group').addEventListener('click', () => {
            editingGroupId = null;
            renderGroupsList();
        });
    }

    function renderGroupsList() {
        content.innerHTML = '';

        const admin = isAdmin();
        createBtn.style.display = admin ? 'block' : 'none';

        const hint = document.createElement('div');
        hint.className = 'groups-hint';
        hint.textContent = admin
            ? 'Личные настройки: показывать группу на календаре и сворачивать карточки. Управление группами — тоже здесь.'
            : 'Ваши личные настройки: показывать ли группу на календаре и сворачивать ли карточки.';
        content.appendChild(hint);

        // «Без группы» не показываем — ей нельзя управлять
        const visibleGroups = state.groups.filter(g => g.id !== 'ungrouped');

        if (visibleGroups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'groups-empty';
            empty.textContent = 'Групп пока нет';
            content.appendChild(empty);
            return;
        }

        if (admin) {
            const massAssignBtn = document.createElement('button');
            massAssignBtn.className = 'btn btn_small';
            massAssignBtn.textContent = 'Массовое назначение сотрудников';
            massAssignBtn.style.marginBottom = '12px';
            massAssignBtn.style.background = 'var(--accent-blue)';
            massAssignBtn.style.color = '#fff';
            massAssignBtn.style.border = 'none';
            massAssignBtn.addEventListener('click', renderMassAssignForm);
            content.appendChild(massAssignBtn);
        }

        visibleGroups.forEach(group => {
            const item = document.createElement('div');
            item.className = 'groups-item';

            const groupHidden = isGroupHidden(group.id);
            const collapsed = isGroupCollapsed(group.id);

            item.innerHTML = `
                <div class="groups-item__head">
                    <div class="groups-item__dot" style="background: ${group.color};"></div>
                    <div class="groups-item__name">${group.name}</div>
                    ${admin ? `<button class="btn_icon btn-edit-group" title="Редактировать">${iconEdit}</button>` : ''}
                    ${admin ? `<button class="btn_icon btn-delete-group" title="Удалить" style="color: var(--accent-red);">${iconDelete}</button>` : ''}
                </div>
                <label class="groups-item__toggle">
                    <input type="checkbox" class="toggle-group-visible" ${groupHidden ? '' : 'checked'}>
                    <span>Показывать на календаре</span>
                </label>
                <label class="groups-item__toggle">
                    <input type="checkbox" class="toggle-group-collapsed" ${collapsed ? 'checked' : ''}>
                    <span>Сворачивать сотрудников по умолчанию</span>
                </label>
            `;

            item.querySelector('.toggle-group-visible').addEventListener('change', (e) => {
                setGroupHidden(group.id, !e.target.checked);
                stateEvents.dispatchEvent(new Event('statechange'));
            });

            item.querySelector('.toggle-group-collapsed').addEventListener('change', (e) => {
                setGroupCollapsed(group.id, e.target.checked);
                stateEvents.dispatchEvent(new Event('statechange'));
            });

            if (admin) {
                item.querySelector('.btn-edit-group').addEventListener('click', () => { editingGroupId = group.id; renderForm(); });
                item.querySelector('.btn-delete-group').addEventListener('click', async () => {
                    if (!confirm(`Удалить группу "${group.name}"?`)) return;

                    await deleteGroup(group.id);
                    logEvent({
                        action: 'group.delete',
                        level: 'warn',
                        message: `Удалил группу «${group.name}»`,
                        targetId: group.id,
                        targetName: group.name
                    });
                });
            }

            content.appendChild(item);
        });
    }

    function renderMassAssignForm() {
        content.innerHTML = '';
        createBtn.style.display = 'none';

        const form = document.createElement('div');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 12px; background: var(--bg-main); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);';

        let userListHtml = '';
        if (state.users.length === 0) {
            userListHtml = '<div style="color: var(--text-muted); font-size: 13px;">Нет сотрудников</div>';
        } else {
            state.users.forEach(u => {
                userListHtml += `
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer; padding: 4px 0;">
                        <input type="checkbox" class="mass-user-checkbox" value="${u.id}">
                        ${u.name}
                    </label>
                `;
            });
        }

        // В массовом назначении тоже исключаем ungrouped из списка групп, но оставляем опцию "Без группы"
        const realGroups = state.groups.filter(g => g.id !== 'ungrouped');

        form.innerHTML = `
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">Выберите сотрудников:</div>
            <div style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px;">
                ${userListHtml}
            </div>
            <div style="font-size: 14px; font-weight: 600; margin-top: 8px;">Назначить в группу:</div>
            <select id="mass-group-select" class="year-select" style="width: 100%;">
                <option value="">-- Без группы --</option>
                ${realGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
            <div id="mass-note" class="groups-mass-note"></div>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button type="button" id="btn-mass-save" class="btn btn_add" style="flex: 1;">Переназначить</button>
                <button type="button" id="btn-mass-cancel" class="btn btn_small" style="flex: 1; margin-top: 0;">Отмена</button>
            </div>
        `;
        content.appendChild(form);

        form.querySelector('#btn-mass-cancel').addEventListener('click', () => {
            renderGroupsList();
        });

        // Подсказка: сколько выбранных уже сидят в целевой группе
        const noteEl = form.querySelector('#mass-note');
        const selectedUsers = () => [...form.querySelectorAll('.mass-user-checkbox:checked')]
            .map(cb => state.users.find(u => u.id === cb.value))
            .filter(Boolean);

        const describeMass = () => {
            const targetId = form.querySelector('#mass-group-select').value;
            const checked = selectedUsers();
            const already = checked.filter(u => (u.groupId || '') === targetId).length;

            noteEl.className = 'groups-mass-note';

            if (checked.length === 0) {
                noteEl.textContent = '';
                return;
            }

            if (already === checked.length) {
                noteEl.className = 'groups-mass-note groups-mass-note_error';
                noteEl.textContent = `Все выбранные уже в этой группе (${already}) — переназначать нечего`;
                return;
            }

            noteEl.textContent = already > 0 ? `Уже в этой группе: ${already} — их не тронем` : '';
        };

        form.addEventListener('change', describeMass);
        describeMass();

        form.querySelector('#btn-mass-save').addEventListener('click', async (e) => {
            const btn = e.target;
            const targetGroupId = form.querySelector('#mass-group-select').value;
            const checked = selectedUsers();

            if (checked.length === 0) {
                alert('Выберите хотя бы одного сотрудника');
                return;
            }

            // Переназначаем только тех, кто ещё не в этой группе
            const toMove = checked.filter(u => (u.groupId || '') !== targetGroupId);
            if (toMove.length === 0) {
                describeMass();
                alert('Все выбранные сотрудники уже в этой группе');
                return;
            }

            btn.textContent = 'Сохранение...';
            btn.disabled = true;

            try {
                await Promise.all(toMove.map(user => {
                    user.groupId = targetGroupId;
                    const { id, ...dataToSave } = user;
                    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", user.id);
                    return window.firestore.setDoc(docRef, dataToSave, { merge: true });
                }));

                const skipped = checked.length - toMove.length;
                if (skipped > 0) alert(`Переназначено: ${toMove.length}. Уже были в группе: ${skipped}.`);

                const targetName = state.groups.find(g => g.id === targetGroupId);
                logEvent({
                    action: 'group.mass',
                    level: 'warn',
                    message: `Переназначил сотрудников (${toMove.length}) в группу «${targetName ? targetName.name : targetGroupId}»`,
                    targetId: targetGroupId,
                    targetName: targetName ? targetName.name : '',
                    details: { moved: toMove.length, skipped }
                });

                renderGroupsList();
            } catch (err) {
                console.error(err);
                btn.textContent = 'Ошибка!';
                btn.disabled = false;
            }
        });
    }

    stateEvents.addEventListener('statechange', () => {
        if (popup.classList.contains('popup_opened')) {
            if (!document.getElementById('group-name-input') && !document.getElementById('mass-group-select')) renderGroupsList();
        }
    });
}