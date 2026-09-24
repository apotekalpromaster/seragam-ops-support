// Postgres (PGlite) untuk mode demo berjalan di Web Worker supaya query tidak membekukan UI.
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

void worker({
  async init(options) {
    return new PGlite({ dataDir: options.dataDir })
  },
})
