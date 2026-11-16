# Privacy Policy for AI Workday Assistant

Last updated: November 16, 2026

AI Workday Assistant is a browser extension for planning your workday. This policy explains what the extension stores, what it sends, and to whom.

## Summary

- Your tasks, schedule and settings are stored in your browser, on your device.
- The developer of this extension runs no servers and receives none of your data.
- The extension has no analytics, tracking, advertising or accounts of its own.
- Data leaves your device only when you use an AI feature, and then only to the AI provider you chose and connected.

## Data stored on your device

The extension stores the following in your browser's extension storage. It stays in the browser profile where the extension is installed and is not synced by the extension.

- **Tasks and notes:** titles, descriptions, notes, priorities, categories, estimates, dates, deadlines, dependencies and status.
- **Schedule:** planned time blocks, meetings you enter (title and times), breaks and working hours.
- **Work records:** focus sessions and reminders.
- **Settings:** workday hours, time zone, reminder preferences, color theme and the name you give the assistant.
- **AI conversations:** your messages to the assistant, its replies and the changes it proposed.
- **AI credentials:** API keys you enter for OpenRouter, OpenAI, Google Gemini or Anthropic Claude, and, if you sign in with ChatGPT, the sign-in tokens and email address of that ChatGPT account.

Credentials are stored without encryption in the extension's private storage. Websites cannot read them, but anyone with access to your browser profile on your computer could. Do not use the extension on a computer you do not trust.

## Data sent to AI providers

AI features are optional. Nothing is sent until you connect a provider, tick its data-sharing consent box in Settings and send a message or refresh the model list.

When you send a message in AI Chat, the extension sends the following directly from your browser to the provider you selected:

- your message and up to six recent messages from that conversation;
- a summary of up to 120 tasks: title, status, priority, category, estimate, time spent, dates, deadlines and dependencies;
- task descriptions and notes, only if you turn on "Include task descriptions and notes";
- your working hours, working days, lunch and break times, and time zone;
- the start and end times of your meetings and scheduled blocks;
- meeting titles, unless you turn off "Include meeting titles" in Chat options;
- the assistant name, if you set one;
- your API key or sign-in token, to authenticate the request.

The provider you can select, and where requests go:

| Provider | Destination | Their privacy policy |
|---|---|---|
| OpenRouter | openrouter.ai | https://openrouter.ai/privacy |
| OpenAI (API key) | api.openai.com | https://openai.com/policies/privacy-policy |
| ChatGPT plan (sign-in) | auth.openai.com and api.openai.com | https://openai.com/policies/privacy-policy |
| Google Gemini | generativelanguage.googleapis.com | https://policies.google.com/privacy |
| Anthropic Claude | api.anthropic.com | https://www.anthropic.com/legal/privacy |

Only the provider you have selected receives a request. With OpenRouter, your request is also passed to the company that runs the model you picked. Each provider handles the data it receives under its own terms and privacy policy, which this extension does not control.

The extension never reads the web pages you visit, your browsing history, or any other browser data.

## Data the developer receives

None. The extension does not send any data to the developer, and the developer cannot see your tasks, conversations or credentials.

## Sale and sharing of data

Your data is not sold, rented or shared with anyone other than the AI provider you choose to use, as described above. It is not used for advertising, profiling or credit decisions.

## Permissions the extension uses

- **Side panel:** to show the extension in the browser's side panel.
- **Alarms and notifications:** to schedule and show reminders and check-ins.
- **Storage:** to keep the ChatGPT sign-in on your device.
- **Access to the AI provider addresses listed above:** to send your AI requests to the provider you chose.
- **Access to `http://127.0.0.1`:** used only during ChatGPT sign-in. ChatGPT finishes sign-in by redirecting the sign-in tab to an address on your own computer; the extension reads the sign-in code from that address. Nothing is sent to or read from other programs on your computer.

## Keeping and deleting your data

Data stays until you remove it. You can:

- delete individual tasks, meetings and conversations in the extension;
- remove a saved API key with **Forget key**, or leave ChatGPT with **Sign out**, which also removes that account's details and conversation from the extension;
- delete everything with **Settings → Delete all local data**;
- export your tasks and work records with **Settings → Export local data** (exports never include credentials or conversations).

Uninstalling the extension or clearing the browser's site data also removes everything it stored. Uninstalling does not end a ChatGPT session on OpenAI's side, so sign out first. To delete data an AI provider holds, contact that provider.

## Children

The extension is not directed at children under 13 and does not knowingly collect data from them.

## Changes to this policy

If this policy changes, the updated version will be published at the same address with a new "Last updated" date.

## Contact

Questions about this policy: [CONTACT EMAIL]
