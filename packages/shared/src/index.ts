export { roundTo } from './round.js';
export { loginSchema, type LoginInput, type SessionInfo } from './auth.js';
export {
  ACTIVITY_FACTORS,
  DEFAULT_DEFICIT,
  DEFAULT_FAT_PER_KG,
  DEFAULT_PROTEIN_PER_KG,
  DEFAULT_SWEETS_SHARE,
  MIN_TARGET_KCAL,
  calcAge,
  calcBmr,
  calcCarbTarget,
  calcMacroTargets,
  calcSweetsBudget,
  calcTargetKcal,
  calcTdee,
  computeTargets,
  effectiveTargets,
  type ActivityLevel,
  type Deficit,
  type DeficitMode,
  type EffectiveTargets,
  type MissingField,
  type Sex,
  type Targets,
  type TargetOverrides,
  type TargetsInput,
} from './nutrition.js';
export {
  profileUpdateSchema,
  type Profile,
  type ProfileResponse,
  type ProfileUpdate,
} from './profile.js';
