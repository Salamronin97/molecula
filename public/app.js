(function uiSettings() {
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme-toggle");
  const langBtn = document.getElementById("lang-toggle");

  const dict = {
    ru: {
      home: "Главная",
      requisites: "Реквизиты",
      polls: "Опросы",
      create_poll: "Создать опрос",
      theme: "Тема",
      profile: "Кабинет",
      admin: "Админ",
      logout: "Выйти",
      login: "Вход",
      register: "Регистрация",
      landing_hint: "Нажмите на название, чтобы открыть раздел Разное."
    },
    en: {
      home: "Home",
      requisites: "Author",
      polls: "Polls",
      create_poll: "Create poll",
      theme: "Theme",
      profile: "Profile",
      admin: "Admin",
      logout: "Logout",
      login: "Login",
      register: "Sign up",
      landing_hint: "Click the title to open General section."
    }
  };

  function applyTranslations() {
    const lang = root.getAttribute("lang") === "en" ? "en" : "ru";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[lang][key]) el.textContent = dict[lang][key];
    });
    if (langBtn) langBtn.textContent = lang.toUpperCase();
  }

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
      applyTranslations();
    });
  }

  applyTranslations();
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
    el.textContent = days > 0 ? `${days}д ${hours}ч ${minutes}м` : `${hours}ч ${minutes}м ${seconds}с`;
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
