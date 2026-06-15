# Backend Build Roadmap

This checklist is the source of truth for backend development. Items are checked only after implementation and verification. Each phase ends with a review before the next phase begins.

## Agreed Business Rules

- Client schedule selections are preferences until approved by the trainer.
- Approved bookings repeat weekly.
- A client may have multiple recurring sessions per week.
- Group sessions have a default capacity of 8.
- Every session lasts 60 minutes.
- Cancelled sessions do not consume package credits and may be rescheduled.
- Completed sessions and no-shows consume package credits.
- Schedule preferences are optional when creating a client.
- Every package expires two months after its purchase date.
- No sessions are held on Sundays.
- Saturday sessions must finish by 11:00.

## Phase 1: Backend Foundation

- [x] Define the API response and error format.
- [x] Add request validation utilities.
- [x] Separate client route logic into routes, controllers, services, and queries.
- [x] Add environment-aware CORS configuration.
- [x] Add backend test tooling and a test database strategy.
- [x] Add health and database readiness checks.
- [x] Add APIs for programs, package sizes, pricing, and business hours.
- [x] Remove duplicated pricing and scheduling rules from the frontend.
- [x] Add tests for client creation and preference validation.
- [x] Run the full backend and frontend verification checks.
- [x] **Phase 1 review and approval**

## Phase 2: Scheduling Data Model

- [x] Create a migration for recurring booking requests.
- [x] Create a migration for approved recurring bookings.
- [x] Redesign scheduled sessions to support one-on-one and group sessions.
- [x] Add session attendance records so group sessions can contain multiple clients.
- [x] Add configurable group capacity with a default of 8.
- [x] Add session status values: scheduled, completed, cancelled, and no-show.
- [x] Add rescheduling links between original and replacement sessions.
- [x] Preserve existing client preference data during migration.
- [x] Add database constraints and indexes for conflicts and common queries.
- [x] Add migration and schema tests.
- [x] **Phase 2 review and approval**

## Phase 3: Preference Approval And Recurrence

- [x] Make preferences optional during client creation.
- [x] Add endpoints to create and update booking preferences.
- [x] Add an endpoint for trainers to list pending preferences.
- [x] Add trainer approval and rejection endpoints.
- [x] Support multiple approved weekly slots per client.
- [x] Generate weekly sessions up to package expiry.
- [x] Stop allocation when all package credits have been assigned.
- [x] Prevent Sunday bookings.
- [x] Enforce weekday and Saturday operating hours.
- [x] Detect one-on-one time conflicts.
- [x] Enforce group capacity.
- [x] Handle partial approval when only some preferred slots are available.
- [x] Add the trainer UI for reviewing, approving, and rejecting preferred slots.
- [x] Add recurrence, conflict, capacity, and expiry tests.
- [x] **Phase 3 review and approval**

## Phase 4: Schedule Operations

- [x] Add weekly schedule query endpoints.
- [x] Add single-session detail endpoint.
- [x] Add manual session booking.
- [x] Add session rescheduling.
- [x] Add session cancellation without consuming a credit.
- [x] Add replacement booking flow for cancelled sessions.
- [x] Add mark-completed action that consumes one credit.
- [x] Add mark-no-show action that consumes one credit.
- [x] Prevent credits from being consumed twice.
- [x] Prevent booking against expired or exhausted packages.
- [x] Connect the Schedule page to real API data.
- [x] Connect previous-week and next-week navigation.
- [x] Connect schedule modal actions.
- [x] Add operation and concurrency tests.
- [x] **Phase 4 review and approval**

## Phase 5: Complete Client Management

- [x] Add update-client endpoint.
- [x] Connect the Edit Client form.
- [x] Add client archive/deactivate behavior.
- [x] Add server-side client search and filtering.
- [x] Add pagination for the clients list.
- [x] Add client package history endpoint.
- [x] Add real client session history endpoint.
- [x] Show pending, approved, and rejected preferences on the profile.
- [x] Connect profile session actions to the API.
- [x] Add client-management tests.
- [ ] **Phase 5 review and approval**

## Phase 6: Packages And Payments

- [ ] Add package status and package-history rules.
- [ ] Add package renewal and new-package endpoints.
- [ ] Enforce the two-month expiry rule in the backend and database.
- [ ] Define payment methods and payment statuses.
- [ ] Create payment records with amount, date, method, and reference.
- [ ] Calculate paid amount and outstanding balance.
- [ ] Replace the package `paid` boolean workflow with payment records.
- [ ] Add payment correction or reversal handling.
- [ ] Connect package and payment controls in the UI.
- [ ] Add package, expiry, and payment tests.
- [ ] **Phase 6 review and approval**

## Phase 7: Dashboard And Reporting

- [ ] Add today's sessions endpoint.
- [ ] Add completed and remaining session totals.
- [ ] Add unpaid and outstanding-balance summaries.
- [ ] Add expiring-package summaries.
- [ ] Add basic revenue summaries.
- [ ] Connect the Dashboard page to real API data.
- [ ] Remove remaining dashboard mock data.
- [ ] Add dashboard query tests.
- [ ] **Phase 7 review and approval**

## Phase 8: Authentication And Production Readiness

- [ ] Define trainer accounts and roles.
- [ ] Add secure authentication.
- [ ] Protect private API routes.
- [ ] Add authorization checks.
- [ ] Add audit logging for important changes.
- [ ] Add structured application logging.
- [ ] Add security headers and request size limits.
- [ ] Add rate limiting where appropriate.
- [ ] Add production CORS rules.
- [ ] Add database backup and restore documentation.
- [ ] Add deployment migration strategy.
- [ ] Add end-to-end tests for critical flows.
- [ ] Add API documentation.
- [ ] Run final security and regression review.
- [ ] **Phase 8 review and approval**

## Completion Rule

A checklist item is complete only when:

1. The implementation is finished.
2. Relevant tests or verification checks pass.
3. The frontend behavior is connected when the item includes UI work.
4. Any migration or setup instructions are documented.

No new phase begins until the previous phase review is approved.
