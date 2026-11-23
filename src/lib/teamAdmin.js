// The TMS owner (Daniel): the only person who may add teammates (2026-11-23: "That add
// teammates button should only be for me"). The original workspace owner from
// supabase/per-user-workspaces.sql. Used by the TMS (to show the button) and by
// api/invite-user.js (which refuses everyone else).
export const TMS_OWNER_ID = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a';

export const isTmsOwner = userId => Boolean(userId) && userId === TMS_OWNER_ID;
