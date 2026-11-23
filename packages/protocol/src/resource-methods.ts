// Resource methods and their shared public schemas.
import { resourceMethodsPart1 } from "./resource-methods-1.ts";
import { resourceMethodsPart2 } from "./resource-methods-2.ts";
import { resourceMethodsPart3 } from "./resource-methods-3.ts";

export {
  CalendarReminders,
  MailCheck,
  MutedEvent,
  SecretField,
  SecretInfo,
  SecretSite,
  SKILL_ZIP_MAX,
  SkillCandidate,
  SkillImportSource,
  SkillInfo,
  SkillSource,
} from "./resource-methods-schemas.ts";
export const resourceMethods = { ...resourceMethodsPart1, ...resourceMethodsPart2, ...resourceMethodsPart3 } as const;
