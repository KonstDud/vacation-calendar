// scripts/calendar.js — v2 (Мгновенная отрисовка + подгрузка праздников)

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

    // 1. СРАЗУ рисуем календарь (мгновенно, без ожидания сети)
    drawCalendar(calendarContainer, startDate, endDate);

    // Сообщаем app.js, что сетка готова (чтобы он нарисовал отпуска)
    window.dispatchEvent(new Event("calendarReady"));

    // 2. Асинхронно пытаемся получить праздники, чтобы покрасить их красным
    fetch(`https://isdayoff.ru/api/getdata?year=${year}`, { signal: AbortSignal.timeout(3000) })
        .then(response => {
            if (!response.ok) throw new Error("Network response was not ok");
            return response.text();
        })
        .then(data => {
            const prodCalList = data.split("");
            applyHolidays(prodCalList);
        })
        .catch(err => {
            console.warn("API isdayoff.ru недоступен или включен VPN. Оставляем только выходные.", err);
        });
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

            // Сдвиг для первого дня месяца (чтобы не было пустых ячеек)
            // В нашем сеточном CSS (grid) пустые ячейки не ломают сетку, но лучше их не создавать
            const emptyDays = dayOfWeek > 0 ? dayOfWeek - 1 : 6;
            for (let i = 0; i < emptyDays; i++) {
                const emptyDiv = document.createElement("div");
                emptyDiv.classList.add("calendar__day");
                currentMonthDiv.querySelector(".calendar__area").append(emptyDiv);
            }
        }

        const dayDiv = createDay(dayOfMonth);

        // Красим выходные (Сб = 6, Вс = 0)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            dayDiv.classList.add("calendar__day_dayoff");
        }

        dayDiv.id = `dayid_${dayIndex + 1}`;
        currentMonthDiv.querySelector(".calendar__area").append(dayDiv);
        dayIndex++;
    }
}

// Функция для применения праздников из API (когда они подгрузятся)
function applyHolidays(prodCalList) {
    // prodCalList — это массив строк "0" и "1"
    for (let i = 0; i < prodCalList.length; i++) {
        if (prodCalList[i] === "1") {
            const dayDiv = document.getElementById(`dayid_${i + 1}`);
            if (dayDiv && !dayDiv.classList.contains("calendar__day_dayoff")) {
                dayDiv.classList.add("calendar__day_dayoff");
            }
        }
    }
}