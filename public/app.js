(function theme() {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const saved = localStorage.getItem("theme");
  if (saved) root.setAttribute("data-theme", saved);
  if (!btn) return;

  btn.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", current);
    localStorage.setItem("theme", current);
  });
})();

document.querySelectorAll("[data-countdown]").forEach((el) => {
  const end = new Date(el.getAttribute("data-countdown"));
  const tick = () => {
    const diff = end - new Date();
    if (diff <= 0) {
      el.textContent = "Голосование завершено";
      return;
    }
    const h = Math.floor(diff / 1000 / 60 / 60);
    const m = Math.floor((diff / 1000 / 60) % 60);
    const s = Math.floor((diff / 1000) % 60);
    el.textContent = `${h}ч ${m}м ${s}с`;
    requestAnimationFrame(() => setTimeout(tick, 1000));
  };
  tick();
});

const addOptionBtn = document.getElementById("add-option");
if (addOptionBtn) {
  addOptionBtn.addEventListener("click", () => {
    const wrap = document.getElementById("options-wrap");
    const input = document.createElement("input");
    input.type = "text";
    input.name = "options";
    input.placeholder = "Еще вариант ответа";
    wrap.appendChild(input);
  });
}

