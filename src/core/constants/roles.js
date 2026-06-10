// Sender roles resolved by core/identity/telegram.js. Owner is whoever owns
// the channel; contact is a known person added to the roster; guest is anyone
// else (no permissions, must be claimed by the owner or added by a real user
// via terminal/web).
export const SENDER_ROLES = Object.freeze({
  OWNER: "owner",
  CONTACT: "contact",
  GUEST: "guest",
});
