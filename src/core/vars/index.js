export {
  globalVarsPath,
  projectVarsPath,
  readGlobalVars,
  writeGlobalVars,
  readProjectVars,
  writeProjectVars,
  loadAllVars,
  setVar,
  deleteVar,
  maskValue,
} from "./sources.js";

export { interpolate, findRefs, MissingVarError } from "./interpolate.js";
