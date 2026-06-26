# User Stories Definition

## Overview
This document outlines the types of user stories that are relevant for the Nyxtok project – a TikTok discovery platform that leverages AI for video transcription, hashtag discovery, and content recommendation. It also addresses the feasibility of building companion apps and coding directly on a mobile device.

---

## 1. Core User Stories for Nyxtok

| ID | As a … | I want to … | So that … |
|----|--------|--------------|-----------|
| **U1** | **End‑user (TikTok viewer)** | Search for videos by hashtag or keyword and see AI‑generated captions. | I can discover relevant content without manually typing hashtags.
| **U2** | **End‑user (TikTok creator)** | Upload a video and have the system automatically generate a transcript and suggested hashtags. | I spend less time on manual captioning and can reach a larger audience.
| **U3** | **Researcher** | Export a list of discovered videos, their transcripts, and associated metadata to a CSV/JSON file. | I can perform offline analysis or feed the data into a downstream pipeline.
| **U4** | **Developer** | Run integration tests locally with `pnpm run test` and see a live preview of the UI via Docker Compose. | I can verify changes quickly before pushing to CI.
| **U5** | **Mobile user** | Access the Nyxtok web UI on a phone and use voice input to search for videos. | I can discover content on‑the‑go without a keyboard.
| **U6** | **Admin** | Configure the AI models (e.g., Whisper, Groq) and toggle feature flags via a simple settings page. | I can adapt the platform to different workloads or cost constraints.
| **U7** | **Accessibility user** | Enable screen‑reader friendly navigation and high‑contrast UI themes. | I can use the platform comfortably with assistive technologies.

---

## 2. Companion Apps (iOS / Android)

### 2.1. What Apps Are Needed?
- **Nyxtok Mobile Web App** – a responsive PWA that works in mobile browsers (Chrome, Safari). It re‑uses the existing Next.js frontend, so no separate native code is required.
- **Optional Native Wrapper** – if we need deeper OS integration (e.g., push notifications, background transcription), a thin React‑Native wrapper can be built around the PWA.

### 2.2. Feasibility
- The current codebase already includes a **Next.js** front‑end that is responsive. Adding a `manifest.json` and service worker will turn it into a PWA.
- For native features, the team can use **Expo** (React‑Native) which shares most of the JavaScript code. This avoids duplicating business logic.
- No MCP (Multi‑Channel Platform) is required for TikTok; the platform uses the TikTokApi CLI, which works on macOS and can be invoked from a server backend.

---

## 3. Coding on the Phone

### 3.1. Possibility
- **VS Code Remote** – you can run a VS Code server inside a Docker container on your development machine and connect from the VS Code iOS/Android app. This gives a full IDE experience on the phone.
- **GitHub Codespaces** – a cloud‑hosted development environment that can be accessed via the browser on any device, including phones.
- **Termux (Android)** – a Linux terminal emulator that can install Node, pnpm, and run the project locally. iOS is more restrictive, but you can use a‑IDEapp (e.g., Blink) that connects to a remote SSH server.

### 3.2. Recommendations
1. **Set up a remote dev container** (`devcontainer.json`) in the repo. This works with both VS Code Remote and GitHub Codespaces.
2. **Use a cloud‑based terminal** (e.g., GitHub Codespaces, Gitpod) for heavy tasks like `pnpm run build`.
3. For quick edits, the **GitHub mobile app** allows you to edit markdown and JSON files directly.

---

## 4. Summary
- The primary user stories revolve around **search, transcription, export, and mobile accessibility**.
- A **PWA** is sufficient for most mobile use‑cases; a native wrapper is optional for push notifications.
- **Coding on a phone** is feasible via remote development tools; direct local builds on iOS are not practical, but Android can use Termux.

Feel free to adjust the stories or add more details specific to your workflow.
