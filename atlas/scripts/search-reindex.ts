/** Rebuilds every search document from canonical tables (idempotent).  npm run search:reindex */
import { closeDb } from "../src/db/client";
import { reindexAll } from "../src/server/search";

reindexAll()
  .then(async (r) => {
    console.log(JSON.stringify(r));
    await closeDb();
  })
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
