# Hazo

Hazo is an AI-guided goal execution app built as a monorepo:

- `apps/api`: FastAPI backend
- `apps/mobile`: React Native mobile app
- `packages/ai`: shared LLM prompt/client code

The app flow is:

1. Sign in with Supabase
2. Create a goal
3. Set weekly availability manually or import a timetable photo/PDF and review the extracted free slots
4. Let the backend generate a roadmap and daily learning plan
5. Work through daily goal tasks, personal tasks, mentor chat, and progress tracking in the mobile app

## Monorepo Structure

```text
Hazo/
├── apps/
│   ├── api/        # FastAPI backend
│   └── mobile/     # React Native app
├── packages/
│   └── ai/         # Gemini prompts and client
├── package.json    # workspace root
└── turbo.json      # turbo pipeline config
```

## In-Depth Architecture & Libraries

This project uses a modern monorepo structure separating the client, backend, and shared AI logic. Below is a comprehensive breakdown of everything used in the project.

### 📱 Mobile App (`apps/mobile`)
Built with React Native to provide a cross-platform mobile experience.
- **Core Framework:** React Native 0.74 with TypeScript for type safety.
- **Navigation:** React Navigation (Native Stack and Bottom Tabs) for screen transitions and tab bars.
- **State Management (Global):** Zustand is used for lightweight, fast global state management (e.g., storing the user's authentication session and current goal data).
- **Data Fetching (Server State):** React Query (`@tanstack/react-query`) handles API requests, caching, and optimistic UI updates for interacting with the FastAPI backend.
- **Local Storage:** React Native Async Storage for persisting simple key-value data across sessions, and React Native Keychain for secure storage of sensitive credentials.
- **UI & Animations:** 
  - Shopify FlashList for highly performant scrolling lists.
  - Lucide React Native for standard iconography.
  - Reanimated (`react-native-reanimated`) and Gesture Handler for smooth 60fps animations.
  - React Native Linear Gradient for stylized backgrounds.
  - React Native Haptic Feedback for tactile user interactions.
- **System Integration:**
  - Firebase App & Messaging (`@react-native-firebase`) combined with Notifee (`@notifee/react-native`) for handling push notifications.
  - React Native Document Picker for selecting timetable PDFs or images.
  - React Native Community NetInfo to check internet connectivity.
- **Error Tracking:** Sentry React Native SDK captures unhandled exceptions and performance telemetry.

### ⚙️ Backend API (`apps/api`)
Built with Python and FastAPI, designed to handle AI workloads efficiently.
- **Core Framework:** FastAPI running on Uvicorn (ASGI server) for high-performance, asynchronous HTTP request handling.
- **Database:** MongoDB accessed via `motor` (an asynchronous MongoDB driver for Python). It stores user profiles, goals, skills, and tasks.
- **Caching & Job Queues:** Redis is used for caching active daily task cards, managing Mentor chat sessions, and acting as the backend for background jobs.
- **Background Jobs:** APScheduler (`apscheduler`) runs nightly cron jobs within the FastAPI lifecycle. It triggers the generation of new daily tasks for active goals and checks the health of external links.
- **Authentication:** Validates JWT tokens issued by Supabase using `python-jose` (for cryptography) and `passlib` (for hashing/verification).
- **Validation:** Pydantic is heavily used for data validation, serialization, and type checking of API payloads, while `pydantic-settings` manages environment variables.
- **File Uploads:** `python-multipart` parses incoming form data (e.g., timetable image uploads).
- **Error Tracking:** Sentry SDK (`sentry-sdk`) for backend crash reporting.

### 🧠 AI Layer (`packages/ai`)
A shared Python package that encapsulates LLM interactions.
- **Supported Providers:** 
  - Google Gemini: Handled natively via the `google-generativeai` SDK. Supports multimodal inputs (like parsing timetables).
  - OpenRouter: Integrated using `httpx` for making custom HTTP calls to OpenRouter's API, allowing the use of various open-source or proprietary models.
- **System Flows:**
  - **Roadmap Parsing:** The backend sends a structured prompt with the user's goal and availability. The LLM returns a JSON string, which the backend aggressively parses using regex fallbacks if the LLM includes conversational filler.
  - **Mentor Chat (SSE):** The Mentor feature uses Server-Sent Events (SSE). As the LLM generates a response, FastAPI streams the tokens back to the React Native app in real-time, creating a typing effect.
  - **Timetable Extraction:** Users can upload a photo of their timetable. The image is parsed via multipart form data, sent to a multimodal LLM (like Gemini), and the extracted free slots are returned as structured JSON.
## Prerequisites

You will need the following installed before setup:

- Node.js 18+ and npm
- Python 3.10+ or 3.11+
- Java 17+ for Android builds
- Android Studio with SDK 34
- CocoaPods and Xcode if you want to run iOS
- MongoDB instance
- Redis instance
- Supabase project
- Google Gemini API key

Notes:

- Android release builds have been verified from this repo.
- The current Android `release` build uses the debug keystore for local/testing builds. Replace it before shipping to the Play Store.
- iOS project files exist, but Android is the better-tested path in this repo right now.

## Fork And Clone

1. Fork this repository on GitHub.
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/hazo.git
cd hazo
```

3. Install root workspace dependencies:

```bash
npm install
```

This installs the shared workspace dependencies used by the React Native app.

## Required External Services

### 1. Supabase

Create a Supabase project and collect:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`

The mobile app uses:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The backend uses:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

The backend verifies access tokens against Supabase JWT signing keys via the
JWKS endpoint, so you do not need to set the legacy `SUPABASE_JWT_SECRET`.

If you use Google OAuth with Supabase, add the mobile deep link redirect:

```text
hazo://auth
```

Android already has this deep link in the native manifest.

### 2. MongoDB

Create a MongoDB database and set `MONGODB_URI`.

The backend uses the database named:

```text
hazo
```

Collections are created automatically when data is written.

### 3. Redis

Create a Redis instance and set `REDIS_URL`.

Redis is used for:

- onboarding sessions
- daily task caching
- mentor/chat related caching
- scheduled jobs

The backend starts schedulers automatically on startup, so Redis should be reachable before launching the API.

### 4. LLM Provider

Hazo's backend can use either Gemini or OpenRouter.

Set the provider in `apps/api/.env`:

```text
LLM_PROVIDER=gemini
```

For Gemini, set:

```text
GOOGLE_GEMINI_API_KEY
GEMINI_MODEL_NAME
```

Example Gemini models:

- `gemini-flash-latest`
- `gemini-2.5-flash`
- `gemini-2.5-pro`

For OpenRouter, set:

```text
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY
OPENROUTER_MODEL_NAME
```

Optional OpenRouter envs:

- `OPENROUTER_BASE_URL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Important provider note:

- Text generation flows work with either Gemini or OpenRouter.
- Timetable image/PDF extraction currently requires Gemini multimodal support.
- If you set `LLM_PROVIDER=openrouter`, the availability upload-review flow will not work unless you add a separate multimodal provider path.

### 5. Sentry

Sentry is optional.

If you want telemetry, set:

- `SENTRY_DSN` in `apps/api/.env`
- `SENTRY_DSN` in `apps/mobile/.env`

If omitted, the app still runs.

## Environment Files

This repo already includes example env files:

- [apps/api/.env.example](apps/api/.env.example)
- [apps/mobile/.env.example](apps/mobile/.env.example)

Create real env files from them:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### Backend Env

Fill [apps/api/.env](apps/api/.env) with:

```env
LLM_PROVIDER=gemini
GOOGLE_GEMINI_API_KEY=
GEMINI_MODEL_NAME=gemini-flash-latest
OPENROUTER_API_KEY=
OPENROUTER_MODEL_NAME=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=
OPENROUTER_APP_NAME=Hazo
MONGODB_URI=
REDIS_URL=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SENTRY_DSN=
NODE_ENV=development
PORT=8000
CORS_ORIGINS=http://localhost:8081
```

### Mobile Env

Fill [apps/mobile/.env](apps/mobile/.env) with:

```env
API_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SENTRY_DSN=
PUBLIC_API_URL=
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
PUBLIC_SENTRY_DSN=
```

Notes:

- The mobile app accepts both `API_URL` / `SUPABASE_URL` style vars and the `PUBLIC_*` variants.
- You usually only need one set. Prefer `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SENTRY_DSN`.

## Local API URL Rules

Do not blindly use `http://localhost:8000` on a device or emulator.

Use:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Physical device: `http://<your-lan-ip>:8000`
- Hosted backend: your public API URL

For example, for Android emulator:

```env
API_URL=http://10.0.2.2:8000
```

## Backend Setup

Create a Python virtual environment and install backend dependencies:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the API from `apps/api`:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Why run from `apps/api`?

- imports are written relative to that app layout
- the backend explicitly loads `apps/api/.env`
- it is the cleanest dev workflow for this repo

When the API starts, it will:

- initialize Mongo indexes
- warm the Mongo connection
- start the nightly scheduler
- start the link health checker

## Mobile Setup

From the repo root, start Metro:

```bash
cd /path/to/hazo
npm --workspace apps/mobile start
```

In a second terminal, run Android:

```bash
cd /path/to/hazo
npm --workspace apps/mobile run android
```

You can also run from inside the app folder:

```bash
cd apps/mobile
npm start
npm run android
```

## iOS Setup

If you want to run iOS:

1. Install CocoaPods
2. Install pods
3. Start Metro
4. Run the app

```bash
cd apps/mobile/ios
pod install

cd ..
npm start
npm run ios
```

Important caveat:

- Android deep linking for `hazo://auth` is configured.
- If Supabase OAuth redirect handling does not work on iOS, you may need to add the same URL scheme to the iOS native project as part of your local setup.

## Recommended Local Dev Workflow

Open 3 terminals:

### Terminal 1: backend

```bash
cd apps/api
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 2: metro

```bash
cd apps/mobile
npm start
```

### Terminal 3: android

```bash
cd apps/mobile
npm run android
```

## Seeding Demo Data

The repo includes demo seed/reset scripts in [apps/api/scripts](apps/api/scripts).

To seed a demo user:

```bash
cd apps/api
source .venv/bin/activate
python -m scripts.seed_demo --email demo@hazo.app --password Demo1234!
```

This script creates:

- a Supabase auth user
- Mongo user, goal, skills, and tasks
- a Redis daily task card

To reset demo data:

```bash
cd apps/api
source .venv/bin/activate
python -m scripts.reset_demo
```

## Build The Android Release APK

From the Android folder:

```bash
cd apps/mobile/android
./gradlew assembleRelease
```

Output:

- [app-release.apk](apps/mobile/android/app/build/outputs/apk/release/app-release.apk)

Important:

- The current `release` build is signed with the debug keystore for local/testing convenience.
- Before publishing, replace this with a proper production keystore and signing config.

## Useful Commands

From the repo root:

```bash
npm install
npm --workspace apps/mobile run lint
npx tsc --noEmit -p apps/mobile/tsconfig.json
```

From the mobile app:

```bash
cd apps/mobile
npm start
npm run android
npm run ios
```

From the backend:

```bash
cd apps/api
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Troubleshooting

### Mobile gets 401 from the API

Check:

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `apps/api/.env`
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `apps/mobile/.env`
- that the user is actually signed in
- that your backend was restarted after changing env vars

### Android app cannot reach local backend

Use the correct `API_URL`:

- Android emulator: `http://10.0.2.2:8000`
- Physical device: `http://<your-lan-ip>:8000`

### LLM provider fails

Check:

- `LLM_PROVIDER` is set correctly in `apps/api/.env`
- if using Gemini:
  - `GOOGLE_GEMINI_API_KEY` is present
  - `GEMINI_MODEL_NAME` is present
- if using OpenRouter:
  - `OPENROUTER_API_KEY` is present
  - `OPENROUTER_MODEL_NAME` is present
- the backend was restarted after changing it
- the selected provider quota has not been exhausted

If you are using OpenRouter, also remember:

- roadmap generation, mentor streaming, and other text flows should work
- timetable image/PDF extraction will fail until a multimodal OpenRouter path is implemented

### Redis-related goal or mentor issues

Check:

- `REDIS_URL`
- Redis network access
- whether the backend started successfully without scheduler errors

### MongoDB issues

Check:

- `MONGODB_URI`
- database user/IP allowlist
- connection string format

### Android release build fails

This repo has already been adjusted for:

- monorepo React Native root resolution
- explicit Hermes compiler path during release builds

If release build issues return, try:

```bash
cd apps/mobile/android
./gradlew clean assembleRelease
```

## Security Notes

- Never commit real `.env` files
- Never commit Supabase service keys, JWT secrets, Gemini keys, or Sentry secrets
- Use the included `.env.example` files as templates

## Current Status

What is working well:

- backend auth flow with Supabase
- goal creation, roadmap generation, and completed-goal lifecycle
- daily goal/task flow with streak tracking
- weekly availability editor and timetable upload-review flow
- DB-backed skills tracking
- profile account deletion
- Android release APK build

What still needs production hardening:

- production Android signing
- final iOS polish and validation
- full OpenRouter multimodal support for upload-based extraction
- end-to-end deployment documentation for hosted environments
