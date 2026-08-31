const IMPORT_ENDPOINT = "https://app.nxrs.tech/api/extension/import-session";

const PLATFORM_DOMAINS = {
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
};

// Where each platform reliably shows the CURRENTLY logged-in user's own
// name/handle without needing to visit their specific profile URL (which
// this extension doesn't know) -- the feed/home page's own nav always
// renders it for whoever is logged in.
const DETECT_URLS = {
  linkedin: "https://www.linkedin.com/feed/",
  instagram: "https://www.instagram.com/",
};

// Extracted via chrome.scripting.executeScript, so this runs IN the
// LinkedIn/Instagram page's own context, not this popup's. Multiple
// fallback selectors per platform -- LIVE-VERIFIED 2026-08-31 against
// both real sites, but a page-structure change on either site's end is
// exactly the fragility this whole approach trades off deliberately (see
// the confirmation checkbox below, which is what makes a failed/wrong
// detection here non-fatal rather than silently sending the wrong
// account).
function extractAccountName(platform) {
  if (platform === "linkedin") {
    const selectors = [
      'button[id^="ember"] .global-nav__me-photo', // photo alt text
      ".global-nav__me-photo",
      'a[href*="/in/"] img.global-nav__me-photo',
      ".feed-identity-module__actor-meta a",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.alt?.trim()) return el.alt.trim();
    }
    // Fall back to the "Me" dropdown trigger's own accessible text, which
    // LinkedIn renders as "<Name>'s profile & activity" or similar.
    const meButton = document.querySelector('button[aria-label*="profile"]');
    if (meButton) {
      const label = meButton.getAttribute("aria-label") || "";
      const match = label.match(/^(.+?)'s profile/);
      if (match) return match[1].trim();
    }
    return null;
  }
  if (platform === "instagram") {
    // Instagram's own nav doesn't render the display name in plain text
    // (avatar + profile link only) -- the profile link's href IS the
    // logged-in user's @username, which is exactly the identifying
    // information needed here.
    const profileLink = document.querySelector('a[href^="/"][role="link"] img[alt*="profile picture"]');
    if (profileLink) {
      const alt = profileLink.alt || "";
      const match = alt.match(/^(.+?)'s profile picture/);
      if (match) return match[1].trim();
    }
    return null;
  }
  return null;
}

const platformSelect = document.getElementById("platform");
const codeInput = document.getElementById("code");
const confirmCheckbox = document.getElementById("confirm");
const detectBox = document.getElementById("detectBox");
const connectButton = document.getElementById("connect");
const statusEl = document.getElementById("status");

function showStatus(kind, text) {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function setDetectBox(state, text) {
  detectBox.className = `detect-box ${state}`;
  detectBox.textContent = text;
}

function updateConnectButtonState() {
  connectButton.disabled = !confirmCheckbox.checked;
}

confirmCheckbox.addEventListener("change", updateConnectButtonState);

// Opens the platform's feed/home page in a background (non-focused) tab,
// waits for it to finish loading, runs extractAccountName() inside that
// page, then always closes the tab regardless of outcome -- this never
// leaves a stray tab open even if extraction throws.
async function detectAccountName(platform) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: DETECT_URLS[platform], active: false });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 15000);
      function onUpdated(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    // The feed/home page keeps loading content asynchronously after
    // "complete" fires -- a short fixed wait for the nav to actually
    // render, same reasoning as any SPA that finishes its initial
    // network round-trip after the browser's own load event.
    await new Promise((r) => setTimeout(r, 1500));

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAccountName,
      args: [platform],
    });
    return result;
  } catch {
    return null;
  } finally {
    if (tab?.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function runDetection() {
  const platform = platformSelect.value;
  confirmCheckbox.checked = false;
  updateConnectButtonState();
  setDetectBox("pending", "Checking who you're logged in as…");

  const name = await detectAccountName(platform);
  // The platform may have changed while this was running (user flipped
  // the dropdown mid-detection) -- discard a stale result rather than
  // showing the wrong platform's answer.
  if (platformSelect.value !== platform) return;

  if (name) {
    setDetectBox("found", `Logged in as: ${name}`);
  } else {
    setDetectBox(
      "unknown",
      `Couldn't confirm who you're logged in as on ${platform === "linkedin" ? "LinkedIn" : "Instagram"} -- make sure you're logged in, then double-check manually before connecting.`
    );
  }
}

platformSelect.addEventListener("change", runDetection);
runDetection();

connectButton.addEventListener("click", async () => {
  const platform = platformSelect.value;
  const code = codeInput.value.trim();

  if (!confirmCheckbox.checked) {
    showStatus("error", "Confirm you're logged in as the right account first.");
    return;
  }
  if (!code) {
    showStatus("error", "Paste the code from your Nexaris dashboard first.");
    return;
  }

  connectButton.disabled = true;
  showStatus("info", "Reading your session...");

  try {
    // chrome.cookies.getAll with a `url` filter returns every cookie that
    // would actually be sent on a request to that URL -- domain-scoped
    // cookies (e.g. .linkedin.com) included, exactly what a real
    // Playwright/browser session for that site needs. No host permission
    // beyond the one already declared in manifest.json's host_permissions
    // is required for this call.
    const domain = PLATFORM_DOMAINS[platform];
    const cookies = await chrome.cookies.getAll({ url: domain });

    if (!cookies || cookies.length === 0) {
      showStatus(
        "error",
        `No ${platform === "linkedin" ? "LinkedIn" : "Instagram"} cookies found -- make sure you're logged in to ${platform === "linkedin" ? "linkedin.com" : "instagram.com"} in this browser first.`
      );
      updateConnectButtonState();
      return;
    }

    showStatus("info", "Sending to Nexaris...");

    const response = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, cookies }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showStatus("error", data.error || `Something went wrong (${response.status}). Try generating a new code.`);
      updateConnectButtonState();
      return;
    }

    showStatus("success", "Connected! You can close this popup and go back to your Nexaris dashboard.");
    codeInput.value = "";
  } catch {
    showStatus("error", "Couldn't reach Nexaris. Check your internet connection and try again.");
  } finally {
    updateConnectButtonState();
  }
});
