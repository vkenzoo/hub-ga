// UTM Capture - cole este snippet em todas as suas landing pages,
// idealmente antes do botão de checkout do Assiny.
//
// O que faz:
//   1. Pega utm_source/medium/campaign/content/term da URL.
//   2. Grava em cookie + localStorage (válidos por 30 dias).
//   3. Substitui automaticamente links para o Assiny incluindo as UTMs.
//
// Como usar:
//   <script src="https://seu-dominio.com/utm-capture.js" defer></script>

(function () {
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var STORAGE_KEY = "hub_utm";
  var TTL_DAYS = 30;

  function readUrl() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function (k) {
        var v = params.get(k);
        if (v) out[k] = v;
      });
    } catch (e) {}
    return out;
  }

  function readStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      var expires = new Date(Date.now() + TTL_DAYS * 86400000).toUTCString();
      document.cookie = STORAGE_KEY + "=" + encodeURIComponent(JSON.stringify(data)) +
        "; path=/; expires=" + expires + "; SameSite=Lax";
    } catch (e) {}
  }

  function getUtms() {
    var fresh = readUrl();
    if (Object.keys(fresh).length > 0) {
      writeStorage(fresh);
      return fresh;
    }
    return readStorage();
  }

  function appendToLinks(utms) {
    if (Object.keys(utms).length === 0) return;
    var anchors = document.querySelectorAll("a[href]");
    anchors.forEach(function (a) {
      try {
        var url = new URL(a.href);
        // Só anexa em links de checkout do Assiny.
        if (!/assiny\./i.test(url.hostname)) return;
        UTM_KEYS.forEach(function (k) {
          if (utms[k] && !url.searchParams.has(k)) url.searchParams.set(k, utms[k]);
        });
        a.href = url.toString();
      } catch (e) {}
    });
  }

  function run() {
    var utms = getUtms();
    appendToLinks(utms);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
