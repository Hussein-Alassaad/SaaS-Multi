const IMPORT_ENDPOINT = "https://app.nxrs.tech/api/extension/import-session";
const RECONNECT_ENDPOINT = "https://app.nxrs.tech/api/extension/reconnect";

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
const detectBoxReconnect = document.getElementById("detectBoxReconnect");
const connectButton = document.getElementById("connect");
const reconnectButton = document.getElementById("reconnectButton");
const useDifferentAccountButton = document.getElementById("useDifferentAccount");
const reconnectPanel = document.getElementById("reconnectPanel");
const codePanel = document.getElementById("codePanel");
const rememberedLabel = document.getElementById("rememberedLabel");
const statusEl = document.getElementById("status");

function showStatus(kind, text) {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function setDetectBox(el, state, text) {
  el.className = `detect-box ${state}`;
  el.textContent = text;
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

// --- Remembered-account storage -------------------------------------
// chrome.storage.local, keyed by platform ("linkedin"/"instagram") --
// one remembered account per platform per browser profile, matching how
// PLATFORM_DOMAINS/DETECT_URLS above are already platform-keyed. Stores
// {accountId, reconnectToken, label} -- label is purely cosmetic (shown
// in reconnectPanel), accountId+reconnectToken are what
// /api/extension/reconnect actually needs.
function getRemembered(platform) {
  return chrome.storage.local.get(platform).then((r) => r[platform] || null);
}

function setRemembered(platform, value) {
  return chrome.storage.local.set({ [platform]: value });
}

function clearRemembered(platform) {
  return chrome.storage.local.remove(platform);
}

async function runDetection(platform) {
  const remembered = await getRemembered(platform);

  if (remembered) {
    reconnectPanel.hidden = false;
    codePanel.hidden = true;
    rememberedLabel.textContent = remembered.label || (platform === "linkedin" ? "a LinkedIn account" : "an Instagram account");
    setDetectBox(detectBoxReconnect, "pending", "Checking who you're logged in as…");
  } else {
    reconnectPanel.hidden = true;
    codePanel.hidden = false;
    confirmCheckbox.checked = false;
    updateConnectButtonState();
    setDetectBox(detectBox, "pending", "Checking who you're logged in as…");
  }

  const name = await detectAccountName(platform);
  // The platform may have changed while this was running (user flipped
  // the dropdown mid-detection) -- discard a stale result rather than
  // showing the wrong platform's answer.
  if (platformSelect.value !== platform) return;

  const targetBox = remembered ? detectBoxReconnect : detectBox;
  if (name) {
    setDetectBox(targetBox, "found", `Logged in as: ${name}`);
  } else {
    setDetectBox(
      targetBox,
      "unknown",
      `Couldn't confirm who you're logged in as on ${platform === "linkedin" ? "LinkedIn" : "Instagram"} -- make sure you're logged in${remembered ? "" : ", then double-check manually before connecting"}.`
    );
  }
}

platformSelect.addEventListener("change", () => runDetection(platformSelect.value));
runDetection(platformSelect.value);

useDifferentAccountButton.addEventListener("click", async () => {
  await clearRemembered(platformSelect.value);
  reconnectPanel.hidden = true;
  codePanel.hidden = false;
  confirmCheckbox.checked = false;
  updateConnectButtonState();
});

async function readCookiesFor(platform) {
  // chrome.cookies.getAll with a `url` filter returns every cookie that
  // would actually be sent on a request to that URL -- domain-scoped
  // cookies (e.g. .linkedin.com) included, exactly what a real
  // Playwright/browser session for that site needs. No host permission
  // beyond the one already declared in manifest.json's host_permissions
  // is required for this call.
  const domain = PLATFORM_DOMAINS[platform];
  return chrome.cookies.getAll({ url: domain });
}

reconnectButton.addEventListener("click", async () => {
  const platform = platformSelect.value;
  const remembered = await getRemembered(platform);
  if (!remembered) {
    // Storage changed out from under us (e.g. cleared in another window) --
    // fall back to the code flow rather than erroring with nothing to act on.
    reconnectPanel.hidden = true;
    codePanel.hidden = false;
    return;
  }

  reconnectButton.disabled = true;
  showStatus("info", "Reading your session...");

  try {
    const cookies = await readCookiesFor(platform);
    if (!cookies || cookies.length === 0) {
      showStatus(
        "error",
        `No ${platform === "linkedin" ? "LinkedIn" : "Instagram"} cookies found -- make sure you're logged in to ${platform === "linkedin" ? "linkedin.com" : "instagram.com"} in this browser first.`
      );
      return;
    }

    showStatus("info", "Reconnecting...");

    const response = await fetch(RECONNECT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: remembered.accountId, reconnectToken: remembered.reconnectToken, cookies }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        // The saved token is no longer valid (account was disconnected on
        // the dashboard, or reconnected via a fresh code elsewhere) --
        // this extension's memory of it is stale, drop it and fall back
        // to the code flow rather than looping on a dead token forever.
        await clearRemembered(platform);
        reconnectPanel.hidden = true;
        codePanel.hidden = false;
        showStatus("error", data.error || "This saved connection is no longer valid -- connect again using a code from the dashboard.");
        return;
      }
      showStatus("error", data.error || `Something went wrong (${response.status}). Try again.`);
      return;
    }

    showStatus("success", "Reconnected! You can close this popup.");
  } catch {
    showStatus("error", "Couldn't reach Nexaris. Check your internet connection and try again.");
  } finally {
    reconnectButton.disabled = false;
  }
});

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
    const cookies = await readCookiesFor(platform);

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

    // Remember this account for one-click reconnect next time, IF the
    // server actually handed back a token -- an older deployed backend
    // (before this feature shipped) simply won't include one, in which
    // case this silently stays a code-only flow rather than breaking.
    if (data.reconnectToken) {
      // decodeCodePayload: the code itself carries accountId (it's a JWT
      // minted by mintImportSessionCodeAction) -- reuse it here instead of
      // having the server repeat accountId in its response body.
      const accountId = decodeAccountIdFromCode(code);
      if (accountId) {
        await setRemembered(platform, {
          accountId,
          reconnectToken: data.reconnectToken,
          label: platform === "linkedin" ? "a LinkedIn account" : "an Instagram account",
        });
      }
    }

    showStatus("success", "Connected! You can close this popup and go back to your Nexaris dashboard.");
    codeInput.value = "";
  } catch {
    showStatus("error", "Couldn't reach Nexaris. Check your internet connection and try again.");
  } finally {
    updateConnectButtonState();
  }
});

// JWTs are three base64url segments separated by '.' -- the middle one is
// the payload. Decoded CLIENT-SIDE here purely to read the plaintext
// accountId claim back out of a code this same browser just used
// (the code isn't a secret to this popup -- it was typed/pasted into it),
// not a security boundary of any kind; the actual authorization is the
// server's own signature verification, already done server-side before
// this code ever reaches success.
function decodeAccountIdFromCode(code) {
  try {
    const [, payloadB64] = code.split(".");
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    return payload.accountId || null;
  } catch {
    return null;
  }
}
