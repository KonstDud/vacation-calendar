// scripts/utils.js

export const getCalendarDays = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    const start = new Date(startStr); const end = new Date(endStr);
    if (end < start) return 0;
    return Math.floor((end - start) / (1000 * 3600 * 24)) + 1;
};

export const getWorkingDays = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    let count = 0; const start = new Date(startStr); const end = new Date(endStr);
    if (end < start) return 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }
    return count;
};

export const validateInternalOverlap = (user, currentVacId) => {
    const vacs = user.vacations || [];
    const target = vacs.find(v => v.id === currentVacId);
    if (!target) return { isOverlap: false, isInvalid: false };
    if (target.startDate && target.endDate && target.endDate < target.startDate) return { isOverlap: false, isInvalid: true };

    const isOverlap = vacs.some(v => {
        if (v.id === currentVacId || !v.startDate || !v.endDate || !target.startDate || !target.endDate) return false;
        const vStart = parseInt(v.startDate.replace(/-/g, ''), 10); const vEnd = parseInt(v.endDate.replace(/-/g, ''), 10);
        const tStart = parseInt(target.startDate.replace(/-/g, ''), 10); const tEnd = parseInt(target.endDate.replace(/-/g, ''), 10);
        return tStart <= vEnd && vStart <= tEnd;
    });
    return { isOverlap, isInvalid: false };
};

export const getExternalOverlaps = (currentUser, currentVac, allUsers) => {
    if (!currentVac.startDate || !currentVac.endDate || currentVac.endDate < currentVac.startDate) return [];
    const tStart = parseInt(currentVac.startDate.replace(/-/g, ''), 10);
    const tEnd = parseInt(currentVac.endDate.replace(/-/g, ''), 10);
    const overlaps = [];
    allUsers.forEach(otherUser => {
        if (otherUser.id === currentUser.id || otherUser.isVisible === false) return;
        (otherUser.vacations || []).forEach(otherVac => {
            if (!otherVac.startDate || !otherVac.endDate) return;
            const oStart = parseInt(otherVac.startDate.replace(/-/g, ''), 10); const oEnd = parseInt(otherVac.endDate.replace(/-/g, ''), 10);
            if (tStart <= oEnd && oStart <= tEnd) {
                if (!overlaps.find(o => o.name === otherUser.name)) overlaps.push({ name: otherUser.name, color: otherUser.color });
            }
        });
    });
    return overlaps;
};

export const countDaysFromYearStart = (dateStr, year) => {
    if (!dateStr) return 0;
    const d = new Date(dateStr); const yearStart = new Date(year, 0, 1);
    return Math.floor((d - yearStart) / (1000 * 3600 * 24)) + 1;
};

export const getIconEye = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
export const getIconEyeOff = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
export const getIconWarning = () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
export const getIconDrag = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor: grab; opacity: 0.5;"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`;