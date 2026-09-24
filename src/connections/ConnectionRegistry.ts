import { ConnectionProfile } from "../domain/ConnectionProfile.js";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { NoActiveConnectionError } from "../errors/NoActiveConnectionError.js";
import { UnknownProfileError } from "../errors/UnknownProfileError.js";

/**
 * The Registry: every known connection, and which one is active.
 *
 * This is the only mutable state that makes runtime switching possible. As an
 * injected instance rather than module-level state it is ordinary to
 * construct, and several can exist side by side in a test file.
 *
 * It holds no database machinery on purpose. Verifying that a connection
 * actually works belongs to ConnectionManager, which keeps this class free of
 * I/O and trivially testable.
 */
export class ConnectionRegistry {
  private readonly profiles = new Map<string, ConnectionProfile>();
  private activeName: string | null = null;
  private activeTarget: ConnectionTarget | null = null;

  constructor(profiles: ConnectionProfile[] = []) {
    for (const profile of profiles) {
      this.profiles.set(profile.name, profile);
    }
  }

  /**
   * Choose the starting connection, in order of preference:
   * the requested name, a profile called `default`, then the first defined.
   *
   * @returns a warning when the requested name does not exist, else null.
   *   A typo should not stop the server; saying so and carrying on is more
   *   useful than refusing to start.
   */
  public selectInitial(preferredName: string | null): string | null {
    if (preferredName && this.profiles.has(preferredName)) {
      this.activateProfile(preferredName);
      return null;
    }

    const warning = preferredName
      ? `The default profile "${preferredName}" does not match any profile.`
      : null;

    if (this.profiles.has("default")) {
      this.activateProfile("default");
      return warning;
    }

    const first = this.profiles.keys().next();
    if (!first.done) {
      this.activateProfile(first.value);
    }

    return warning;
  }

  /** Insertion order, which is what makes "the first profile" meaningful. */
  public list(): ConnectionProfile[] {
    return Array.from(this.profiles.values());
  }

  public names(): string[] {
    return Array.from(this.profiles.keys());
  }

  public find(profileName: string): ConnectionProfile | undefined {
    return this.profiles.get(profileName);
  }

  public has(profileName: string): boolean {
    return this.profiles.has(profileName);
  }

  /**
   * Register an alias opened at runtime. An existing name is replaced, so
   * reconnecting with corrected credentials fixes the entry rather than
   * failing.
   */
  public register(profile: ConnectionProfile): void {
    this.profiles.set(profile.name, profile);
  }

  public getActiveTarget(): ConnectionTarget | null {
    return this.activeTarget;
  }

  public getActiveName(): string | null {
    return this.activeName;
  }

  /**
   * @throws NoActiveConnectionError whose message names both ways out. Tool
   *   handlers convert it to a tool result, so that message is what the user
   *   reads.
   */
  public requireActiveTarget(): ConnectionTarget {
    if (!this.activeTarget) {
      throw new NoActiveConnectionError();
    }
    return this.activeTarget;
  }

  /** @throws UnknownProfileError listing the names that do exist. */
  public activateProfile(profileName: string): ConnectionTarget {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new UnknownProfileError(profileName, this.names());
    }
    this.activeName = profile.name;
    this.activeTarget = profile.target;
    return this.activeTarget;
  }

  /**
   * Point at an explicit target under a label.
   *
   * No defensive copy is needed because ConnectionTarget is immutable: nothing
   * downstream can mutate the active target into corrupting the profile it
   * came from.
   */
  public activateTarget(target: ConnectionTarget, label: string): ConnectionTarget {
    this.activeName = label;
    this.activeTarget = target;
    return target;
  }
}
