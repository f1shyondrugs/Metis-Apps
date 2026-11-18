import { mountOnboardingMotion } from "./onboarding-motion.js";

if (new URLSearchParams(location.search).get("phase") === "opening") {
  document.title = "Opening Metis";
  document.getElementById("heading").textContent = "Opening Metis";
  document.getElementById("description").textContent = "The update is installed. Please wait while Metis starts.";
}
const stop = mountOnboardingMotion(document.getElementById("motion"));
window.addEventListener("pagehide", stop, { once: true });
