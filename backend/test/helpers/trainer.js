// AUTH-03 made clients.trainer_user_id NOT NULL, so every fixture needs an
// owner. Fixtures insert clients with a scalar subquery rather than an extra
// bound parameter -- `(SELECT id FROM trainer_users ORDER BY id LIMIT 1)` --
// because the insert statements have a dozen different shapes and renumbering
// $1, $2, ... in each one is how a fixture quietly binds the wrong value.
//
// That subquery returns NULL when no trainer exists, which then fails the NOT
// NULL constraint, so call ensureTestTrainer() before inserting any client.

/** The expression fixtures use to own a client, with no extra parameter. */
export const OWNER_SUBQUERY = "(SELECT id FROM trainer_users ORDER BY id LIMIT 1)";

const DEFAULT_EMAIL = "integration-owner@days4fitness.local";

/**
 * Makes sure the suite has a trainer to own its fixtures, and returns it.
 * Safe to call repeatedly: the suites share one database and run in one
 * process, so this has to be idempotent rather than assume it runs first.
 */
export async function ensureTestTrainer(db, { email = DEFAULT_EMAIL, role = "admin" } = {}) {
  const result = await db.query(
    `INSERT INTO trainer_users (email, name, role, password_hash)
     VALUES ($1, 'Integration Owner', $2, 'not-a-real-hash')
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
     RETURNING id, email, name, role`,
    [email, role]
  );
  return result.rows[0];
}

/** The acting user a service call needs, for a trainer row. */
export function actorFor(trainer) {
  return { id: trainer.id, role: trainer.role };
}

// AUTH-03 gave every clients service method the acting trainer as its last
// argument. Binding it once here beats repeating it at every call site, and
// the arity map matters: a call that omits an optional middle argument would
// otherwise slide the actor into the gap instead of the last position.
const CLIENT_SERVICE_ARITY = {
  listClients: 1,
  listClientOptions: 0,
  getClient: 1,
  createClient: 1,
  updatePreferences: 2,
  updateClient: 2,
  setClientActive: 2,
  addClientGoal: 2,
  updateClientGoal: 3,
  removeClientGoal: 2,
  getPackageHistory: 1,
  getSessionHistory: 1
};

/** A clients service that acts as `actor` without every call saying so. */
export function bindActor(service, actor) {
  const bound = { ...service };
  for (const [name, arity] of Object.entries(CLIENT_SERVICE_ARITY)) {
    if (typeof service[name] !== "function") continue;
    bound[name] = (...args) => {
      const padded = [...args];
      while (padded.length < arity) padded.push(undefined);
      return service[name](...padded, actor);
    };
  }
  return bound;
}

const PACKAGES_SERVICE_ARITY = {
  listClientPackages: 1,
  createClientPackage: 2,
  addPayment: 2,
  reversePayment: 2
};

/** The packages equivalent of bindActor. */
export function bindPackagesActor(service, actor) {
  const bound = { ...service };
  for (const [name, arity] of Object.entries(PACKAGES_SERVICE_ARITY)) {
    if (typeof service[name] !== "function") continue;
    bound[name] = (...args) => {
      const padded = [...args];
      while (padded.length < arity) padded.push(undefined);
      return service[name](...padded, actor);
    };
  }
  return bound;
}
