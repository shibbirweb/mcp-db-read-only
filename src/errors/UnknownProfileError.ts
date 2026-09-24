import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a profile name does not exist.
 *
 * Carries the known names, because a mistyped profile is almost always fixed
 * by seeing the real list rather than by being told the name was wrong.
 */
export class UnknownProfileError extends ApplicationError {
  constructor(
    public readonly profileName: string,
    public readonly knownProfiles: string[]
  ) {
    super(
      `Unknown profile "${profileName}". Known profiles: ${knownProfiles.join(", ") || "none"}`
    );
  }
}
