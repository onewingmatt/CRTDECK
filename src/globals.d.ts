// Steam's internal client API is exposed as a global in the Decky SP scope and
// is already declared by @decky/ui — redeclaring it here makes tsc fail with
// TS2451 (cannot redeclare block-scoped variable), which breaks the typecheck
// gate. Add project-local global types below instead.
