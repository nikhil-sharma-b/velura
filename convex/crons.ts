import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

// Nightly, in the small hours UTC (D17). Not more often: the grace window is
// measured in days, so a sweep an hour after the last one has nothing new it
// is allowed to collect, and each run costs a full listing of the bucket.
crons.cron(
  "collect orphaned tiles",
  "0 3 * * *",
  internal.collectionActions.sweep,
  {}
)

export default crons
