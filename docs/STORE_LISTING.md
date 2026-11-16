# Microsoft Edge Add-ons listing

Text and answers to paste into Partner Center. Build the upload with `npm run package`; it creates `workday-assistant-<version>.zip` in the project folder.

## Listing

**Name:** AI Workday Assistant

**Short description (manifest):** Plan your workday in the Edge sidebar: tasks, schedule, focus timer, reminders and an optional AI assistant.

**Category:** Productivity

**Price:** Free

**Languages:** English, French, Spanish, German, Portuguese (Brazil). The manifest description is localized through `public/_locales`; add a translated store description for each language in Partner Center.

**Description:**

AI Workday Assistant keeps your day in the Edge sidebar, next to whatever you are working on.

- Add tasks with estimates, priorities, deadlines, notes and dependencies.
- Preview a schedule that fits your tasks around meetings, lunch and breaks, and approve it before anything is saved.
- Start a focus timer on a task and get check-ins that ask how it is going.
- Get reminders for task starts, meetings, breaks and the end of your workday, as a pop-up window or a system notification.
- Optionally connect an AI assistant to talk through your workload and ask it to add or change tasks. Every change it proposes waits for your approval.

Everything is stored in your browser on your device and works offline. The AI assistant is optional and uses your own account: an API key for OpenRouter, OpenAI, Google Gemini or Anthropic Claude, or a ChatGPT sign-in. Data is sent only to the provider you choose, only after you give consent, and only when you send a message. The developer runs no servers and collects nothing.

**Search terms:** planner, tasks, to-do, schedule, focus timer, productivity, AI assistant

**Privacy policy URL:** the public address where `docs/PRIVACY.md` is hosted (required, because the extension handles personal data).

## Permission justifications

| Permission | Justification |
|---|---|
| `sidePanel` | The whole interface is shown in the browser side panel. |
| `alarms` | Schedules reminders and focus check-ins at the right time. |
| `notifications` | Shows reminders and check-ins as system notifications. |
| `storage` | Keeps the user's ChatGPT sign-in session on their device. |
| `https://openrouter.ai/*`, `https://api.openai.com/*`, `https://generativelanguage.googleapis.com/*`, `https://api.anthropic.com/*` | Sends the user's AI requests directly to the AI provider they selected, using their own API key. |
| `https://auth.openai.com/*` | Completes ChatGPT sign-in and refreshes or revokes the session. |
| `http://127.0.0.1/*` | ChatGPT sign-in redirects the sign-in tab to a loopback address. The extension reads the sign-in code from that tab's URL. No request is made to local services and no local port is opened. |

**Remote code:** none. All scripts are packaged in the extension.

**Single purpose:** planning and tracking a workday, with an optional AI assistant for that plan.

## Notes for certification (testing instructions)

The planner works without any account: open the side panel, choose Today, add a task and select Preview plan. AI features need the tester's own provider API key or ChatGPT account, entered under Settings.

## Before submitting

- Host `docs/PRIVACY.md` at a public URL and replace `[CONTACT EMAIL]` in it.
- Take at least one screenshot (1280x800 or 640x400) of the Today tab and one of AI Chat.
- Provide a 300x300 store logo. Only 16, 32, 48 and 128 pixel icons exist in the package.
- Check OpenAI's terms for using ChatGPT sign-in in a published extension. If in doubt, remove the ChatGPT plan provider and the `auth.openai.com` and `127.0.0.1` permissions before submitting.
