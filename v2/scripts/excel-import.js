// scripts/excel-import.js — загрузка графика из Excel.
//
// Читаем тот же шаблон (колонки A–Q, данные с 4-й строки) — подходит и исходный
// файл, и наш собственный выгрузной. Ничего не пишем в базу, пока не попросят:
// сначала разбор и предпросмотр, потом применение с автоснимком.

import { loadJSZip } from './excel.js';
import { state } from './state.js';
import { fromTemplateDate, splitFullName } from './profile.js';

const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const SHARED_PATH = 'xl/sharedStrings.xml';
const FIRST_DATA_ROW = 4;

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

// Автоматические пометки нашей выгрузки — обратно в профиль их не тянем
const AUTO_NOTE_RE = /(не хватает \d+ (?:день|дня|дней)|\d+ (?:день|дня|дней) лишн\w*|лишний 1 день|лишни[ех] \d+ дн\w*)/gi;

const decodeXml = (value) => String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

// Убираем из примечания наши автоматические пометки, чтобы они не попали в профиль
function stripAutoNotes(note) {
    return String(note || '')
        .replace(AUTO_NOTE_RE, '')
        .replace(/\s*;\s*;/g, ';')
        .replace(/^[\s;]+|[\s;]+$/g, '')
        .trim();
}

// --- разбор XML листа ---

function readSharedStrings(xml) {
    if (!xml) return [];

    const items = [];
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let match = siRe.exec(xml);

    while (match) {
        const texts = [];
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let textMatch = tRe.exec(match[1]);

        while (textMatch) {
            texts.push(decodeXml(textMatch[1]));
            textMatch = tRe.exec(match[1]);
        }

        items.push(texts.join(''));
        match = siRe.exec(xml);
    }

    return items;
}

// Число из Excel → ISO-дата
function serialToIso(serial) {
    const days = Number(serial);
    if (!Number.isFinite(days) || days <= 0) return '';

    const utc = Date.UTC(1899, 11, 30) + Math.round(days) * 86400000;
    const date = new Date(utc);
    const pad = (value) => String(value).padStart(2, '0');

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Дата может прийти числом (serial) или текстом дд.мм.гггг
function toIsoDate(raw, isNumeric) {
    const text = String(raw || '').trim();
    if (!text) return '';

    if (isNumeric) return serialToIso(text);

    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (iso.test(text)) return text;

    const template = fromTemplateDate(text);
    if (template) return template;

    const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (dotted) {
        const year = dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3];
        return `${year}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
    }

    return '';
}

// Строки листа: { rowNumber, hidden, cells: { A: {type, inner, sharedStrings}, ... } }
function readRows(xml, sharedStrings) {
    const rows = [];
    const rowRe = /<row([^>]*)>([\s\S]*?)<\/row>/g;
    let rowMatch = rowRe.exec(xml);

    while (rowMatch) {
        const attrs = rowMatch[1];
        const body = rowMatch[2];
        const rowNumber = Number((attrs.match(/r="(\d+)"/) || [])[1] || 0);
        const hidden = /hidden="(1|true)"/.test(attrs);

        const cells = {};
        const cellRe = /<c\s([^>]*?)(\/?)>/g;
        let cellMatch = cellRe.exec(body);

        while (cellMatch) {
            const cellAttrs = cellMatch[1] || '';
            const selfClosing = cellMatch[2] === '/';
            const ref = (cellAttrs.match(/r="([A-Z]+)\d+"/) || [])[1];
            const type = (cellAttrs.match(/t="([a-z]+)"/) || [])[1] || '';

            let inner = '';
            if (!selfClosing) {
                const end = body.indexOf('</c>', cellRe.lastIndex);
                inner = end === -1 ? '' : body.slice(cellRe.lastIndex, end);
                cellRe.lastIndex = end === -1 ? body.length : end + 4;
            }

            if (ref) cells[ref] = { type, inner, sharedStrings };
            cellMatch = cellRe.exec(body);
        }

        rows.push({ rowNumber, hidden, cells });
        rowMatch = rowRe.exec(xml);
    }

    return rows;
}

function cellText(cell) {
    if (!cell) return '';

    if (cell.type === 's') {
        const value = cell.inner.match(/<v>([\s\S]*?)<\/v>/);
        return value ? String((cell.sharedStrings || [])[Number(value[1])] ?? '') : '';
    }

    if (cell.type === 'inlineStr') {
        const texts = [];
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let match = tRe.exec(cell.inner);

        while (match) {
            texts.push(decodeXml(match[1]));
            match = tRe.exec(cell.inner);
        }

        return texts.join('');
    }

    const value = cell.inner.match(/<v>([\s\S]*?)<\/v>/);
    return value ? decodeXml(value[1]) : '';
}


// --- поля профиля и отпуск из строки ---

const PROFILE_COLUMNS = {
    A: 'legalEntity',
    B: 'city',
    C: 'department',
    D: 'division',
    E: 'direction',
    F: 'position',
    H: 'personnelNumber',
    I: 'hireDate',
    Q: 'substitute'
};

const NORM_COLUMNS = [['J', 'annualDays'], ['K', 'northernDays'], ['L', 'irregularDays']];

const isNumericCell = (cell) => !!cell && !cell.type;

function readVacation(row, sharedStrings) {
    const startCell = row.cells.N;
    const endCell = row.cells.O;

    const start = toIsoDate(cellText(startCell, sharedStrings).trim(), isNumericCell(startCell));
    const end = toIsoDate(cellText(endCell, sharedStrings).trim(), isNumericCell(endCell));

    if (!start && !end) return null;
    return { startDate: start || end, endDate: end || start };
}

function readProfileRow(row, sharedStrings, employee) {
    const read = (column) => cellText(row.cells[column], sharedStrings).trim();

    Object.entries(PROFILE_COLUMNS).forEach(([column, key]) => {
        const raw = read(column);
        if (!raw) return;

        if (key === 'hireDate') {
            const iso = toIsoDate(raw, isNumericCell(row.cells[column]));
            if (iso && !employee.profile[key]) employee.profile[key] = iso;
            return;
        }

        if (!employee.profile[key]) employee.profile[key] = raw;
    });

    NORM_COLUMNS.forEach(([column, key]) => {
        if (employee.profile[key] !== undefined) return;

        const raw = read(column).replace(',', '.');
        if (!raw) return;

        const number = Number(raw);
        if (Number.isFinite(number)) employee.profile[key] = Math.max(0, Math.round(number));
    });

    // Примечание: наши автоматические пометки («не хватает 9 дней») в профиль не переносим
    const note = stripAutoNotes(read('P'));
    if (note && !employee.profile.note) employee.profile.note = note;
}

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeName = (value) => String(value || '').trim().toLowerCase()
    .split(/\s+/).filter(Boolean).sort().join(' ');


// --- разбор файла ---

export async function parseImportFile(file) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(file);

    const sheetFile = zip.file(SHEET_PATH);
    if (!sheetFile) throw new Error('В файле не найден лист с графиком');

    const sharedFile = zip.file(SHARED_PATH);
    const sharedStrings = readSharedStrings(sharedFile ? await sharedFile.async('string') : '');
    const xml = await sheetFile.async('string');

    const rows = readRows(xml, sharedStrings).filter(row => row.rowNumber >= FIRST_DATA_ROW);

    const employees = [];
    const byKey = new Map();
    const skipped = [];
    let lastEmployee = null;
    let rowsWithData = 0;

    rows.forEach(row => {
        if (row.hidden) {
            skipped.push({ row: row.rowNumber, reason: 'строка скрыта в файле' });
            return;
        }

        const read = (column) => cellText(row.cells[column], sharedStrings).trim();
        const name = read('G');
        const personnelNumber = read('H');
        const vacation = readVacation(row, sharedStrings);
        const isContinuation = !name && lastEmployee;

        if (!name && !personnelNumber && !vacation) return;               // пустая строка
        if (!name && !isContinuation) {
            skipped.push({ row: row.rowNumber, reason: 'нет ФИО сотрудника' });
            return;
        }

        rowsWithData += 1;

        if (isContinuation) {
            if (vacation) lastEmployee.vacations.push(vacation);
            lastEmployee.rows.push(row.rowNumber);
            return;
        }

        const key = personnelNumber ? `pn:${normalizeKey(personnelNumber)}` : `name:${normalizeName(name)}`;
        let employee = byKey.get(key);

        if (!employee) {
            const parts = splitFullName(name);
            employee = {
                key,
                fullName: [parts.lastName, parts.firstName, parts.middleName].filter(Boolean).join(' ') || name,
                personnelNumber,
                rows: [],
                vacations: [],
                profile: {}
            };
            byKey.set(key, employee);
            employees.push(employee);
        }

        employee.rows.push(row.rowNumber);
        readProfileRow(row, sharedStrings, employee);

        if (vacation) employee.vacations.push(vacation);

        lastEmployee = employee;
    });

    // Повторы периодов убираем, порядок — по дате начала
    employees.forEach(employee => {
        const seen = new Set();
        employee.vacations = employee.vacations.filter(vacation => {
            const key = `${vacation.startDate}|${vacation.endDate}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        employee.vacations.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    });

    return { employees, skipped, rowsWithData };
}

// --- сопоставление с текущими сотрудниками ---

export function buildImportPlan(parsed, existingUsers) {
    const users = existingUsers || state.users || [];

    const byPersonnel = new Map();
    const byName = new Map();

    users.forEach(user => {
        const personnel = normalizeKey((user.profile || {}).personnelNumber);
        if (personnel) {
            if (!byPersonnel.has(personnel)) byPersonnel.set(personnel, []);
            byPersonnel.get(personnel).push(user);
        }

        const nameKey = normalizeName(user.name);
        if (nameKey) {
            if (!byName.has(nameKey)) byName.set(nameKey, []);
            byName.get(nameKey).push(user);
        }
    });

    const employees = [];
    const skipped = (parsed.skipped || []).slice();

    (parsed.employees || []).forEach(employee => {
        const personnel = normalizeKey(employee.personnelNumber);
        let matches = personnel ? (byPersonnel.get(personnel) || []) : [];

        // Табельного нет или по нему не нашли — пробуем по ФИО
        if (matches.length === 0) matches = byName.get(normalizeName(employee.fullName)) || [];

        // Под строку подходит несколько человек — молча ничего не меняем
        if (matches.length > 1) {
            skipped.push({
                row: employee.rows[0],
                reason: `подходит несколько сотрудников — «${employee.fullName}» пропущен`
            });
            return;
        }

        const existing = matches[0] || null;
        const invalid = employee.vacations.filter(v => !v.startDate || !v.endDate || v.endDate < v.startDate);
        const sameName = existing && normalizeName(existing.name) === normalizeName(employee.fullName);

        employees.push({
            fullName: employee.fullName,
            personnelNumber: employee.personnelNumber,
            profile: employee.profile,
            vacations: employee.vacations,
            rows: employee.rows,
            existingId: existing ? existing.id : null,
            existingName: existing ? existing.name : '',
            isNew: !existing,
            invalidCount: invalid.length,
            note: !existing ? 'новый сотрудник' : (sameName ? 'обновление' : `ФИО: «${existing.name}» → «${employee.fullName}»`)
        });
    });

    const vacationCount = employees.reduce((sum, item) => sum + item.vacations.length, 0);

    return {
        employees,
        skipped,
        stats: {
            rows: parsed.rowsWithData || 0,
            employees: employees.length,
            newCount: employees.filter(item => item.isNew).length,
            existingCount: employees.filter(item => !item.isNew).length,
            vacations: vacationCount,
            invalid: employees.reduce((sum, item) => sum + item.invalidCount, 0),
            skipped: skipped.length
        }
    };
}

// --- применение ---

const randomColor = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

/**
 * Записываем план в базу.
 * Отпуска найденных сотрудников ЗАМЕНЯЮТСЯ тем, что в файле;
 * профиль дополняется значениями из файла (пустые ячейки ничего не затирают).
 */
export async function applyImportPlan(plan, { onProgress } = {}) {
    const results = { created: 0, updated: 0, vacations: 0, profiles: 0 };
    const employees = plan.employees || [];

    for (let index = 0; index < employees.length; index += 1) {
        const item = employees[index];
        const existing = item.existingId ? state.users.find(user => user.id === item.existingId) : null;

        const profile = { ...((existing && existing.profile) || {}), ...item.profile };
        const vacations = (item.vacations || []).map((vacation, vacationIndex) => ({
            id: `imported_${Date.now()}_${index}_${vacationIndex}`,
            startDate: vacation.startDate,
            endDate: vacation.endDate
        }));

        if (existing) {
            const docRef = window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', existing.id);
            await window.firestore.setDoc(docRef, { name: item.fullName, profile, vacations }, { merge: true });

            existing.name = item.fullName;
            existing.profile = profile;
            existing.vacations = vacations;
            results.updated += 1;
        } else {
            const collectionRef = window.firestore.collection(window.db, 'vacationData_v2', String(state.year), 'users');
            const docRef = window.firestore.doc(collectionRef);

            const newUser = {
                name: item.fullName,
                color: randomColor(),
                vacations,
                order: Date.now() + index,
                isHidden: false,
                isVisible: true,
                groupId: '',
                profile
            };

            await window.firestore.setDoc(docRef, newUser);
            state.users = [...state.users, { id: docRef.id, ...newUser }];
            results.created += 1;
        }

        results.vacations += vacations.length;
        results.profiles += Object.keys(item.profile).length;

        if (onProgress) onProgress(index + 1, employees.length);
    }

    return results;
}
