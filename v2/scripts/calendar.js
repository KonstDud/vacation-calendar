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

export function renderCalendar(year) {
    const calendarContainer = document.querySelector(".calendar");
    if (!calendarContainer) return;

    calendarContainer.innerHTML = '';
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    drawCalendar(calendarContainer, startDate, endDate);

    fetch(`https://isdayoff.ru/api/getdata?year=${year}`, { signal: AbortSignal.timeout(3000) })
        .then(response => response.text())
        .then(data => applyHolidays(data.split("")))
        .catch(err => console.warn("API isdayoff.ru недоступен.", err));
}

function drawCalendar(container, startDate, endDate) {
    let dayIndex = 0;
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

        dayDiv.id = `dayid_${dayIndex + 1}`;

        currentMonthDiv.querySelector(".calendar__area").append(dayDiv);
        dayIndex++;
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