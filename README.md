# Stride

Stride is an AI-guided goal execution app built as a monorepo:

- `apps/api`: FastAPI backend
- `apps/mobile`: React Native mobile app
- `packages/ai`: shared Gemini prompt/client code

The app flow is:

1. Sign in with Supabase
2. Create a goal
3. Let the backend generate a roadmap and daily learning plan
4. Work through daily goal tasks and personal tasks in the mobile app

## Monorepo Structure

```text
Stride/
├── apps/
│   ├── api/        # FastAPI backend
│   └── mobile/     # React Native app
├── packages/
│   └── ai/         # Gemini prompts and client
├── package.json    # workspace root
└── turbo.json      # turbo pipeline config
```

## Tech Stack

- Mobile: React Native 0.74, TypeScript, React Query, Zustand
- Backend: FastAPI, Motor, Redis, APScheduler
- Database: MongoDB
- Auth: Supabase
- AI: Google Gemini
- Error tracking: Sentry

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
git clone https://github.com/<your-username>/stride.git
cd stride
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
- `SUPABASE_JWT_SECRET`

The mobile app uses:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The backend uses:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_JWT_SECRET`

If you use Google OAuth with Supabase, add the mobile deep link redirect:

```text
stride://auth
```

Android already has this deep link in the native manifest.

### 2. MongoDB

Create a MongoDB database and set `MONGODB_URI`.

The backend uses the database named:

```text
stride
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

### 4. Gemini

Create a Gemini API key and set:

```text
GOOGLE_GEMINI_API_KEY
```

### 5. Sentry

Sentry is optional.

If you want telemetry, set:

- `SENTRY_DSN` in `apps/api/.env`
- `SENTRY_DSN` in `apps/mobile/.env`

If omitted, the app still runs.

## Environment Files

This repo already includes example env files:

- [apps/api/.env.example](/Users/suryadeepsinhjadeja/Stride/apps/api/.env.example)
- [apps/mobile/.env.example](/Users/suryadeepsinhjadeja/Stride/apps/mobile/.env.example)

Create real env files from them:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### Backend Env

Fill [apps/api/.env](/Users/suryadeepsinhjadeja/Stride/apps/api/.env) with:

```env
GOOGLE_GEMINI_API_KEY=
MONGODB_URI=
REDIS_URL=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_JWT_SECRET=
SENTRY_DSN=
NODE_ENV=development
PORT=8000
CORS_ORIGINS=http://localhost:8081
```

### Mobile Env

Fill [apps/mobile/.env](/Users/suryadeepsinhjadeja/Stride/apps/mobile/.env) with:

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
cd /path/to/stride
npm --workspace apps/mobile start
```

In a second terminal, run Android:

```bash
cd /path/to/stride
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

- Android deep linking for `stride://auth` is configured.
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

The repo includes demo seed/reset scripts in [apps/api/scripts](/Users/suryadeepsinhjadeja/Stride/apps/api/scripts).

To seed a demo user:

```bash
cd apps/api
source .venv/bin/activate
python -m scripts.seed_demo --email demo@stride.app --password Demo1234!
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

- [app-release.apk](/Users/suryadeepsinhjadeja/Stride/apps/mobile/android/app/build/outputs/apk/release/app-release.apk)

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

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `SUPABASE_JWT_SECRET` in `apps/api/.env`
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `apps/mobile/.env`
- that the user is actually signed in
- that your backend was restarted after changing env vars

### Android app cannot reach local backend

Use the correct `API_URL`:

- Android emulator: `http://10.0.2.2:8000`
- Physical device: `http://<your-lan-ip>:8000`

### Gemini fails

Check:

- `GOOGLE_GEMINI_API_KEY` is present in `apps/api/.env`
- the backend was restarted after changing it
- your Gemini quota has not been exhausted

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
- goal creation and roadmap generation
- daily task flow
- Android release APK build

What still needs production hardening:

- production Android signing
- final iOS polish and validation
- end-to-end deployment documentation for hosted environments
