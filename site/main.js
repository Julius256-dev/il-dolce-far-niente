// Copy the install command; announce the result on the button itself.
for (const box of document.querySelectorAll("[data-copy]")) {
  const button = box.querySelector(".copy");
  const text = box.querySelector("code").textContent.trim();
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}
