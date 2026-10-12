import type { Changes, SyncedAttempt, SyncedCard, SyncedText, SyncRequest, SyncResponse } from '../../shared/sync.ts'
import type { Db, Queryable } from './db.ts'

/** Rows returned per sync; the client asks again while `more` is true. */
export const PAGE = 500

/**
 * Pushes the client's changes and returns everything that changed since its cursor.
 *
 * Each write takes the next value of one shared sequence, so "changed since" is a single number.
 * Two syncs for the same user could otherwise commit out of sequence order, and a client whose
 * cursor had already passed the lower number would never see that row. A per-user advisory lock
 * makes one user's syncs run one at a time, which keeps their sequence numbers in commit order.
 */
export async function sync(db: Db, userId: string, req: SyncRequest, page = PAGE): Promise<SyncResponse> {
  return db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [userId])
    for (const t of req.texts) await putText(tx, userId, t)
    for (const a of req.attempts) await putAttempt(tx, userId, a)
    for (const c of req.cards) await putCard(tx, userId, c)
    return pull(tx, userId, req.cursor, page)
  })
}

// Each upsert only overwrites a row the incoming version is newer than (last write wins), and
// takes a new sequence number when it does, so other devices pick the change up.

function putText(db: Queryable, userId: string, t: SyncedText) {
  return db.query(
    `insert into texts (user_id, id, title, body, created_at, updated_at, deleted) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, id) do update set title = excluded.title, body = excluded.body, updated_at = excluded.updated_at,
       deleted = excluded.deleted, seq = nextval('sync_seq')
     where texts.updated_at < excluded.updated_at`,
    [userId, t.id, t.title, t.body, t.createdAt, t.updatedAt, t.deleted],
  )
}

function putAttempt(db: Queryable, userId: string, a: SyncedAttempt) {
  return db.query(
    `insert into attempts (user_id, id, text_id, at, score, read, total, practice, updated_at, deleted)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, id) do update set deleted = excluded.deleted, updated_at = excluded.updated_at, seq = nextval('sync_seq')
     where attempts.updated_at < excluded.updated_at`,
    [userId, a.id, a.textId, a.at, a.score, a.read, a.total, JSON.stringify(a.practice), a.updatedAt, a.deleted],
  )
}

function putCard(db: Queryable, userId: string, c: SyncedCard) {
  return db.query(
    `insert into cards (user_id, word, box, due, misses, example, updated_at, deleted) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, word) do update set box = excluded.box, due = excluded.due, misses = excluded.misses,
       example = excluded.example, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = nextval('sync_seq')
     where cards.updated_at < excluded.updated_at`,
    [userId, c.word, c.box, c.due, c.misses, c.example, c.updatedAt, c.deleted],
  )
}

interface Row {
  kind: 'text' | 'attempt' | 'card'
  seq: string
  data: Record<string, unknown>
}

async function pull(db: Queryable, userId: string, cursor: number, page: number): Promise<SyncResponse> {
  const { rows } = await db.query<Row>(
    `select * from (
       select 'text' as kind, seq, jsonb_build_object('id', id, 'title', title, 'body', body, 'createdAt', created_at,
         'updatedAt', updated_at, 'deleted', deleted) as data from texts where user_id = $1 and seq > $2
       union all
       select 'attempt', seq, jsonb_build_object('id', id, 'textId', text_id, 'at', at, 'score', score, 'read', read,
         'total', total, 'practice', practice, 'updatedAt', updated_at, 'deleted', deleted) from attempts where user_id = $1 and seq > $2
       union all
       select 'card', seq, jsonb_build_object('word', word, 'box', box, 'due', due, 'misses', misses, 'example', example,
         'updatedAt', updated_at, 'deleted', deleted) from cards where user_id = $1 and seq > $2
     ) changed order by seq limit $3`,
    [userId, cursor, page + 1],
  )
  const more = rows.length > page
  const out: Changes = { texts: [], attempts: [], cards: [] }
  for (const r of rows.slice(0, page)) {
    // bigint columns come back from jsonb as numbers, which is fine for ms timestamps
    if (r.kind === 'text') out.texts.push(r.data as unknown as SyncedText)
    else if (r.kind === 'attempt') out.attempts.push(r.data as unknown as SyncedAttempt)
    else out.cards.push(r.data as unknown as SyncedCard)
  }
  const last = rows.slice(0, page).at(-1)
  return { ...out, cursor: last ? Number(last.seq) : cursor, more }
}
