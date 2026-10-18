const time = document.getElementById("time");
const url = document.getElementById("url");
const message = document.getElementById("message");
const status = document.getElementById("status");

function toLocalInputValue(timestamp) {
  const date = new Date(timestamp);
  const local = new Date(
    timestamp - date.getTimezoneOffset() * 60000
  );
  return local.toISOString().slice(0, 16);
}

document.getElementById("schedule").addEventListener(
  "click", async () => {
    const targetTime = new Date(time.value).getTime();

    if (!time.value || targetTime <= Date.now()) {
      status.textContent =
        "Choose a future date and time.";
      return;
    }

    let parsed;
    try {
      parsed = new URL(url.value);
    } catch {
      status.textContent = "Enter a valid URL.";
      return;
    }

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "claude.ai" ||
      !message.value.trim()
    ) {
      status.textContent =
        "Use a Claude HTTPS URL and enter a message.";
      return;
    }

    try {
      await chrome.storage.local.set({
        scheduledJob: {
          time: targetTime,
          url: parsed.href,
          message: message.value
        }
      });

      await chrome.alarms.create("scheduled-message", {
        when: targetTime
      });

      status.textContent =
        "Scheduled for " +
        new Date(targetTime).toLocaleString();
    } catch (error) {
      status.textContent = "Error: " + error.message;
    }
  }
);

document.getElementById("cancel").addEventListener(
  "click", async () => {
    await chrome.alarms.clear("scheduled-message");
    await chrome.storage.local.remove("scheduledJob");
    status.textContent = "Schedule cancelled.";
  }
);

chrome.storage.local.get("scheduledJob", ({ scheduledJob }) => {
  if (!scheduledJob) return;

  time.value = toLocalInputValue(scheduledJob.time);
  url.value = scheduledJob.url;
  message.value = scheduledJob.message;
});