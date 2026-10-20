// Writes audit entries on the caller's connection so they commit or roll back with the change itself.
export async function audit(conn, entries) {
  const list = Array.isArray(entries) ? entries : [entries]
  if (list.length === 0) return
  await conn.query(
    'INSERT INTO audit_log (user_id, entity_type, entity_id, client_id, action, changes) VALUES ?',
    [list.map((e) => [e.userId, e.entityType, e.entityId, e.clientId ?? null, e.action,
      e.changes ? JSON.stringify(e.changes) : null])],
  )
}

// Field-level diff: { field: { from, to } } for every field whose value changed.
export function diff(before, after, fields) {
  const changes = {}
  for (const f of fields) {
    if (after[f] !== undefined && String(before[f]) !== String(after[f])) {
      changes[f] = { from: before[f], to: after[f] }
    }
  }
  return changes
}
