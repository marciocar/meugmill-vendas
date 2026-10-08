import { eq } from 'drizzle-orm';
import { municipalities, states } from '../../db/schema.js';
import type { Conn } from '../shared/db.js';

export function findMunicipality(conn: Conn, ibgeCode: number) {
  return conn.select().from(municipalities).where(eq(municipalities.ibgeCode, ibgeCode)).get();
}

export function findStateByCode(conn: Conn, ibgeCode: number) {
  return conn.select().from(states).where(eq(states.ibgeCode, ibgeCode)).get();
}

export function findStateByUf(conn: Conn, uf: string) {
  return conn.select().from(states).where(eq(states.uf, uf)).get();
}
