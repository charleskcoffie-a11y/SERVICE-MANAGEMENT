<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9e4fb141-da41-4bfc-89de-59ab6707b09b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example` and set:
   - `GEMINI_API_KEY`
   - `ADMIN_PASSWORD` (password used for Admin Unlock)
3. Run the app and auth server:
   `npm run dev`

## Admin Auth Mode

- Admin login is now validated by a server endpoint (`/api/admin/login`).
- The admin password is read on the server from `ADMIN_PASSWORD`.
- The password is no longer stored in frontend source code.
