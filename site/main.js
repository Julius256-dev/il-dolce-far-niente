document.documentElement.classList.add("js");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Copy buttons: say what happened on the button itself.
for (const box of document.querySelectorAll("[data-copy]")) {
  const button = box.querySelector(".copy");
  const text = box.querySelector("code").textContent.trim();
  button.setAttribute("aria-label", `Copy: ${text}`);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      button.classList.add("done");
    } catch {
      button.textContent = "Select it";
    }
    setTimeout(() => { button.textContent = "Copy"; button.classList.remove("done"); }, 2000);
  });
}

// Install tabs, with arrow-key movement between tools.
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

// Sections ease in once as they reach the viewport.
const reveals = document.querySelectorAll(".reveal");
if (reduce || !("IntersectionObserver" in window)) {
  reveals.forEach((el) => el.classList.add("in"));
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.15 });
  reveals.forEach((el) => io.observe(el));
}

// The wave diagram plays the workflow: lanes advance in parallel, then land one at a time.
const diagram = document.querySelector("[data-diagram]");
if (diagram) {
  const lanes = [...diagram.querySelectorAll(".lane")];
  const funnel = [...diagram.querySelectorAll(".funnel path")];
  const state = diagram.querySelector("[data-state]");
  const landed = diagram.querySelector("[data-landed]");
  const bar = diagram.querySelector(".bar i");
  const main = diagram.querySelector(".merge-box.main");
  const stages = lanes.map((l) => [...l.querySelectorAll(".stage")]);

  const finalState = () => {
    stages.flat().forEach((s) => s.classList.add("on"));
    lanes.forEach((l) => l.classList.add("landed"));
    landed.textContent = "3";
    bar.style.width = "100%";
    main.classList.add("ready");
    state.textContent = "Ready for your review";
  };

  const reset = () => {
    stages.flat().forEach((s) => s.classList.remove("on", "active"));
    lanes.forEach((l) => l.classList.remove("landed"));
    funnel.forEach((f) => f.classList.remove("flow"));
    landed.textContent = "0";
    bar.style.width = "0";
    main.classList.remove("ready");
    state.textContent = "Building 3 features";
  };

  async function play() {
    reset();
    await wait(600);
    // Each lane advances on its own clock; they overlap like real parallel work.
    const speeds = [520, 680, 600];
    await Promise.all(stages.map(async (row, i) => {
      await wait(i * 260);
      for (const s of row) {
        s.classList.add("on", "active");
        await wait(speeds[i]);
        s.classList.remove("active");
      }
    }));
    state.textContent = "Landing one at a time";
    for (let i = 0; i < lanes.length; i += 1) {
      funnel[i].classList.add("flow");
      await wait(700);
      funnel[i].classList.remove("flow");
      lanes[i].classList.add("landed");
      landed.textContent = String(i + 1);
      bar.style.width = `${((i + 1) / lanes.length) * 100}%`;
    }
    await wait(300);
    main.classList.add("ready");
    state.textContent = "Ready for your review";
    await wait(3600);
  }

  if (reduce) finalState();
  else (async () => { await wait(900); for (;;) await play(); })();
}

// The terminal types the install command, then prints the installer's output.
const term = document.querySelector("[data-terminal]");
if (term) {
  const lines = [...term.querySelectorAll(".t-line")];
  const show = () => lines.forEach((l) => l.classList.add("shown"));
  if (reduce || !("IntersectionObserver" in window)) show();
  else {
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const [cmd, ...rest] = lines;
      const text = cmd.textContent;
      cmd.textContent = "";
      cmd.classList.add("shown", "typing");
      for (const ch of text) { cmd.textContent += ch; await wait(28); }
      await wait(350);
      cmd.classList.remove("typing");
      for (const l of rest) { l.classList.add("shown"); await wait(140); }
    }, { threshold: 0.4 });
    io.observe(term);
  }
}
