// scripts/groups.js
import { state, stateEvents, addGroup, updateGroup, deleteGroup } from './state.js';

export function initGroupsUI() {
    const popup = document.getElementById('groups-popup');
    const openBtn = document.getElementById('btn-manage-groups');
    const closeBtn = document.getElementById('groups-popup-close');
    const createBtn = document.getElementById('btn-create-group');
    const content = document.getElementById('groups-popup-content');

    let editingGroupId = null;

    const iconEye = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const iconEyeOff = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    const iconEdit = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
    const iconDelete = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

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
        const currentIsCollapsed = isEditing ? (groupToEdit.isCollapsed || false) : false;

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
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer;">
                <input type="checkbox" id="group-collapsed-input" ${currentIsCollapsed ? 'checked' : ''}>
                Свернуть сотрудников по умолчанию
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
        const collapsedInput = form.querySelector('#group-collapsed-input');
        nameInput.focus();

        nameInput.addEventListener('input', () => nameInput.style.borderColor = 'var(--border-color)');

        form.querySelector('#btn-save-group').addEventListener('click', async (e) => {
            const btn = e.target;
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const showIfEmpty = showEmptyInput.checked;
            const isCollapsed = collapsedInput.checked;

            if (!name) {
                nameInput.style.borderColor = 'var(--accent-red)';
                nameInput.focus();
                return;
            }

            btn.textContent = 'Сохранение...';
            btn.disabled = true;

            try {
                if (isEditing) {
                    await updateGroup(editingGroupId, { name, color, showIfEmpty, isCollapsed });
                } else {
                    await addGroup(name, color, showIfEmpty);
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
        createBtn.style.display = 'block';

        // ФИЛЬТРУЕМ "ungrouped", чтобы её нельзя было редактировать
        const visibleGroups = state.groups.filter(g => g.id !== 'ungrouped');

        if (visibleGroups.length === 0) {
            content.innerHTML = '<div style="color: var(--text-muted); font-size: 15px; text-align: center; padding: 32px 0;">Групп пока нет</div>';
            return;
        }

        const massAssignBtn = document.createElement('button');
        massAssignBtn.className = 'btn btn_small';
        massAssignBtn.textContent = 'Массовое назначение сотрудников';
        massAssignBtn.style.marginBottom = '12px';
        massAssignBtn.style.background = 'var(--accent-blue)';
        massAssignBtn.style.color = '#fff';
        massAssignBtn.style.border = 'none';
        massAssignBtn.addEventListener('click', renderMassAssignForm);
        content.appendChild(massAssignBtn);

        visibleGroups.forEach(group => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;';

            item.innerHTML = `
                <div style="width: 16px; height: 16px; border-radius: 50%; background: ${group.color}; flex-shrink: 0;"></div>
                <div style="flex: 1; font-weight: 500; font-size: 14px;">${group.name}</div>
                <button class="btn_icon toggle-visibility" title="${group.isVisible ? 'Скрыть с календаря' : 'Показать на календаре'}" style="color: ${group.isVisible ? 'var(--accent-green)' : 'var(--text-muted)'}">
                    ${group.isVisible ? iconEye : iconEyeOff}
                </button>
                <button class="btn_icon btn-edit-group" title="Редактировать">${iconEdit}</button>
                <button class="btn_icon btn-delete-group" title="Удалить" style="color: var(--accent-red);">${iconDelete}</button>
            `;

            item.querySelector('.toggle-visibility').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const newVisibility = !group.isVisible;
                btn.style.color = newVisibility ? 'var(--accent-green)' : 'var(--text-muted)';
                btn.innerHTML = newVisibility ? iconEye : iconEyeOff;
                await updateGroup(group.id, { isVisible: newVisibility });
            });

            item.querySelector('.btn-edit-group').addEventListener('click', () => { editingGroupId = group.id; renderForm(); });
            item.querySelector('.btn-delete-group').addEventListener('click', async () => {
                if (confirm(`Удалить группу "${group.name}"?`)) await deleteGroup(group.id);
            });

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
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button type="button" id="btn-mass-save" class="btn btn_add" style="flex: 1;">Переназначить</button>
                <button type="button" id="btn-mass-cancel" class="btn btn_small" style="flex: 1; margin-top: 0;">Отмена</button>
            </div>
        `;
        content.appendChild(form);

        form.querySelector('#btn-mass-cancel').addEventListener('click', () => {
            renderGroupsList();
        });

        form.querySelector('#btn-mass-save').addEventListener('click', async (e) => {
            const btn = e.target;
            const selectedGroupId = form.querySelector('#mass-group-select').value;
            const checkedBoxes = form.querySelectorAll('.mass-user-checkbox:checked');

            if (checkedBoxes.length === 0) {
                alert('Выберите хотя бы одного сотрудника');
                return;
            }

            btn.textContent = 'Сохранение...';
            btn.disabled = true;

            try {
                const promises = [];
                checkedBoxes.forEach(cb => {
                    const userId = cb.value;
                    const user = state.users.find(u => u.id === userId);
                    if (user) {
                        user.groupId = selectedGroupId;
                        const { id, ...dataToSave } = user;
                        const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
                        promises.push(window.firestore.setDoc(docRef, dataToSave, { merge: true }));
                    }
                });
                await Promise.all(promises);
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