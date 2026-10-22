// Copy buttons: say what happened on the button itself.
for (const box of document.querySelectorAll("[data-copy]")) {
  const button = box.querySelector(".copy");
  const text = box.querySelector("code").textContent.trim();
  button.setAttribute("aria-label", `Copy: ${text}`);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select it";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}

// Install tabs: arrow keys move between tools, as in any tab list.
const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => select(tab));
  tab.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    select(next);
    next.focus();
  });
});

// The board's status line follows the animation; without motion it starts finished.
const status = document.querySelector("[data-status]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (status) {
  if (reduce) status.textContent = "4 landed";
  else setTimeout(() => { status.textContent = "4 landed"; }, 4500);
}
