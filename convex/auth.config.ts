// Convex Auth issues and verifies its own JWTs against this deployment, so the
// only trusted issuer is the deployment itself.
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
}

export default authConfig
