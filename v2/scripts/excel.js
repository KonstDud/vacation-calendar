// scripts/excel.js — обмен с Excel.
// Выгрузка НЕ генерирует файл с нуля, а подменяет в шаблоне блок данных (строки 4+).
// Поэтому ширины колонок, рамки, заливки, закрепление шапки и автофильтр
// остаются ровно такими, как в шаблоне templates/vacation-template.xlsx.

import { state } from './state.js';
import {
    getProfile, getEntitlement, isParentalLeave,
    formatOverDays, formatShortDays, toTemplateDate, composeFullName
} from './profile.js';
import { getCalendarDays } from './utils.js';

const TEMPLATE_URL = './templates/vacation-template.xlsx';
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

const FIRST_DATA_ROW = 4;
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

// Стили ячеек из шаблона (взяты из обычной строки с данными — 5-й в файле):
// A — ЮЛ, B–G — текст, H — табельный, I — дата приёма, J–M — числа,
// N/O — даты (serial), P/Q — примечание и «замещающий».
const CELL_STYLE = { A: 4, B: 5, C: 5, D: 5, E: 5, F: 5, G: 5, H: 15, I: 7, J: 4, K: 4, L: 4, M: 4, N: 8, O: 8, P: 10, Q: 10 };

// --- Ленивая загрузка JSZip: нужен только при экспорте/импорте ---
let jszipPromise = null;

export async function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
        jszipPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = JSZIP_URL;
            script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip не загрузился'));
            script.onerror = () => reject(new Error('Не удалось загрузить библиотеку для Excel'));
            document.head.appendChild(script);
        });
    }
    return jszipPromise;
}

export async function loadTemplateZip() {
    const JSZip = await loadJSZip();
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error('Не найден шаблон Excel (templates/vacation-template.xlsx)');
    return JSZip.loadAsync(await response.arrayBuffer());
}

// --- Мелкие хелперы ---

// В XML недопустимы управляющие символы, кроме \t \n \r
function cleanXmlText(value) {
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function escapeXml(value) {
    return cleanXmlText(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[ch]));
}

// dd.mm.yyyy → serial число, как в шаблоне (1 = 1900-01-01 по логике Excel)
export function toExcelSerial(isoDate) {
    const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(utc)) return null;
    return Math.round(utc / 86400000) + 25569;
}

// --- Сборка строк для листа ---

// Один сотрудник = столько строк, сколько у него отпусков (как в шаблоне).
// Нормы отпуска (J/K/L) — в первой строке сотрудника, примечание — тоже.
export function buildExportRows(users) {
    const rows = [];

    (users || []).forEach(user => {
        const profile = getProfile(user);

        const vacations = (user.vacations || [])
            .filter(v => v.startDate && v.endDate && v.endDate >= v.startDate)
            .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

        const totalDays = vacations.reduce((sum, v) => sum + getCalendarDays(v.startDate, v.endDate), 0);
        const entitlement = getEntitlement(profile);

        // Превышение/недостача — в примечание, формулировками как в шаблоне.
        // При отпуске по уходу за ребенком норму не считаем.
        let balanceNote = '';
        if (!isParentalLeave(profile) && entitlement > 0) {
            if (totalDays > entitlement) balanceNote = formatOverDays(totalDays - entitlement);
            else if (totalDays < entitlement) balanceNote = formatShortDays(entitlement - totalDays);
        }

        const note = [profile.note, balanceNote].filter(Boolean).join('; ');

        // В шаблон всегда уходит ФИО: «Фамилия Имя Отчество»
        const fullName = composeFullName(profile) || user.name;

        const base = {
            A: profile.legalEntity,
            B: profile.city,
            C: profile.department,
            D: profile.division,
            // Колонка E — только то, что заполнено в профиле; своих дополнений не делаем
            E: profile.direction,
            F: profile.position,
            G: fullName,
            H: profile.personnelNumber,
            I: toTemplateDate(profile.hireDate),
            Q: profile.substitute
        };

        if (vacations.length === 0) {
            rows.push({
                ...base,
                J: profile.annualDays,
                K: profile.northernDays,
                L: profile.irregularDays,
                M: null,
                N: null,
                O: null,
                P: note
            });
            return;
        }

        vacations.forEach((vacation, index) => {
            rows.push({
                ...base,
                J: index === 0 ? profile.annualDays : null,
                K: index === 0 ? profile.northernDays : null,
                L: index === 0 ? profile.irregularDays : null,
                M: getCalendarDays(vacation.startDate, vacation.endDate),
                N: toExcelSerial(vacation.startDate),
                O: toExcelSerial(vacation.endDate),
                P: index === 0 ? note : ''
            });
        });
    });

    return rows;
}

// Ячейка: числа — как числа, остальное — inline-строкой (чтобы не трогать sharedStrings)
function cellXml(column, rowNumber, value) {
    const ref = `${column}${rowNumber}`;
    const style = CELL_STYLE[column];

    if (value === null || value === undefined || value === '') {
        return `<c r="${ref}" s="${style}"/>`;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }

    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

export function buildRowsXml(rows) {
    return rows.map((row, index) => {
        const rowNumber = FIRST_DATA_ROW + index;
        const cells = COLUMNS.map(column => cellXml(column, rowNumber, row[column])).join('');
        return `<row r="${rowNumber}" spans="1:17" ht="39.6" x14ac:dyDescent="0.3">${cells}</row>`;
    }).join('');
}

// Подменяем только блок данных: всё до первой строки данных и всё после </sheetData> не трогаем
export function patchSheetXml(xml, rowsXml, lastRow, year) {
    const firstDataIndex = xml.indexOf(`<row r="${FIRST_DATA_ROW}"`);
    const sheetDataEnd = xml.indexOf('</sheetData>');

    if (firstDataIndex === -1 || sheetDataEnd === -1) {
        throw new Error('Неожиданная структура шаблона Excel');
    }

    let patched = xml.slice(0, firstDataIndex) + rowsXml + xml.slice(sheetDataEnd);

    patched = patched.replace(/<dimension ref="A1:Q\d+"\/>/, `<dimension ref="A1:Q${lastRow}"/>`);
    // автофильтр может быть как <autoFilter .../>, так и <autoFilter ...>...</autoFilter>
    // (внутри бывают filterColumn) — сохраняем исходную форму тега
    patched = patched.replace(/<autoFilter ref="A3:Q\d+"(\s*\/?>)/, (match, tail) => `<autoFilter ref="A3:Q${lastRow}"${tail}`);

    // Заголовок «ГРАФИК ОТПУСКОВ 2027 год» — меняем год (там неразрывный пробел)
    patched = patched.replace(
        /<c r="A1"[^>]*>[\s\S]*?<\/c>/,
        `<c r="A1" s="16" t="inlineStr"><is><t>ГРАФИК ОТПУСКОВ\u00a0${year} год</t></is></c>`
    );

    return patched;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Сколько периодов не попадёт в файл из-за ошибок в датах
export function countSkippedVacations(users) {
    return (users || []).reduce((sum, user) => sum + (user.vacations || [])
        .filter(v => !v.startDate || !v.endDate || v.endDate < v.startDate).length, 0);
}

// --- Публичная функция выгрузки ---

export async function exportToExcel(users) {
    const zip = await loadTemplateZip();

    const sheetFile = zip.file(SHEET_PATH);
    if (!sheetFile) throw new Error('В шаблоне не найден лист с графиком');

    // Выгружаем либо весь список, либо переданный набор (условия из окна выгрузки)
    const list = Array.isArray(users) ? users : state.users;

    const xml = await sheetFile.async('string');
    const rows = buildExportRows(list);
    const rowsXml = buildRowsXml(rows);
    const lastRow = Math.max(FIRST_DATA_ROW + rows.length - 1, 3);

    zip.file(SHEET_PATH, patchSheetXml(xml, rowsXml, lastRow, state.year));

    const blob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE'
    });

    downloadBlob(blob, `График отпусков на ${state.year} год.xlsx`);

    return { rows: rows.length, skipped: countSkippedVacations(list) };
}
