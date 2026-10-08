import { crudContract } from './crud-contract.js';

crudContract({
  name: 'portfolio-types',
  path: 'portfolio-types',
  body: (code) => ({ code, name: `Tipo ${code}` }),
  patch: { name: 'Tipo alterado' },
});
