async function removeFutureAllocations(db, packageId) {
  const removedResult = await db.query(
    `DELETE FROM session_attendance attendance
     USING sessions session
     WHERE attendance.session_id = session.id
       AND attendance.package_id = $1
       AND attendance.status = 'scheduled'
       AND attendance.recurring_booking_id IS NOT NULL
       AND (session.session_date + session.start_time) > LOCALTIMESTAMP
       AND attendance.rescheduled_from_attendance_id IS NULL
     RETURNING attendance.session_id`,
    [packageId]
  );
  const removedSessionIds = [...new Set(removedResult.rows.map((row) => row.session_id))];
  if (removedSessionIds.length === 0) return;

  await db.query(
    `DELETE FROM sessions session
     WHERE session.id = ANY($1::bigint[])
       AND NOT EXISTS (
         SELECT 1
         FROM session_attendance attendance
         WHERE attendance.session_id = session.id
       )`,
    [removedSessionIds]
  );
}

export async function allocatePackageSessions(db, packageId) {
  const packageResult = await db.query(
    `SELECT sessions_total
     FROM packages
     WHERE id = $1
     FOR UPDATE`,
    [packageId]
  );
  await removeFutureAllocations(db, packageId);

  const assignedResult = await db.query(
    `SELECT COUNT(*)::int AS assigned_sessions
     FROM session_attendance
     WHERE package_id = $1
       AND status <> 'cancelled'`,
    [packageId]
  );
  const remainingCredits =
    packageResult.rows[0].sessions_total - assignedResult.rows[0].assigned_sessions;
  if (remainingCredits <= 0) return 0;

  const candidatesResult = await db.query(
    `SELECT
       booking.id AS recurring_booking_id,
       booking.client_id,
       booking.package_id,
       booking.program_id,
       booking.session_type,
       booking.start_time::text,
       candidate_date::date::text AS session_date,
       settings.group_capacity
     FROM approved_recurring_bookings booking
     CROSS JOIN scheduling_settings settings
     CROSS JOIN LATERAL generate_series(
       booking.starts_on,
       booking.ends_on,
       INTERVAL '7 days'
     ) candidate_date
     WHERE booking.package_id = $1
       AND booking.status = 'active'
       AND (candidate_date::date + booking.start_time) > LOCALTIMESTAMP
       AND NOT EXISTS (
         SELECT 1
         FROM session_attendance attendance
         JOIN sessions session ON session.id = attendance.session_id
         WHERE attendance.recurring_booking_id = booking.id
           AND session.session_date = candidate_date::date
       )
     ORDER BY candidate_date, booking.start_time, booking.id
     LIMIT $2`,
    [packageId, remainingCredits]
  );

  for (const candidate of candidatesResult.rows) {
    await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      44032,
      candidate.session_date
    ]);
    const overlappingSessions = await db.query(
      `SELECT id, program_id, session_type, start_time::text
       FROM sessions
       WHERE session_date = $1::date
         AND status <> 'cancelled'
         AND start_time < ($2::time + INTERVAL '60 minutes')
         AND (start_time + INTERVAL '60 minutes') > $2::time
       FOR UPDATE`,
      [candidate.session_date, candidate.start_time]
    );
    const compatibleGroupSession = overlappingSessions.rows.find(
      (session) =>
        candidate.session_type === "group" &&
        session.session_type === "group" &&
        session.program_id === candidate.program_id &&
        session.start_time.slice(0, 5) === candidate.start_time.slice(0, 5)
    );
    const hasIncompatibleOverlap = overlappingSessions.rows.some(
      (session) => session.id !== compatibleGroupSession?.id
    );

    if (
      hasIncompatibleOverlap ||
      (overlappingSessions.rows.length > 0 && !compatibleGroupSession)
    ) {
      const error = new Error(
        `A session already overlaps ${candidate.session_date} at ${candidate.start_time.slice(0, 5)}`
      );
      error.code = "SLOT_CONFLICT";
      throw error;
    }

    let sessionId = compatibleGroupSession?.id;
    if (!sessionId) {
      const sessionResult = await db.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status
         )
         VALUES (
           $1,
           $2,
           $3::date,
           $4::time,
           $5,
           'scheduled'
         )
         RETURNING id`,
        [
          candidate.program_id,
          candidate.session_type,
          candidate.session_date,
          candidate.start_time,
          candidate.session_type === "group" ? candidate.group_capacity : 1
        ]
      );
      sessionId = sessionResult.rows[0].id;
    }

    await db.query(
      `INSERT INTO session_attendance (
         session_id,
         client_id,
         package_id,
         recurring_booking_id
       )
       VALUES ($1, $2, $3, $4)`,
      [
        sessionId,
        candidate.client_id,
        candidate.package_id,
        candidate.recurring_booking_id
      ]
    );
  }

  return candidatesResult.rows.length;
}
