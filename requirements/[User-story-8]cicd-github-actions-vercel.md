# Story Decomposition: CI/CD with GitHub Actions and Vercel Deployment

## INVEST Analysis

### Abstract Task

**"Automated Build, Test, and Deploy Pipeline for Every Commit to main"**

**Analysis Dimensions**:
- **Core Responsibility**: Ensure every push to the `main` branch triggers an automated build, runs tests, and deploys the production bundle to Vercel with a public URL.
- **Primary Operations**: Trigger on push to main, install dependencies, run linter, run tests, build production bundle, deploy to Vercel, report status.
- **Key Constraints**: Build must fail on lint or test errors; deployment URL must be publicly accessible.
- **Technical Complexity**: Low — standard GitHub Actions + Vercel integration.
- **Business Complexity**: Low — clear automation requirement.

### INVEST Evaluation

- ✅ **Independent**: Can be set up without any game code changes; only requires a repository and Vercel account.
- ✅ **Negotiable**: Exact Node version, lint rules, and deployment strategy (preview vs. production) are discussable.
- ✅ **Valuable**: Enables rapid iteration, automatic QA feedback, and shareable builds for stakeholders.
- ✅ **Estimable**: 1–2 days for a developer familiar with GitHub Actions.
- ✅ **Small**: Single cohesive pipeline story.
- ✅ **Testable**: Push a commit and verify the pipeline runs, tests pass, and the site is live.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — CI/CD is a single infrastructure deliverable.

---

## [STORY-001-008] CI/CD with GitHub Actions and Vercel Deployment

### Background

The development team needs rapid feedback on every code change. Manual builds and deployments are error-prone and slow. This story establishes an automated pipeline: every push to `main` triggers a GitHub Actions workflow that installs dependencies, runs the linter, executes the Vitest suite, builds a production bundle via Vite, and deploys the result to Vercel. The deployed game is immediately accessible via a public URL, enabling team members and stakeholders to play the latest version without any local setup.

Key points:
- This is a Phase 0 foundational infrastructure story.
- The pipeline prevents broken builds from reaching production.
- Deployment to Vercel provides automatic HTTPS, CDN, and preview URLs for pull requests.

### Business Value

- Reduce time-to-feedback from hours to minutes.
- Prevent broken builds from being deployed by enforcing lint and test gates.
- Provide a stable, public URL for demos, playtesting, and stakeholder reviews.

### Dependencies and Assumptions

- **Prerequisites**: Repository is hosted on GitHub; Vercel account and project are configured; `package.json` has `build`, `test`, and `lint` scripts.
- **Data assumptions**: No sensitive secrets are hard-coded in the repository.
- **Integration points**: GitHub Actions runners; Vercel CLI/API; project build toolchain (Vite, Vitest, ESLint).
- **Business constraints**: Deployment must not exceed 5 minutes from push to live.

### Scope In

- Create a GitHub Actions workflow (`.github/workflows/ci.yml`) that triggers on every push to `main`.
- Install Node.js dependencies (`npm ci`).
- Run ESLint (`npm run lint`) and fail the pipeline on errors.
- Run Vitest tests (`npm test`) and fail the pipeline on failures.
- Build the production bundle (`npm run build`).
- Deploy the `dist/` folder to Vercel using the Vercel CLI or GitHub integration.
- Report deployment status (success/failure) as a commit status check.
- Generate a preview deployment URL for pull requests.

### Scope Out

- Multi-environment deployments (staging, production) — only `main` → production.
- Automated semantic versioning or changelogs.
- Performance regression testing in CI.
- Slack/Discord notifications (can be added later).

### Acceptance Criteria (ACs)

#### AC1: Automatic Pipeline Trigger
**Given** the repository has the CI workflow configured
**When** a developer pushes a commit to the `main` branch
**Then** the GitHub Actions workflow starts within 30 seconds

#### AC2: Lint Gate
**Given** a commit introduces an ESLint error
**When** the pipeline runs
**Then** the lint step fails, the build and deploy steps are skipped, and the commit status is marked as failed

#### AC3: Test Gate
**Given** a commit breaks an existing Vitest test
**When** the pipeline runs
**Then** the test step fails, the build and deploy steps are skipped, and the commit status is marked as failed

#### AC4: Successful Deployment
**Given** a commit passes lint and tests
**When** the pipeline completes
**Then** the production bundle is deployed to Vercel, and the game is accessible via a public HTTPS URL within 5 minutes of the push

#### AC5: Preview Deployment for PRs
**Given** a developer opens a pull request
**When** the PR pipeline completes
**Then** a unique preview URL is generated and posted as a comment on the PR, allowing reviewers to test the changes without merging

#### Non-Functional Expectations
- Total pipeline duration (push to live) must not exceed 5 minutes.
- The Vercel deployment must serve the game with correct MIME types for `.wasm` and `.onnx` files.
