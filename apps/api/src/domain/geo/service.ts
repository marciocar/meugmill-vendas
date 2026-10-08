import { withRoleGuard } from '../visibility/profiles.js';
import { asc, eq } from 'drizzle-orm';
import { municipalities, states } from '../../db/schema.js';
import type { Actor } from '../shared/authz.js';
import type { Db } from '../shared/db.js';
import { neighborhoodKey } from '../shared/normalize.js';
import { decodeCursor, resolveLimit, toPage, type Page } from '../shared/pagination.js';
import { parseInput } from '../shared/validate.js';
import { findStateByUf } from './repository.js';
import {
  MunicipalityQuerySchema,
  type MunicipalityQuery,
  type MunicipalityResponse,
  type StateResponse,
} from './schemas.js';

export interface GeoService {
  listStates(actor: Actor): StateResponse[];
  /** Ordenado por código IBGE (o cursor é o último código). `q` ignora acento e caixa. */
  listMunicipalities(actor: Actor, query?: MunicipalityQuery): Page<MunicipalityResponse>;
}

interface IndexedMunicipality extends MunicipalityResponse {
  key: string;
}

/** Localidades são leitura aberta a qualquer ator autenticado. */
export function createGeoService(db: Db): GeoService {
  // O seed é imutável em runtime: carrega uma vez (≈5,6 mil linhas) com a chave sem acento.
  let index: IndexedMunicipality[] | undefined;
  const load = (): IndexedMunicipality[] => {
    index ??= db
      .select({
        ibgeCode: municipalities.ibgeCode,
        name: municipalities.name,
        stateCode: municipalities.stateCode,
        uf: states.uf,
      })
      .from(municipalities)
      .innerJoin(states, eq(municipalities.stateCode, states.ibgeCode))
      .orderBy(asc(municipalities.ibgeCode))
      .all()
      .map((m) => ({ ...m, key: neighborhoodKey(m.name) }));
    return index;
  };

  return withRoleGuard(
    {
      listStates() {
        return db
          .select({ ibgeCode: states.ibgeCode, uf: states.uf, name: states.name })
          .from(states)
          .orderBy(asc(states.uf))
          .all();
      },

      listMunicipalities(_actor, query = {}) {
        const p = parseInput(MunicipalityQuerySchema, query);
        const limit = resolveLimit(p.limit);
        const after = decodeCursor(p.cursor) ?? 0;
        let stateCode: number | undefined;
        if (p.uf !== undefined) {
          const state = findStateByUf(db, p.uf.toUpperCase());
          if (!state) return { items: [], nextCursor: null };
          stateCode = state.ibgeCode;
        }
        const needle = p.q ? neighborhoodKey(p.q) : '';
        const rows: MunicipalityResponse[] = [];
        for (const m of load()) {
          if (m.ibgeCode <= after) continue;
          if (stateCode !== undefined && m.stateCode !== stateCode) continue;
          if (needle !== '' && !m.key.includes(needle)) continue;
          rows.push({ ibgeCode: m.ibgeCode, name: m.name, stateCode: m.stateCode, uf: m.uf });
          if (rows.length > limit) break;
        }
        return toPage(rows, limit, (r) => r.ibgeCode);
      },
    },
    undefined,
  );
}
