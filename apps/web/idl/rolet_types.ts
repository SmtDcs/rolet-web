// Hand-rolled IDL type — substitutes for the Anchor-generated types file
// while `anchor build --no-idl` is in use due to the proc_macro2 0.30.1 bug.
//
// Re-runs of `anchor idl init` will eventually replace this; until then,
// it's a structural alias over the JSON IDL.

import idl from "./rolet.json";

export type Rolet = typeof idl;
export const ROLET_IDL = idl as Rolet;
