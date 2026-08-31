const IMPORT_ENDPOINT = "https://app.nxrs.tech/api/extension/import-session";

const PLATFORM_DOMAINS = {
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
};

const PLATFORM_LABELS = {
  linkedin: "linkedin.com",
  instagram: "instagram.com",
};

const platformSelect = document.getElementById("platform");
const codeInput = document.getElementById("code");
const confirmCheckbox = document.getElementById("confirm");
const accountNameEl = document.getElementById("accountName");
const connectButton = document.getElementById("connect");
const statusEl = document.getElementById("status");

function showStatus(kind, text) {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function updateAccountLabel() {
  accountNameEl.textContent = PLATFORM_LABELS[platformSelect.value];
}

function updateConnectButtonState() {
  connectButton.disabled = !confirmCheckbox.checked;
}

updateAccountLabel();
updateConnectButtonState();

// Switching platforms re-requires confirmation -- ticking the box for
// LinkedIn shouldn't silently carry over to an Instagram send if the
// person changes the dropdown afterward without re-reading the label.
platformSelect.addEventListener("change", () => {
  updateAccountLabel();
  confirmCheckbox.checked = false;
  updateConnectButtonState();
});

confirmCheckbox.addEventListener("change", updateConnectButtonState);

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
