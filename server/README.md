# FlowOps Backend Requirements

This folder contains the standalone API workspace for the FlowOps Next.js UI. The current implementation is a local demo scaffold; this document tracks the target requirements and the remaining production work.

## Local API Scaffold

The API uses Express, JavaScript, Zod, Prisma, and MongoDB. Configure `DATABASE_URL` in an untracked `.env` file using `.env.example`. It currently provides:

- `GET /health`
- Database-backed email/password sign-in, sign-out, and current-user routes under `/api/v1/auth`, with hashed passwords and revocable, expiring sessions
- Stored account monitoring for successful logins, owner/admin-created accounts, and admin-mediated password changes; the admin monitoring endpoint is restricted to built-in organization owners/admins
- Website page-view tracking stores route, timestamp, and signed-in user/workspace when available; it does not collect IP addresses or device/browser fingerprints
- Admin-mediated password recovery: users request a reset and an eligible organization owner or admin sets a temporary password. Owner self-service recovery is unavailable.
- MongoDB-backed, organization-scoped task and project list/detail/create/update/archive/delete routes, with search, filters, pagination, project milestones, deliverables, and risks
- Task comments and organization member management routes
- Owner/admin user creation with organization roles
- Organization-scoped custom role definitions with persisted permission assignments enforced by API authorization
- Dashboard, task, and project summaries backed by organization data
- Profile updates, notification read/dismiss routes, activity and audit history reads, and a database-backed analytics overview
- CORS configured for the frontend origin in `WEB_ORIGIN`

Set up the MongoDB schema and demo records, then start the API from this folder:

```bash
npm install
npm run db:setup
npm run dev
```

Before setup, copy `.env.example` to `.env` and replace the MongoDB connection-string placeholders with your database credentials. `db:setup` generates the Prisma client, pushes the schema to MongoDB, and loads fake seed records; it does not run SQL migrations. The default API address is `http://localhost:4000`. Demo credentials are `team@flowops.example` / `password123`.

**Demo limitations:** authentication uses seeded demo credentials and is not production-ready. Invitation email delivery and binary attachment storage are not configured; the API does not claim to send invitations or store uploaded files. Billing and integrations are not implemented. Do not expose this demo API publicly or use real user data.

### Frontend API connection

From `frontend/`, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_BASE_URL` to the backend API base (default `http://localhost:4000/api/v1`). Start the backend on port 4000 and the frontend on port 3000; set the server's `WEB_ORIGIN=http://localhost:3000` when using a different web origin. The frontend sends requests with credentials enabled so the backend's HttpOnly session cookie is used. Sign in using a registered account (for a local seeded database: `team@flowops.example` / `password123`).

The frontend is connected to the backend's auth/profile, organization, project, task/comment, dashboard/analytics, custom-role/member, notification, audit/activity, password-recovery, and monitoring APIs. Account creation means owner/admin-created accounts; there is no public signup route. UI sections for billing, integrations, and uploads are marked unavailable until their server APIs exist.

`GET /api/v1/admin/monitoring` returns the latest login, account creation, password change, and page-view records for the selected workspace. Only built-in organization owners and admins can read it; managers, members, viewers, and custom roles are denied by the API regardless of frontend visibility.

### Password recovery setup and routes

Configure Resend with `RESEND_API_KEY` and `EMAIL_FROM`. The sender address must use a domain verified in Resend; otherwise delivery fails with `EMAIL_DELIVERY_FAILED`. If `EMAIL_FROM` is omitted, the development fallback `FlowOps <onboarding@resend.dev>` is used. Without Resend, forgot-password requests return `503 RECOVERY_NOT_CONFIGURED`. All roles use the same admin-mediated recovery flow: requests notify eligible organization approvers by email and in-app notification, and an owner or admin sets the new temporary password. There is no viewer OTP or self-service password reset.

The current `.env` must contain a valid MongoDB URL; remove any accidental trailing quote from the `DATABASE_URL` query string before running Prisma commands.

- `POST /api/v1/auth/password/forgot` — unauthenticated; accepts `{ "email": "...", "organizationId": "optional" }`. It notifies eligible organization owners/admins, who review the request and set a new temporary password. There is no OTP verification endpoint.
- `GET /api/v1/auth/password/requests?organizationId=...` — authenticated owner/admin inbox for eligible member recovery requests.
- `POST /api/v1/auth/password/requests/:requestId/complete?organizationId=...` — authenticated eligible admin/owner supplies `{ "newPassword": "at-least-12-characters" }`. Existing sessions for that user are revoked.
- `POST /api/v1/organizations/:organizationId/users` — organization owner/admin creates a user with `{ "name": "...", "email": "...", "password": "at-least-12-characters", "role": "MEMBER" }`. The role may be `OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, or `VIEWER` (default `MEMBER`); an optional `customRoleId` assigns a custom role instead. Only owners may assign `OWNER`, and custom roles cannot replace `OWNER` or `ADMIN`.

User creation stores only a bcrypt password hash and appends a `USER_CREATED` audit record in the same database transaction. Existing email addresses return `409 EMAIL_ALREADY_REGISTERED`; the plaintext password is never returned.

Built-in organization roles remain available. Owners/admins and members granted `ROLE_MANAGE` can create, update, and delete custom roles; custom role managers may grant only permissions they themselves hold. Listing roles and retrieving the permission catalog require `MEMBER_MANAGE`. A custom role replaces the member's built-in permission set, and its permissions are checked on project, task, member, analytics, audit, notification, and comment endpoints. Only built-in owners/admins can grant the built-in admin role, and only owners can grant the owner role. Delegated managers cannot assign built-in roles with permissions they do not hold or manage/remove admins. Owners retain the built-in owner role and cannot be assigned a custom role. A role assigned to members cannot be deleted until those members are reassigned.

The general route reference is in `API_ENDPOINTS.md`. Import the collection from `postman/FlowOps.postman_collection.json`.

Core routes are available both in organization-scoped form (for example, `/api/v1/organizations/:organizationId/tasks`) and, where appropriate, in a short form (for example, `/api/v1/tasks`) that resolves the user's selected `x-organization-id` or first organization. Dashboard and summary endpoints are `/api/v1/dashboard/overview`, `/api/v1/tasks/summary`, and `/api/v1/projects/summary`; analytics is available at `/api/v1/analytics/overview`.

### Deploying on Render

The repository-root `render.yaml` defines a native Node web service rooted in this folder. Render installs the locked dependencies, generates the Prisma client, starts the API with `npm start`, and checks `GET /health`. The service uses Node.js 22, as specified in `package.json`.

1. In Render, create a new Blueprint from this repository and use the repository root as the Blueprint directory.
2. Set `DATABASE_URL` to a MongoDB connection string for a hosted MongoDB database.
3. Set `WEB_ORIGIN` to the exact origin of the deployed frontend (scheme and hostname, without a path).
4. Optionally set `REDIS_URL` for shared session caching and distributed rate limits. Without it, the API runs without Redis.
5. Optionally set `RESEND_API_KEY` and `EMAIL_FROM` if password-recovery email delivery is configured.

Render supplies `PORT` at runtime. The service plan in the Blueprint is free, so it may spin down after inactivity. The app is still a demo scaffold; review the demo limitations above before exposing it publicly or using real user data.

## Scaling and performance

- **Rate limiting:** Redis-backed limiters on every `/api/v1` route (300/min per IP), login (10/min per IP+email), forgot-password (5/min per IP), page views (60/min per session), and an authenticated per-user budget (600/min). All fail open if Redis is down.
- **Process scaling:** `npm run start:cluster` forks one worker per CPU (cap with `WORKERS`); `npm start` runs a single process with `--max-old-space-size=4096` and `UV_THREADPOOL_SIZE=8`. On Render, scale with additional service instances rather than starting a cluster in one instance.
- **Connection pooling:** MongoDB driver default is `maxPoolSize=100` per process. Divide the cluster connection budget across replicas (e.g. `?maxPoolSize=50` for 2 instances); Atlas limits are 500 (Free/Flex) per node.
- **Indexes:** `prisma/schema.prisma` carries compound indexes for every list query path; run `npm run db:push` after pulling schema changes.
- **Analytics counts:** monitoring dashboard totals use a 15s in-process count cache (`src/count-cache.js`).
- **Metrics:** `GET /metrics` reports request/rate-limit counters, event-loop delay p95, heap/RSS, and DB/Redis/queue status for scraping.
- **Compression:** JSON responses are gzipped (`compression`, 1KB threshold).
- **Load testing:** validate with k6/autocannon against `/api/v1` before raising replica counts.

## Database Foundation

- DB is configured through `DATABASE_URL` and MongoDB.
- `prisma/schema.prisma` defines users, organizations, memberships, sessions, projects, tasks, comments, attachments, notifications, activity, and audit records with string IDs mapped to MongoDB `_id` fields.
- MongoDB uses `prisma db push`; the existing SQL migration under `prisma/migrations/` is legacy PostgreSQL history and is not applied.
- `prisma/seed.js` creates fake workspace, project, and task records plus a demo user with a bcrypt-hashed password.
- Authentication users, memberships, and sessions, along with organization, task, project, comment, notification, activity, and audit API data, are stored in MongoDB through Prisma.
- Do not run the legacy PostgreSQL migration against MongoDB.

## Proposed Defaults

- Runtime: current Node.js LTS with JavaScript.
- API: REST JSON service in this `server/` workspace, separate from the Next.js frontend.
- Database: MongoDB, with Prisma schema push and generated types.
- Authentication: email/password with bcrypt password hashing and HTTP-only cookie sessions. Seeded demo credentials and the current session setup are for local development, not production deployment.
- API contract: versioned under `/api/v1`; validate request and response shapes and generate/maintain OpenAPI documentation.
- Local development: environment variables in an untracked `.env`; provide an `.env.example` with placeholders only.

These are recommendations, not irreversible choices. Confirm database hosting and deployment before provisioning services.

## Functional Requirements

### Authentication and accounts

- Sign in, sign out, and return the current authenticated user.
- Store password hashes only; never store or log plaintext passwords.
- Support session expiry and revocation; protect state-changing routes against CSRF when cookie-based auth is used.
- Add password reset and email verification when an email provider is selected.
- Support profile reads and updates, account preferences, and timezone.
- Do not treat the current browser-local demo session as secure authentication.

### Organizations and access control

- A user can belong to one or more organizations/workspaces.
- Users can create and switch organizations; organization membership determines access.
- Enforce organization isolation on every query and mutation, not only in the UI.
- Provide roles and permissions for owner, admin, manager, member, and read-only access; the exact role matrix must be approved.
- Support invitations, membership changes, and role changes. Email invitations require an email provider.

### Projects

- Create, list, view, update, archive, and delete projects with organization scoping.
- Store owner, status, progress, dates, budget/value, description, milestones, deliverables, and risk/blocker records.
- Filter, search, sort, and paginate project lists.
- Record project activity and status changes.

### Tasks and work queue

- Create, list, view, update, archive, and delete tasks with organization scoping.
- Store title, notes/description, assignee, status, priority, due date, progress, project association, and timestamps.
- Support search, status/priority/assignee/project filters, sorting, and pagination.
- Persist status and editor changes; validate status transitions if the organization configures a workflow.
- Support comments and file attachments as separate resources.

### Notifications and audit history

- Create in-app notifications for assignments, mentions, approvals, and relevant workflow changes.
- List, filter, mark read/unread, and optionally dismiss notifications for the signed-in user.
- Record security-sensitive and business-critical activity with actor, organization, target, action, timestamp, and safe metadata.
- Audit logs must be append-only through normal application endpoints.

### Analytics

- Derive dashboard and report metrics from persisted organization data.
- Support date-range and organization filters and document metric definitions.
- Return aggregate summaries and time-series data for revenue, activation, retention, project health, task throughput, and conversion metrics.
- Replace the current hard-coded chart data without exposing another organization's records.

### Files

- Upload and download authorized project/task attachments.
- Validate file size and allowed content types; use private object storage and short-lived signed access URLs in production.
- Keep file binaries out of MongoDB documents; store metadata and ownership references in MongoDB.

## Proposed API Surface

All routes require an authenticated session except sign-in and explicitly public health/docs endpoints. Organization-scoped routes must verify membership and permissions.

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/password/forgot` and `POST /api/v1/auth/password/reset` (after email delivery is configured)
- `GET|POST /api/v1/organizations`; `GET|PATCH /api/v1/organizations/:organizationId`
- `GET|POST /api/v1/organizations/:organizationId/members`; member role/update/removal routes
- `GET|POST /api/v1/organizations/:organizationId/projects`; `GET|PATCH|DELETE /api/v1/organizations/:organizationId/projects/:projectId`
- `GET|POST /api/v1/organizations/:organizationId/tasks`; `GET|PATCH|DELETE /api/v1/organizations/:organizationId/tasks/:taskId`
- Task comments and attachment routes scoped through their parent task/project.
- `GET /api/v1/organizations/:organizationId/notifications`; notification read/dismiss routes
- `GET /api/v1/organizations/:organizationId/activity`
- `GET /api/v1/organizations/:organizationId/analytics/overview` and report/time-series routes
- `GET /health` for process health; database readiness should be reported separately.

Use consistent pagination, filtering, validation errors, and response envelopes. Never trust an organization ID supplied by the browser without checking the current user's membership.

## Data Model Baseline

- `User`
- `Organization`
- `OrganizationMembership` (user, organization, role)
- `Session` or equivalent revocable session record
- `Project`
- `ProjectMilestone`, `ProjectDeliverable`, `ProjectRisk`
- `Task`
- `TaskComment`
- `FileAttachment`
- `Notification`
- `ActivityEvent` / `AuditEvent`

Every organization-owned record needs an organization relationship and appropriate indexes. Define deletion/archival and retention policies before production data is loaded.

## Quality, Security, and Operations

- Validate all input on the server; use parameterized database access and safe output handling.
- Apply authentication, authorization, organization scoping, and rate limits to sensitive routes.
- Configure CORS for the approved frontend origin; use TLS in deployed environments.
- Do not commit credentials, real personal data, or production database URLs.
- Add structured logs with request IDs while excluding passwords, tokens, and sensitive fields.
- Add unit tests for domain rules, integration tests for API/database behavior, and authorization tests for cross-organization access.
- Run migrations predictably and provide a documented seed command for fake development data only.
- Provide readiness/health checks, backup/restore strategy, and error monitoring before production deployment.

## Required Decisions Before Implementation

1. MongoDB hosting: MongoDB Atlas or another provider.
2. Authentication: email/password only for v1, or include an identity provider/SSO.
3. Session style and frontend origin/domain for local and production environments.
4. Email provider for verification, invitations, and password resets.
5. File storage provider and upload limits.
6. Deployment target for the standalone API and database.
7. Approved role-permission matrix and initial v1 modules.
8. Data retention, account deletion, and audit-log retention policies.

Until these decisions and real API credentials are supplied, development can use fake seed records and local services only. The browser-local task store is temporary demo storage and must not be treated as shared or durable production storage.
