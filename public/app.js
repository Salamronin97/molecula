(function uiSettings() {
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme-toggle");
  const langBtn = document.getElementById("lang-toggle");

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  }

  if (langBtn) {
    langBtn.addEventListener("click", () => {
      const next = root.getAttribute("lang") === "ru" ? "en" : "ru";
      root.setAttribute("lang", next);
      localStorage.setItem("lang", next);
      langBtn.textContent = next === "ru" ? "Язык" : "Lang";
    });
    langBtn.textContent = root.getAttribute("lang") === "ru" ? "Язык" : "Lang";
  }
})();

document.querySelectorAll("[data-countdown]").forEach((el) => {
  const end = new Date(el.getAttribute("data-countdown"));
  const tick = () => {
    const diff = end.getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = "Завершено";
      return;
    }
    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      el.textContent = `${days}д ${hours}ч ${minutes}м`;
    } else {
      el.textContent = `${hours}ч ${minutes}м ${seconds}с`;
    }

    setTimeout(tick, 1000);
  };
  tick();
});

const addOptionBtn = document.getElementById("add-option");
if (addOptionBtn) {
  addOptionBtn.addEventListener("click", () => {
    const wrap = document.getElementById("options-wrap");
    const count = wrap.querySelectorAll("input[name='options']").length + 1;

    const line = document.createElement("div");
    line.className = "form-line";

    const label = document.createElement("label");
    label.textContent = `Вариант ${count}`;

    const input = document.createElement("input");
    input.type = "text";
    input.name = "options";
    input.required = true;

    line.appendChild(label);
    line.appendChild(input);
    wrap.appendChild(line);
  });
}
