/** All generic targets (each file owned by one research workstream). */
import { TARGETS_1 } from "./targets-1";
import { TARGETS_2 } from "./targets-2";
import { TARGETS_3 } from "./targets-3";
import { TARGETS_4 } from "./targets-4";
import type { GenericTarget } from "./types";

export const GENERIC_TARGETS: GenericTarget[] = [...TARGETS_1, ...TARGETS_2, ...TARGETS_3, ...TARGETS_4];
