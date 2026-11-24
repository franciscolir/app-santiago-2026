const supportsServiceWorker = "serviceWorker" in navigator;
const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);

if (supportsServiceWorker && (window.isSecureContext || isLocalDevelopment)) {
  const registerServiceWorker = async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (error) {
      console.warn("PWA: no se pudo registrar el service worker:", error);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("load", registerServiceWorker, { once: true });
  } else {
    registerServiceWorker();
  }
}
