// A variable's sign-in sites (Resources › Variables): loaded with that tab (usePack in index.ts).
export const enSignIn = {
  "res.signIn.menu": "Sign-in sites",
  "res.signIn.title": "Sign in with {name}",
  "res.signIn.lead":
    "Agents put this value into a sign-in field on these sites without seeing it. On any other site, they ask you first.",
  "res.signIn.kind": "Field it goes into",
  "res.signIn.password": "Password",
  "res.signIn.username": "Username",
  "res.signIn.otp": "One-time code",
  "res.signIn.otpHint":
    "Paste the setup key or the otpauth:// address the site gives for an authenticator app as this variable's value. Agents fill in the current code.",
  "res.signIn.anySite": "Any site",
  "res.signIn.anySiteHint": "Agents may type it on any website they visit, without asking you.",
  "res.signIn.sites": "Sites",
  "res.signIn.wrongSite": "{site} is not a website address",
  "res.signIn.none": "No sites yet: agents ask you each time.",
  "res.signIn.lastUsed": "Last used on {site}, {when}",
  "res.signIn.badge": "Sign in: {sites}",
  "res.signIn.badgeAny": "Sign in: any site",
  "res.signIn.badgeCount": "Sign in: {n} sites",
} as const;
