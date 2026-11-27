// scripts/excel-import.js — загрузка графика из Excel.
//
// Читаем тот же шаблон (колонки A–Q, данные с 4-й строки) — подходит и исходный
// файл, и наш собственный выгрузной. Ничего не пишем в базу, пока не попросят:
// сначала разбор и предпросмотр, потом применение с автоснимком.

import { loadJSZip } from './excel.js';
import { state, addGroup } from './state.js';
import { fromTemplateDate, splitFullName } from './profile.js';

const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const SHARED_PATH = 'xl/sharedStrings.xml';
const FIRST_DATA_ROW = 4;

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

// Автоматические пометки нашей выгрузки — обратно в профиль их не тянем
const AUTO_NOTE_RE = /(не хватает \d+ (?:день|дня|дней)|\d+ (?:день|дня|дней) лишн\w*|лишний 1 день|лишни[ех] \d+ дн\w*)/gi;

const decodeXml = (value) => String(value || '')
    // числовые ссылки вида &#1054; — так Excel пишет кириллицу
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCharCode(parseInt(code, 16)))
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

// Ячейки строки. Разбираем по частям (split по </c>), а не одной регуляркой:
// так одинаково работают и <c .../> (пустые), и <c ...><is><t>текст</t></is></c>.
function parseRowCells(body, sharedStrings, cells) {
    body.split('</c>').forEach(part => {
        let cursor = 0;

        while (cursor < part.length) {
            const openIndex = part.indexOf('<c ', cursor);
            if (openIndex === -1) break;

            const openEnd = part.indexOf('>', openIndex);
            if (openEnd === -1) break;

            const attrs = part.slice(openIndex + 2, openEnd);
            const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
            // тип бывает и inlineStr (с заглавной S), поэтому буквы любые
            const type = (attrs.match(/t="([A-Za-z]+)"/) || [])[1] || '';
            const selfClosing = attrs.trim().endsWith('/');

            if (ref) {
                const nextOpen = part.indexOf('<c ', openEnd);
                const inner = selfClosing ? '' : part.slice(openEnd + 1, nextOpen === -1 ? part.length : nextOpen);
                cells[ref] = { type, inner, sharedStrings };
            }

            cursor = openEnd + 1;
        }
    });
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
        if (body.includes('<c ')) parseRowCells(body, sharedStrings, cells);

        rows.push({ rowNumber, hidden, cells });
        rowMatch = rowRe.exec(xml);
    }

    return rows;
}

// Автофильтр из файла: Excel хранит только критерии, поэтому читаем их
// и берём строки, которые под них подходят (простые списки значений).
function readAutoFilter(xml) {
    const match = xml.match(/<autoFilter[^>]*>([\s\S]*?)<\/autoFilter>/);
    if (!match) return { filters: [], unsupported: false };

    const filters = [];
    let unsupported = false;

    const columnRe = /<filterColumn([^>]*)>([\s\S]*?)<\/filterColumn>/g;
    let columnMatch = columnRe.exec(match[1]);

    while (columnMatch) {
        const colId = Number((columnMatch[1].match(/colId="(\d+)"/) || [])[1] || 0);
        const body = columnMatch[2];

        const values = [];
        const valueRe = /<filter\s+val="([^"]*)"/g;
        let valueMatch = valueRe.exec(body);

        while (valueMatch) {
            values.push(decodeXml(valueMatch[1]));
            valueMatch = valueRe.exec(body);
        }

        if (values.length === 0) unsupported = true;     // customFilters и top10 не разбираем
        filters.push({ column: COLUMNS[colId], values });
        columnMatch = columnRe.exec(match[1]);
    }

    return { filters, unsupported };
}

function rowMatchesFilter(row, filter, sharedStrings) {
    if (!filter || filter.filters.length === 0) return true;

    return filter.filters.every(item => {
        if (item.values.length === 0) return true;

        const value = cellText(row.cells[item.column]).trim();
        return item.values.some(expected => expected === value);
    });
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

// Числовая ячейка: тип либо не указан, либо «n» (Excel пишет явный t="n")
const isNumericCell = (cell) => !!cell && (cell.type === '' || cell.type === 'n');

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

    const allRows = readRows(xml, sharedStrings);
    const rows = allRows.filter(row => row.rowNumber >= FIRST_DATA_ROW);
    const fileFilter = readAutoFilter(xml);

    // Названия колонок из шапки (строка 3) — чтобы подписи в предпросмотре были понятными
    const headerRow = allRows.find(row => row.rowNumber === FIRST_DATA_ROW - 1);
    const headerNames = {};
    if (headerRow) {
        COLUMNS.forEach(column => {
            const text = cellText(headerRow.cells[column]).replace(/\s+/g, ' ').trim();
            if (text) headerNames[column] = text;
        });
    }

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

        // Если в файле включён автофильтр — берём только подходящие строки
        if (!rowMatchesFilter(row, fileFilter, sharedStrings)) {
            skipped.push({ row: row.rowNumber, reason: 'не подходит под фильтр в файле' });
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

    return { employees, skipped, rowsWithData, filter: fileFilter, headerNames };
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
        const groupName = resolveGroupName(employee.profile.position, employee.profile.division);
        const baseNote = !existing ? 'новый сотрудник' : (sameName ? 'обновление' : `ФИО: «${existing.name}» → «${employee.fullName}»`);

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
            groupName,
            note: groupName ? `${baseNote} · группа: ${groupName}` : baseNote
        });
    });

    const vacationCount = employees.reduce((sum, item) => sum + item.vacations.length, 0);
    const filter = parsed.filter || { filters: [], unsupported: false };

    // Каких групп ещё нет — их создадим при импорте
    const knownGroups = new Set((state.groups || []).map(group => String(group.name || '').toLowerCase()));
    const newGroups = [...new Set(employees.map(item => item.groupName).filter(Boolean))]
        .filter(name => !knownGroups.has(name.toLowerCase()));
    const headerNames = parsed.headerNames || {};
    const filterNote = filter.filters.length > 0
        ? 'Загружаем только строки, отобранные фильтром в файле: ' + filter.filters
            .map(item => `${headerNames[item.column] || `колонка ${item.column}`} — ${item.values.join(', ')}`)
            .join('; ')
        : '';

    return {
        employees,
        skipped,
        filterNote,
        newGroups,
        stats: {
            rows: parsed.rowsWithData || 0,
            employees: employees.length,
            newCount: employees.filter(item => item.isNew).length,
            existingCount: employees.filter(item => !item.isNew).length,
            vacations: vacationCount,
            invalid: employees.reduce((sum, item) => sum + item.invalidCount, 0),
            groups: newGroups.length,
            skipped: skipped.length
        }
    };
}

// --- должность → группа ---

// Порядок правил важен: «инженер-тестировщик» должен попасть к тестировщикам,
// а не к инженерам, поэтому проверяем от более specific к общему.
const GROUP_RULES = [
    { keywords: ['тестиров', 'qa'], group: 'Тестировщики' },
    { keywords: ['аналит'], group: 'Аналитики' },
    { keywords: ['программист', 'разработ'], group: 'Разработчики' },
    { keywords: ['дизайн'], group: 'Дизайнеры' },
    { keywords: ['инженер'], group: 'Инженеры' }
];

function matchGroupRule(text) {
    const source = String(text || '').toLowerCase();
    if (!source) return '';

    const rule = GROUP_RULES.find(item => item.keywords.some(keyword => source.includes(keyword)));
    return rule ? rule.group : '';
}

// Сначала пробуем по должности, и только если не поняли — по отделу
export function resolveGroupName(position, division) {
    return matchGroupRule(position) || matchGroupRule(division);
}

// --- применение ---

// --- цвета: подбираем заметно отличающиеся ---

function hslToHex(hue, saturation, lightness) {
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = lightness - c / 2;

    let rgb = [c, x, 0];
    if (hue >= 60 && hue < 120) rgb = [x, c, 0];
    else if (hue >= 120 && hue < 180) rgb = [0, c, x];
    else if (hue >= 180 && hue < 240) rgb = [0, x, c];
    else if (hue >= 240 && hue < 300) rgb = [x, 0, c];
    else if (hue >= 300) rgb = [c, 0, x];

    return '#' + rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!match) return null;

    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function colorDistance(first, second) {
    const a = hexToRgb(first);
    const b = hexToRgb(second);
    if (!a || !b) return 999;

    return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

// Берём цвет из палитры, максимально далёкий от уже занятых —
// чтобы у импортированных сотрудников цвета были разные и не сливались
function pickImportColor(usedColors) {
    const candidates = [];
    for (let hue = 0; hue < 360; hue += 24) {
        candidates.push(hslToHex(hue, 0.62, 0.55));
        candidates.push(hslToHex((hue + 12) % 360, 0.5, 0.42));
    }

    if (usedColors.length === 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    let best = candidates[0];
    let bestScore = -1;

    candidates.forEach(candidate => {
        const nearest = Math.min(...usedColors.map(used => colorDistance(candidate, used)));
        const score = nearest + Math.random() * 8;
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    });

    return best;
}

/**
 * Записываем план в базу.
 * Отпуска найденных сотрудников ЗАМЕНЯЮТСЯ тем, что в файле;
 * профиль дополняется значениями из файла (пустые ячейки ничего не затирают).
 * Импортированные сотрудники идут по алфавиту.
 */
export async function applyImportPlan(plan, { onProgress } = {}) {
    const results = { created: 0, updated: 0, vacations: 0, profiles: 0, groupsCreated: 0, groupNames: [] };

    const usedColors = (state.users || []).map(user => user.color).filter(Boolean);
    const employees = (plan.employees || []).slice()
        .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'ru'));

    // Группы: находим существующую по имени или создаём новую
    const groupByName = new Map((state.groups || []).map(group => [String(group.name || '').toLowerCase(), group]));
    const groupColors = (state.groups || []).map(group => group.color).filter(Boolean);
    const createdGroups = [];

    const groupIdFor = async (name) => {
        if (!name) return '';

        const found = groupByName.get(name.toLowerCase());
        if (found) return found.id;

        const color = pickImportColor(groupColors);
        groupColors.push(color);

        const id = await addGroup(name, color, false);
        if (!id) return '';

        const created = { id, name, color, order: Date.now() };
        groupByName.set(name.toLowerCase(), created);
        state.groups = [...state.groups, created];
        createdGroups.push(created);

        return id;
    };

    // Импортированные ставим отдельным алфавитным блоком
    const baseOrder = 1000000;

    for (let index = 0; index < employees.length; index += 1) {
        const item = employees[index];
        const existing = item.existingId ? state.users.find(user => user.id === item.existingId) : null;
        const order = baseOrder + index * 10;
        const targetGroupId = await groupIdFor(item.groupName);

        const profile = { ...((existing && existing.profile) || {}), ...item.profile };
        const vacations = (item.vacations || []).map((vacation, vacationIndex) => ({
            id: `imported_${Date.now()}_${index}_${vacationIndex}`,
            startDate: vacation.startDate,
            endDate: vacation.endDate
        }));

        if (existing) {
            const docRef = window.firestore.doc(window.db, 'vacationData_v2', String(state.year), 'users', existing.id);
            const payload = { name: item.fullName, profile, vacations, order };
            if (targetGroupId) payload.groupId = targetGroupId;

            await window.firestore.setDoc(docRef, payload, { merge: true });

            existing.name = item.fullName;
            existing.profile = profile;
            existing.vacations = vacations;
            existing.order = order;
            if (targetGroupId) existing.groupId = targetGroupId;
            results.updated += 1;
        } else {
            const collectionRef = window.firestore.collection(window.db, 'vacationData_v2', String(state.year), 'users');
            const docRef = window.firestore.doc(collectionRef);

            const color = pickImportColor(usedColors);
            usedColors.push(color);

            const newUser = {
                name: item.fullName,
                color,
                vacations,
                order,
                isHidden: false,
                isVisible: true,
                groupId: targetGroupId || '',
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

    results.groupsCreated = createdGroups.length;
    results.groupNames = createdGroups.map(group => group.name);

    return results;
}
