// scripts/user-chip.js — карточка вошедшего пользователя в правом верхнем углу

import { state } from './state.js';
import { getCurrentUserId, getCurrentUserName, getRoleLabel } from './auth.js';
import { getProfile } from './profile.js';
import { attachTip } from './tooltip.js';

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function getChipInfo() {
    const userId = getCurrentUserId();
    const user = userId ? state.users.find(item => item.id === userId) : null;
    const profile = user ? getProfile(user) : null;

    return {
        name: user ? user.name : (getCurrentUserName() || 'Администратор'),
        sub: (profile && profile.position) || getRoleLabel() || 'Сотрудник',
        color: (user && user.color) || '#10b981'
    };
}

export function updateUserChip() {
    const nameNode = document.getElementById('user-chip-name');
    const subNode = document.getElementById('user-chip-sub');
    const avatarNode = document.getElementById('user-chip-avatar');
    if (!nameNode || !subNode || !avatarNode) return;

    const info = getChipInfo();

    nameNode.textContent = info.name;
    subNode.textContent = info.sub;
    avatarNode.textContent = initialsOf(info.name);
    avatarNode.style.background = info.color;
}

export function initUserChip() {
    const chip = document.getElementById('btn-profile');
    if (chip) {
        // полное имя и должность тёмной подсказкой вместо обрезанного текста
        attachTip(chip, () => {
            const info = getChipInfo();
            return info.sub ? `${info.name} — ${info.sub}` : info.name;
        });
    }

    updateUserChip();
}
