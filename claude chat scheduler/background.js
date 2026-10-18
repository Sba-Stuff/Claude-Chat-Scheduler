async function restoreAlarm() {
  const { scheduledJob } =
    await chrome.storage.local.get("scheduledJob");

  if (!scheduledJob) return;

  await chrome.alarms.create("scheduled-message", {
    when: Math.max(scheduledJob.time, Date.now() + 1000)
  });
}

chrome.runtime.onInstalled.addListener(restoreAlarm);
chrome.runtime.onStartup.addListener(restoreAlarm);


// Wait until the tab finishes loading.
async function waitForTabComplete(tabId, timeoutMs = 60000) {
  const tab = await chrome.tabs.get(tabId);

  if (tab.status === "complete") return;

  await new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
    };

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("Page load timed out."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (
        updatedTabId === tabId &&
        changeInfo.status === "complete"
      ) {
        if (finished) return;

        finished = true;
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check again in case the tab finished loading
    // between chrome.tabs.get() and listener registration.
    chrome.tabs.get(tabId).then(currentTab => {
      if (currentTab.status === "complete" && !finished) {
        finished = true;
        cleanup();
        resolve();
      }
    }).catch(error => {
      if (finished) return;

      finished = true;
      cleanup();
      reject(error);
    });
  });
}


// Execute the scheduled job.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "scheduled-message") return;

  const { scheduledJob: job } =
    await chrome.storage.local.get("scheduledJob");

  if (!job) return;

  // Remove the stored job so it is not executed twice.
  await chrome.storage.local.remove("scheduledJob");

  try {
    // Open Claude.
    const tab = await chrome.tabs.create({
      url: job.url,
      active: true
    });

    if (tab.id == null) {
      throw new Error("Could not open tab.");
    }

    // Wait for initial page loading.
    await waitForTabComplete(tab.id);

    // Insert the message and click Claude's Send button.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [job.message],

      func: async (message) => {
        const sleep = ms =>
          new Promise(resolve => setTimeout(resolve, ms));

        // Find the Claude message composer.
        function findComposer() {
          return document.querySelector(
            'textarea, ' +
            '[contenteditable="true"][role="textbox"], ' +
            '[contenteditable="true"], ' +
            '[role="textbox"]'
          );
        }

        // Wait for the composer to become available.
        let box = null;

        for (let i = 0; i < 60; i++) {
          box = findComposer();

          if (box) break;

          await sleep(500);
        }

        if (!box) {
          throw new Error(
            "Claude message composer was not found."
          );
        }

        box.focus();

        // Insert the message into the composer.
        if (
          box instanceof HTMLTextAreaElement ||
          box instanceof HTMLInputElement
        ) {
          const prototype = Object.getPrototypeOf(box);

          const setter = Object.getOwnPropertyDescriptor(
            prototype,
            "value"
          )?.set;

          if (setter) {
            setter.call(box, message);
          } else {
            box.value = message;
          }
        } else {
          box.textContent = message;
        }

        // Notify Claude's frontend that the content changed.
        box.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: message
        }));

        box.dispatchEvent(new Event("change", {
          bubbles: true
        }));

        // Give Claude time to update its internal state.
        await sleep(1000);

        // Use the stable selectors found in your HTML.
        function findSendButton() {
          return document.querySelector(
            'button[data-testid="chat-input-send"]'
          ) || [...document.querySelectorAll("button")].find(
            button =>
              button.getAttribute("aria-label") ===
              "Send message"
          );
        }

        // Wait until the Send button is available and enabled.
        let sendButton = null;

        for (let i = 0; i < 40; i++) {
          sendButton = findSendButton();

          if (
            sendButton &&
            sendButton.isConnected &&
            !sendButton.disabled &&
            sendButton.getAttribute("aria-disabled") !== "true"
          ) {
            break;
          }

          await sleep(250);
        }

        if (
          !sendButton ||
          !sendButton.isConnected ||
          sendButton.disabled ||
          sendButton.getAttribute("aria-disabled") === "true"
        ) {
          throw new Error(
            "Send button was not found or is disabled. " +
            "The message may still be in the composer."
          );
        }

        // Click the actual Send button.
        sendButton.click();

        return {
          success: true,
          message: "Message inserted; Send button clicked."
        };
      }
    });

    console.log("Scheduled action:", results);

  } catch (error) {
    console.error("Scheduled action failed:", error);
  }
});