// scripts/calendar.js — v2

const months = {
    0: "Январь", 1: "Февраль", 2: "Март", 3: "Апрель",
    4: "Май", 5: "Июнь", 6: "Июль", 7: "Август",
    8: "Сентябрь", 9: "Октябрь", 10: "Ноябрь", 11: "Декабрь",
};

function createMonth(monthName) {
    const monthDiv = document.createElement("div");
    monthDiv.classList.add("calendar__month");
    const title = document.createElement("h2");
    title.classList.add("calendar__title");
    title.textContent = monthName;
    const area = document.createElement("div");
    area.classList.add("calendar__area");
    monthDiv.append(title, area);
    return monthDiv;
}

function createDay(dayNumber) {
    const dayDiv = document.createElement("div");
    dayDiv.classList.add("calendar__day");
    if (dayNumber !== "") dayDiv.textContent = dayNumber;
    return dayDiv;
}

export function renderCalendar(year, fromMonth = 0, toMonth = 11) {
    const calendarContainer = document.querySelector(".calendar");
    if (!calendarContainer) return;

    calendarContainer.innerHTML = '';
    const startDate = new Date(year, fromMonth, 1);
    const endDate = new Date(year, toMonth + 1, 0);

    drawCalendar(calendarContainer, startDate, endDate, year);

    fetch(`https://isdayoff.ru/api/getdata?year=${year}`, { signal: AbortSignal.timeout(3000) })
        .then(response => response.text())
        .then(data => applyHolidays(data.split("")))
        .catch(err => console.warn("API isdayoff.ru недоступен.", err));
}

// Номер дня в году: по нему строятся id ячеек (dayid_1 … dayid_365).
// Считаем через UTC, чтобы переход на летнее время не сдвигал нумерацию.
function dayOfYear(date, year) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((utc - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

function drawCalendar(container, startDate, endDate, year) {
    let currentMonthDiv = null;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayOfMonth = d.getDate();
        const monthNumber = d.getMonth();
        const dayOfWeek = d.getDay();

        if (dayOfMonth === 1) {
            currentMonthDiv = createMonth(months[monthNumber]);
            container.append(currentMonthDiv);

            // Сдвиг для первого дня (пустые ячейки)
            const startCol = dayOfWeek === 0 ? 7 : dayOfWeek;
            for (let i = 1; i < startCol; i++) {
                currentMonthDiv.querySelector(".calendar__area").append(createDay(""));
            }
        }

        const dayDiv = createDay(dayOfMonth);

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            dayDiv.classList.add("calendar__day_dayoff");
        }

        // id остаётся номером дня в году даже когда показаны не все месяцы
        dayDiv.id = `dayid_${dayOfYear(d, year)}`;

        currentMonthDiv.querySelector(".calendar__area").append(dayDiv);
    }

    window.dispatchEvent(new Event("calendarReady"));
}

function applyHolidays(prodCalList) {
    for (let i = 0; i < prodCalList.length; i++) {
        if (prodCalList[i] === "1") {
            const dayDiv = document.getElementById(`dayid_${i + 1}`);
            if (dayDiv && !dayDiv.classList.contains("calendar__day_dayoff")) {
                dayDiv.classList.add("calendar__day_dayoff");
            }
        }
    }
}