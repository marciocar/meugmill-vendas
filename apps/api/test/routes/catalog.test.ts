import { crudContract } from './crud-contract.js';

for (const path of ['product-subgroups', 'retail-networks', 'economic-groups']) {
  crudContract({
    name: path,
    path,
    body: (code) => ({ code, name: `Nome ${code}` }),
    patch: { name: 'Nome alterado' },
  });
}
